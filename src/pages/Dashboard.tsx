import { Settings, Check } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import * as React from 'react'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy } from '@dnd-kit/sortable'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useProductos } from '@/hooks/use-productos'
import { useDashboardWidgets } from '@/hooks/use-dashboard-widgets'
import { buscarTurnoAbierto, type Turno } from '@/services/turnos'
import { signoDoc } from '@/services/reportes'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { estadoVencimiento } from '@/lib/ui-utils'
import { SortableItem } from '@/components/ui/sortable-item'
import {
  TurnoActivoWidget,
  KpisWidget,
  SunatWidget,
  AccionesRapidasWidget,
  TurnosCerradosWidget,
  AlertaStockWidget,
  AlertaVencimientoWidget,
  VentasMesWidget,
  VentasCategoriaWidget,
  TopProductosWidget,
} from '@/components/dashboard'
import type { Doc, TurnoSunat } from '@/components/dashboard/types'

const mesActual = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const todayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function Dashboard({ onNavigate }: { onNavigate: (seccion: string) => void }) {
  const { user } = useAuth()
  const { nombre, tienePermiso } = usePermisos()
  const { productos } = useProductos()
  const [mes, setMes] = React.useState<string>(mesActual())
  const [activeTurno, setActiveTurno] = React.useState<Turno | null>(null)
  const [closedTurnos, setClosedTurnos] = React.useState<TurnoSunat[]>([])
  const [docs, setDocs] = React.useState<Doc[]>([])
  const [docsHoy, setDocsHoy] = React.useState<Doc[]>([])
  const [cargado, setCargado] = React.useState(false)

  const {
    widgets,
    widgetsColumnaIzq,
    widgetsColumnaDer,
    editando,
    setEditando,
    toggleWidget,
    reordenar,
    guardar,
  } = useDashboardWidgets()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = widgets.findIndex((w) => w.id === active.id)
    const newIndex = widgets.findIndex((w) => w.id === over.id)
    if (oldIndex !== -1 && newIndex !== -1) reordenar(oldIndex, newIndex)
  }, [widgets, reordenar])

  React.useEffect(() => {
    const now = new Date()
    const hoyInicio = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
    const hoyFin = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString()
    const [yy, mm] = mes.split('-').map(Number)
    const inicioMes = new Date(yy, mm - 1, 1).toISOString()
    const finMes = new Date(yy, mm, 0, 23, 59, 59, 999).toISOString()

    let activo = true
    ;(async () => {
      try {
        const [turno, cerrados, docsHoySnap, docsSnap] = await Promise.all([
          buscarTurnoAbierto(user?.uid, tienePermiso('verTodo')),
          getDocs(query(collection(db, COL.TURNOS), where('estado', '==', 'cerrado'), where('fechaCierre', '>=', hoyInicio), where('fechaCierre', '<=', hoyFin))),
          getDocs(query(collection(db, COL.DOCUMENTOS), where('fecha', '>=', hoyInicio), where('fecha', '<=', hoyFin))),
          getDocs(query(collection(db, COL.DOCUMENTOS), where('fecha', '>=', inicioMes), where('fecha', '<=', finMes))),
        ])
        if (!activo) return
        setActiveTurno(turno)
        setClosedTurnos(cerrados.docs.map((s) => ({ totalVentas: s.data().totalVentas, ventasDelTurno: s.data().ventasDelTurno || [] })))
        setDocsHoy(docsHoySnap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<Doc, 'id'>) })))
        setDocs(docsSnap.docs.map((s) => ({ id: s.id, ...(s.data() as Omit<Doc, 'id'>) })))
      } catch (e) {
        console.error('❌ Error cargando dashboard:', e)
      } finally {
        if (activo) setCargado(true)
      }
    })()
    return () => { activo = false }
  }, [user?.uid, mes, tienePermiso])

  const verTodo = tienePermiso('verTodo')
  const ventasHoy = React.useMemo(
    () => docsHoy.filter((d) => (verTodo || !user?.uid || d.usuarioId === user.uid) && d.estado !== 'anulada' && !d.consolidado && (d.tipoDoc === 'NV' || d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA' || d.tipoDoc === 'NC' || d.tipoDoc === 'ND')),
    [docsHoy, verTodo, user?.uid]
  )
  const totalVentasHoy = React.useMemo(() => ventasHoy.reduce((s, d) => s + signoDoc(d) * (d.venta?.total || 0), 0), [ventasHoy])
  const numTransacciones = ventasHoy.length
  const ticketPromedio = numTransacciones > 0 ? totalVentasHoy / numTransacciones : 0

  const ventas = React.useMemo(
    () => docs.filter((d) => d.estado !== 'anulada' && !d.consolidado && (d.tipoDoc === 'NV' || d.tipoDoc === 'BOLETA' || d.tipoDoc === 'FACTURA' || d.tipoDoc === 'NC' || d.tipoDoc === 'ND')),
    [docs]
  )
  const totalVentasMes = React.useMemo(() => ventas.reduce((s, d) => s + signoDoc(d) * (d.venta?.total || 0), 0), [ventas])

  const docsSunatHoy = React.useMemo(() => docsHoy.filter((d) => d.tipoDoc !== 'NV'), [docsHoy])
  const sunatPendientes = docsSunatHoy.filter((d) => d.sunat?.estado === 'pendiente').length
  const sunatRechazados = docsSunatHoy.filter((d) => d.sunat?.estado === 'rechazado' || d.sunat?.estado === 'error').length
  const sunatAceptados = docsSunatHoy.filter((d) => d.sunat?.estado === 'aceptado').length

  const serieDiaria = React.useMemo(() => {
    const [yy, mm] = mes.split('-').map(Number)
    const dias: { key: string; label: string; date: Date }[] = []
    const d = new Date(yy, mm - 1, 1)
    const hoy = new Date()
    while (d.getMonth() === mm - 1) {
      if (mes === mesActual() && d > hoy) break
      dias.push({ key: todayKey(d), label: String(d.getDate()), date: new Date(d) })
      d.setDate(d.getDate() + 1)
    }
    const tot: Record<string, number> = {}
    for (const doc of ventas) {
      if (!doc.fecha) continue
      const k = todayKey(new Date(doc.fecha))
      tot[k] = (tot[k] || 0) + (doc.venta?.total || 0)
    }
    const max = Math.max(...dias.map((d) => tot[d.key] || 0), 0.01)
    const step = Math.max(1, Math.ceil(dias.length / 7))
    return { dias, tot, max, step }
  }, [ventas, mes])

  const categorias = React.useMemo(() => {
    const map: Record<string, number> = {}
    for (const doc of ventas) {
      const signo = signoDoc(doc)
      for (const it of doc.venta?.items || []) {
        const cat = it.categoria || 'Sin categoría'
        map[cat] = (map[cat] || 0) + signo * (it.subtotal || 0)
      }
    }
    const arr = Object.entries(map).map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total)
    const max = Math.max(...arr.map((c) => c.total), 0.01)
    return { arr, max }
  }, [ventas])

  const topProductos = React.useMemo(() => {
    const map: Record<string, { nombre: string; cantidad: number; total: number }> = {}
    for (const doc of ventas) {
      const signo = signoDoc(doc)
      for (const it of doc.venta?.items || []) {
        const id = it.id || it.nombre || 'x'
        if (!map[id]) map[id] = { nombre: it.nombre || id, cantidad: 0, total: 0 }
        map[id].cantidad += signo * (it.cantidad || 0)
        map[id].total += signo * (it.subtotal || 0)
      }
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 8)
  }, [ventas])

  const stockBajo = React.useMemo(
    () => productos.filter((p) => p.activo !== false && p.stock != null && p.stock > 0 && p.minStock != null && p.stock <= p.minStock).map((p) => ({ id: p.id, nombre: p.nombre ?? 'Sin nombre', stock: p.stock ?? 0 })),
    [productos]
  )
  const stockAgotado = React.useMemo(
    () => productos.filter((p) => p.activo !== false && p.stock === 0).map((p) => ({ id: p.id, nombre: p.nombre ?? 'Sin nombre', stock: 0 })),
    [productos]
  )
  const totalProblemas = stockBajo.length + stockAgotado.length

  const proximosAVencer = React.useMemo(
    () => productos
      .filter((p) => {
        if (p.activo === false || !p.fechaVencimiento) return false
        const ev = estadoVencimiento(p.fechaVencimiento)
        return ev.dias != null && ev.dias <= 30
      })
      .sort((a, b) => {
        const da = estadoVencimiento(a.fechaVencimiento).dias ?? 999
        const db = estadoVencimiento(b.fechaVencimiento).dias ?? 999
        return da - db
      })
      .map((p) => ({ id: p.id, nombre: p.nombre ?? 'Sin nombre', fechaVencimiento: p.fechaVencimiento ?? '' })),
    [productos]
  )

  const usuario = nombre || user?.displayName || user?.email?.split('@')[0] || 'Usuario'
  const fechaStr = new Date().toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' })
  const [yyM, mmM] = mes.split('-').map(Number)
  const mesNombre = new Date(yyM, mmM - 1).toLocaleDateString('es-PE', { month: 'long', year: 'numeric' })

  const irA = (seccion: string) => onNavigate(seccion)

  if (!cargado) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm">Cargando dashboard…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="brand-grad rounded-2xl p-6 text-white shadow-glow">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold">Dashboard</h1>
            <p className="mt-1 text-sm text-white/80">{fechaStr}</p>
            <p className="mt-0.5 text-xs font-medium text-white/70">{usuario}</p>
          </div>
          <button
            onClick={() => editando ? guardar() : setEditando(true)}
            className="flex items-center gap-2 rounded-xl bg-white/20 px-4 py-2 text-sm font-bold text-white transition-all hover:bg-white/30 cursor-pointer"
          >
            {editando ? <><Check className="h-4 w-4" /> Guardar</> : <><Settings className="h-4 w-4" /> Personalizar</>}
          </button>
        </div>
      </div>

      {editando && (
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <p className="mb-2 text-xs font-bold text-muted-foreground">Widgets visibles (arrastrá para reordenar):</p>
          <div className="flex flex-wrap gap-2">
            {widgets.map((w) => (
              <label key={w.id} className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm cursor-pointer hover:bg-muted/40">
                <input type="checkbox" checked={w.visible} onChange={() => toggleWidget(w.id)} className="accent-orange-500" />
                {w.titulo}
              </label>
            ))}
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.08fr]">
          <div className="order-2 space-y-4 lg:order-1">
            <SortableContext items={widgetsColumnaIzq.map((w) => w.id)} strategy={rectSortingStrategy}>
              {widgetsColumnaIzq.map((w) => (
                <SortableItem key={w.id} id={w.id} editando={editando}>
                  {w.id === 'ventasMes' && (
                    <VentasMesWidget
                      totalVentasMes={totalVentasMes}
                      ventasMesCount={ventas.length}
                      mesNombre={mesNombre}
                      serieDiaria={serieDiaria}
                      mes={mes}
                      onMesChange={setMes}
                    />
                  )}
                  {w.id === 'ventasCategoria' && <VentasCategoriaWidget categorias={categorias} />}
                  {w.id === 'topProductos' && <TopProductosWidget topProductos={topProductos} />}
                </SortableItem>
              ))}
            </SortableContext>
          </div>

          <div className="order-1 space-y-4 lg:order-2">
            <SortableContext items={widgetsColumnaDer.map((w) => w.id)} strategy={rectSortingStrategy}>
              {widgetsColumnaDer.map((w) => (
                <SortableItem key={w.id} id={w.id} editando={editando}>
                  {w.id === 'turnoActivo' && <TurnoActivoWidget activeTurno={activeTurno} tienePermiso={tienePermiso} onNavigate={irA} />}
                  {w.id === 'kpis' && <KpisWidget totalVentasHoy={totalVentasHoy} numTransacciones={numTransacciones} ticketPromedio={ticketPromedio} totalProblemas={totalProblemas} />}
                  {w.id === 'sunat' && <SunatWidget sunatPendientes={sunatPendientes} sunatRechazados={sunatRechazados} sunatAceptados={sunatAceptados} tienePermiso={tienePermiso} onNavigate={irA} />}
                  {w.id === 'accionesRapidas' && <AccionesRapidasWidget tienePermiso={tienePermiso} onNavigate={irA} />}
                  {w.id === 'turnosCerrados' && <TurnosCerradosWidget numTurnosCerrados={closedTurnos.length} />}
                  {w.id === 'alertaStock' && <AlertaStockWidget stockBajo={stockBajo} stockAgotado={stockAgotado} totalProblemas={totalProblemas} tienePermiso={tienePermiso} onNavigate={irA} />}
                  {w.id === 'alertaVencimiento' && <AlertaVencimientoWidget proximosAVencer={proximosAVencer} tienePermiso={tienePermiso} onNavigate={irA} />}
                </SortableItem>
              ))}
            </SortableContext>
          </div>
        </div>
      </DndContext>
    </div>
  )
}
