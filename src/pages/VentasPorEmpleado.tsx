import { Download, Loader2, Users } from 'lucide-react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { Button } from '@/components/ui/button'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

function mesDeHoy() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Doc = {
  id: string
  tipoDoc?: string
  serie?: string
  numero?: number
  serieNumero?: string
  anioMes?: string
  fecha?: string
  createdAt?: string
  estado?: string
  consolidado?: boolean
  usuarioId?: string
  venta?: {
    total?: number
    cliente_nombre?: string
    cliente_dni?: string
    tipoPago?: string
    items?: { id: string; nombre: string; subtotal?: number; precioVenta?: number; cantidad?: number }[]
    fecha?: string
    cajero?: string
    turnoId?: string
  }
  sunat?: { consolidado?: boolean; estado?: string }
}

type EmpleadoVentas = {
  usuarioId: string
  cajero: string
  cantidadDocs: number
  totalVentas: number
  boletas: number
  facturas: number
  ncs: number
  ticketPromedio: number
  efectivo: number
  transferencia: number
  credito: number
}

function signoDoc(d: Doc): number {
  return d.tipoDoc === 'NC' ? -1 : 1
}

function descargarCsv(rows: string[], nombre: string) {
  const content = rows.join('\n')
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

export function VentasPorEmpleado() {
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const { toast } = useNotifications()

  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? '' : (user?.uid || '')

  const [mes, setMes] = React.useState(mesDeHoy)
  const [docs, setDocs] = React.useState<Doc[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState<'todos' | 'NV' | 'BOLETA' | 'FACTURA' | 'NC' | 'ND'>('todos')

  const [añoMesTarget] = React.useMemo(() => {
    const [y, m] = mes.split('-')
    return [`${y}-${Number(m)}`]
  }, [mes])

  React.useEffect(() => {
    let activo = true
    setLoading(true)
    setError(null)

    const tipos = ['NV', 'BOLETA', 'FACTURA', 'NC', 'ND']
    const baseFilters = [where('anioMes', '==', añoMesTarget)]
    if (miUid) baseFilters.push(where('usuarioId', '==', miUid))

    const promises = tipos.map((tipo) =>
      getDocs(query(collection(db, COL.DOCUMENTOS), where('tipoDoc', '==', tipo), ...baseFilters, orderBy('fecha', 'asc')))
    )

    Promise.all(promises)
      .then((snaps) => {
        if (!activo) return
        const allDocs = snaps.flatMap((s) =>
          s.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Doc, 'id'>) }))
        )
        setDocs(allDocs)
        setLoading(false)
      })
      .catch((e) => {
        if (!activo) return
        setError('Error cargando documentos: ' + (e as Error).message)
        setLoading(false)
      })

    return () => { activo = false }
  }, [añoMesTarget, miUid])

  const docsFiltrados = React.useMemo(() => {
    const activos = docs.filter((d) => d.estado !== 'anulada')
    // Excluir boletas consolidadas (consolidado: true a nivel raíz del doc)
    // y excluir NV que fueron consumidas por consolidación
    const sinConsolidadas = activos.filter((d) => !d.consolidado)
    if (filtro === 'todos') return sinConsolidadas
    return sinConsolidadas.filter((d) => d.tipoDoc === filtro)
  }, [docs, filtro])

  const empleados = React.useMemo(() => {
    const map = new Map<string, EmpleadoVentas>()

    for (const d of docsFiltrados) {
      const uid = d.usuarioId || 'sin-id'
      const cajero = d.venta?.cajero || 'Sin nombre'
      const signo = signoDoc(d)
      const total = Math.abs(d.venta?.total ?? 0) * signo

      if (!map.has(uid)) {
        map.set(uid, {
          usuarioId: uid,
          cajero,
          cantidadDocs: 0,
          totalVentas: 0,
          boletas: 0,
          facturas: 0,
          ncs: 0,
          ticketPromedio: 0,
          efectivo: 0,
          transferencia: 0,
          credito: 0,
        })
      }
      const emp = map.get(uid)!
      emp.cantidadDocs++
      emp.totalVentas += total

      if (d.tipoDoc === 'BOLETA') emp.boletas++
      else if (d.tipoDoc === 'FACTURA') emp.facturas++
      else if (d.tipoDoc === 'NC') emp.ncs++

      const ven = d.venta as Record<string, unknown>
      const pagos = ven?.pagos && Array.isArray(ven.pagos) ? ven.pagos : (ven?.tipoPago ? [{ tipo: ven.tipoPago, monto: ven.total }] : [])
      for (const p of pagos as { tipo: string; monto: number }[]) {
        if (p.tipo === 'efectivo') emp.efectivo += (p.monto || 0) * signo
        else if (p.tipo === 'transferencia') emp.transferencia += (p.monto || 0) * signo
        else if (p.tipo === 'credito') emp.credito += (p.monto || 0) * signo
      }
    }

    const arr = Array.from(map.values())
    for (const e of arr) {
      e.ticketPromedio = e.cantidadDocs > 0 ? e.totalVentas / e.cantidadDocs : 0
    }
    arr.sort((a, b) => b.totalVentas - a.totalVentas)
    return arr
  }, [docsFiltrados])

  const totales = React.useMemo(() => {
    let cantidadDocs = 0
    let totalVentas = 0
    let efectivo = 0
    let transferencia = 0
    let credito = 0

    for (const e of empleados) {
      cantidadDocs += e.cantidadDocs
      totalVentas += e.totalVentas
      efectivo += e.efectivo
      transferencia += e.transferencia
      credito += e.credito
    }

    return { cantidadDocs, totalVentas, efectivo, transferencia, credito, ticketPromedio: cantidadDocs > 0 ? totalVentas / cantidadDocs : 0 }
  }, [empleados])

  const handleExportar = () => {
    if (empleados.length === 0) {
      toast('No hay datos para exportar', 'warning')
      return
    }
    const header = 'Cajero|Documento ID|Total Ventas|Documentos|Ticket Promedio|Efectivo|Transferencia|Crédito|Boletas|Facturas|NC'
    const rows = empleados.map((e) =>
      [
        e.cajero,
        e.usuarioId,
        e.totalVentas.toFixed(2),
        e.cantidadDocs,
        e.ticketPromedio.toFixed(2),
        e.efectivo.toFixed(2),
        e.transferencia.toFixed(2),
        e.credito.toFixed(2),
        e.boletas,
        e.facturas,
        e.ncs,
      ].join('|')
    )
    const [y, m] = mes.split('-')
    descargarCsv([header, ...rows], `VentasPorEmpleado_${y}${m}.csv`)
    toast(`Exportado ${empleados.length} empleados`, 'success')
  }

  if (!tienePermiso('ventasPorEmpleado')) {
    return <div className="p-8 text-center text-muted-foreground">No tienes permiso para ver esta sección.</div>
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Ventas por Empleado</h1>
        <div className="flex items-center gap-2">
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="h-9 rounded-lg border px-3 text-sm" />
          <Button variant="outline" size="sm" onClick={handleExportar} disabled={loading || empleados.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Exportar
          </Button>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Empleados</div>
          <div className="mt-1 text-2xl font-bold">{empleados.length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Documentos</div>
          <div className="mt-1 text-2xl font-bold num">{totales.cantidadDocs}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Total Ventas</div>
          <div className="mt-1 text-2xl font-bold num text-primary">{fmt(totales.totalVentas)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Ticket Promedio</div>
          <div className="mt-1 text-2xl font-bold num">{fmt(totales.ticketPromedio)}</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">Mix de Pago</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            <span>💵 {fmt(totales.efectivo)}</span>
            <span>📲 {fmt(totales.transferencia)}</span>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {([
          { key: 'todos', label: 'Todos' },
          { key: 'NV', label: 'NV' },
          { key: 'BOLETA', label: 'Boletas' },
          { key: 'FACTURA', label: 'Facturas' },
          { key: 'NC', label: 'NC' },
        ] as const).map((t) => (
          <button key={t.key} onClick={() => setFiltro(t.key)} className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', filtro === t.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista de empleados */}
      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <span className="text-sm font-bold">Desempeño por Empleado</span>
          <span className="num text-sm text-muted-foreground">{empleados.length} empleados · {fmt(totales.totalVentas)}</span>
        </div>

        {loading ? (
          <div className="flex h-40 items-center justify-center text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando…</span>
          </div>
        ) : error ? (
          <div className="p-5 text-sm text-destructive">{error}</div>
        ) : empleados.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
            <p>Sin ventas para este mes</p>
          </div>
        ) : (
          <div className="divide-y">
            {empleados.map((e, idx) => {
              const porcentaje = totales.totalVentas > 0 ? (e.totalVentas / totales.totalVentas) * 100 : 0
              return (
                <div key={e.usuarioId} className="p-4 hover:bg-muted/30">
                  {/* Fila principal: avatar + nombre + total */}
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      {idx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold truncate">{e.cajero}</span>
                        <span className="hidden text-xs text-muted-foreground sm:inline">({e.usuarioId.slice(0, 8)}…)</span>
                      </div>
                      {/* Stats en mobile: wrap */}
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>{e.cantidadDocs} docs</span>
                        <span>Ticket: {fmt(e.ticketPromedio)}</span>
                        <span>Boletas: {e.boletas}</span>
                        <span>Facturas: {e.facturas}</span>
                        {e.ncs > 0 && <span className="text-destructive">NC: {e.ncs}</span>}
                      </div>
                      {/* Barra de progreso */}
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${porcentaje}%` }} />
                      </div>
                    </div>
                    {/* Total + porcentaje */}
                    <div className="shrink-0 text-right">
                      <div className={cn('text-base sm:text-lg font-bold num', e.totalVentas < 0 && 'text-destructive')}>
                        {e.totalVentas < 0 ? '-' : ''}{fmt(Math.abs(e.totalVentas))}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{porcentaje.toFixed(1)}%</div>
                    </div>
                  </div>
                  {/* Métodos de pago debajo */}
                  <div className="mt-2 flex gap-3 pl-13 text-xs text-muted-foreground">
                    {e.efectivo > 0 && <span>💵 {fmt(e.efectivo)}</span>}
                    {e.transferencia > 0 && <span>📲 {fmt(e.transferencia)}</span>}
                    {e.credito > 0 && <span>💳 {fmt(e.credito)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Ranking bar chart */}
      {!loading && empleados.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card p-4 shadow-card">
          <div className="mb-3 text-sm font-bold">Comparativa de Ventas</div>
          <div className="space-y-2">
            {empleados.map((e) => {
              const maxVentas = Math.max(...empleados.map((x) => Math.abs(x.totalVentas)))
              const pct = maxVentas > 0 ? (Math.abs(e.totalVentas) / maxVentas) * 100 : 0
              return (
                <div key={e.usuarioId} className="flex items-center gap-2 sm:gap-3">
                  <span className="w-20 sm:w-32 truncate text-xs font-medium">{e.cajero}</span>
                  <div className="flex-1 min-w-0">
                    <div className="h-5 overflow-hidden rounded bg-muted">
                      <div
                        className={cn('h-full rounded transition-all', e.totalVentas >= 0 ? 'bg-primary' : 'bg-destructive')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span className={cn('w-20 sm:w-24 text-right text-xs font-bold num shrink-0', e.totalVentas < 0 && 'text-destructive')}>
                    {e.totalVentas < 0 ? '-' : ''}{fmt(Math.abs(e.totalVentas))}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
