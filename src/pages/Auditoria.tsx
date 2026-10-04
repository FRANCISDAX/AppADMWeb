import { AlertTriangle, DatabaseBackup, Download, History, Loader2, Search, Shield, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNotifications } from '@/components/notifications'
import { usePermisos } from '@/context/permisos'
import { ErroresPanel } from '@/components/auditoria/ErroresPanel'
import { EstadoRespaldo } from '@/components/EstadoRespaldo'
import { ExportarDatos } from '@/components/ExportarDatos'
import { obtenerLogs, limpiarLogs, logsToCSV, descargarArchivo, type AuditLog } from '@/lib/audit'
import { cn } from '@/lib/utils'

const ACCION_LABELS: Record<string, string> = {
  crear_nv: 'Crear NV',
  emitir_boleta: 'Emitir Boleta',
  emitir_factura: 'Emitir Factura',
  anular_documento: 'Anular Documento',
  crear_egreso: 'Crear Egreso',
  crear_egreso_turno: 'Crear Egreso (Turno)',
  eliminar_egreso: 'Eliminar Egreso',
  editar_egreso: 'Editar Egreso',
  abrir_turno: 'Abrir Turno',
  cerrar_turno: 'Cerrar Turno',
  crear_producto: 'Crear Producto',
  editar_producto: 'Editar Producto',
  eliminar_producto: 'Eliminar Producto',
  ajuste_stock: 'Ajuste de Stock',
  toma_inventario: 'Toma de Inventario',
  // Pedidos (venta enviada a caja): el ciclo completo queda en la auditoría con quién y por qué.
  crear_venta_pendiente: 'Enviar pedido a caja',
  cobrar_venta_pendiente: 'Cobrar pedido',
  eliminar_venta_pendiente: 'Eliminar pedido',
}

const ACCION_COLORS: Record<string, string> = {
  crear_nv: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  emitir_boleta: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  emitir_factura: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  anular_documento: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  crear_egreso: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  crear_egreso_turno: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  eliminar_egreso: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  editar_egreso: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  abrir_turno: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  cerrar_turno: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  crear_producto: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  editar_producto: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  eliminar_producto: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  ajuste_stock: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  toma_inventario: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  crear_venta_pendiente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  cobrar_venta_pendiente: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  eliminar_venta_pendiente: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
}

const ACCION_MODULO: Record<string, string> = {
  crear_nv: 'Ventas',
  emitir_boleta: 'Ventas',
  emitir_factura: 'Ventas',
  anular_documento: 'Ventas',
  crear_egreso: 'Egresos',
  crear_egreso_turno: 'Egresos',
  eliminar_egreso: 'Egresos',
  editar_egreso: 'Egresos',
  abrir_turno: 'Turnos',
  cerrar_turno: 'Turnos',
  crear_producto: 'Inventario',
  editar_producto: 'Inventario',
  eliminar_producto: 'Inventario',
  ajuste_stock: 'Inventario',
  toma_inventario: 'Inventario',
  crear_venta_pendiente: 'Pedidos',
  cobrar_venta_pendiente: 'Pedidos',
  eliminar_venta_pendiente: 'Pedidos',
}

export default function Auditoria() {
  const { tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()

  const [logs, setLogs] = React.useState<AuditLog[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [filtroUsuario, setFiltroUsuario] = React.useState('')
  const [filtroAccion, setFiltroAccion] = React.useState('')
  const [filtroModulo, setFiltroModulo] = React.useState('')
  const [busqueda, setBusqueda] = React.useState('')
  const [vista, setVista] = React.useState<'actividad' | 'errores' | 'datos'>('actividad')

  const cargar = React.useCallback(async () => {
    setCargando(true)
    try {
      const data = await obtenerLogs({ maxResults: 500 })
      setLogs(data)
    } catch {
      toast('Error al cargar auditoría', 'error')
    }
    setCargando(false)
  }, [toast])

  React.useEffect(() => { cargar() }, [cargar])

  const usuarios = React.useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => { if (l.usuario) set.add(l.usuario) })
    return [...set].sort()
  }, [logs])

  const acciones = React.useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => { if (l.accion) set.add(l.accion) })
    return [...set].sort()
  }, [logs])

  const modulos = React.useMemo(() => {
    const set = new Set<string>()
    logs.forEach((l) => { const m = ACCION_MODULO[l.accion]; if (m) set.add(m) })
    return [...set].sort()
  }, [logs])

  const filtrados = React.useMemo(() => {
    return logs.filter((l) => {
      if (filtroUsuario && l.usuario !== filtroUsuario) return false
      if (filtroAccion && l.accion !== filtroAccion) return false
      if (filtroModulo && ACCION_MODULO[l.accion] !== filtroModulo) return false
      if (busqueda) {
        const q = busqueda.toLowerCase()
        const texto = `${l.usuario} ${l.accion} ${l.entidad} ${l.entidadId} ${JSON.stringify(l.detalle || {})}`.toLowerCase()
        if (!texto.includes(q)) return false
      }
      return true
    })
  }, [logs, filtroUsuario, filtroAccion, filtroModulo, busqueda])

  function exportar() {
    if (filtrados.length === 0) return toast('No hay datos para exportar', 'warning')
    const csv = logsToCSV(filtrados)
    const fecha = new Date().toISOString().slice(0, 10)
    descargarArchivo(csv, `auditoria_${fecha}.csv`)
    toast(`Exportados ${filtrados.length} registros`, 'success')
  }

  async function limpiar() {
    const ok = await confirm({
      title: 'Limpiar auditoría',
      message: 'Se eliminarán los registros de más de 90 días.\n\n¿Estás seguro?',
      okText: 'Eliminar',
    })
    if (!ok) return
    try {
      const eliminados = await limpiarLogs(90)
      toast(eliminados > 0 ? `Eliminados ${eliminados} registros antiguos` : 'No hay registros antiguos para eliminar', eliminados > 0 ? 'success' : 'warning')
      await cargar()
    } catch {
      toast('Error al limpiar', 'error')
    }
  }

  if (!tienePermiso('auditoria')) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <Shield className="mx-auto mb-3 h-10 w-10 opacity-40" />
        <p>No tienes acceso a Auditoría.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-bold"><Shield className="h-5 w-5 text-primary" /> Auditoría</h1>
        {vista === 'actividad' && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportar} disabled={filtrados.length === 0} className="shrink-0"><Download className="h-4 w-4" /> Exportar</Button>
            <Button variant="outline" size="sm" onClick={limpiar} className="shrink-0"><Trash2 className="h-4 w-4" /> Limpiar +90d</Button>
          </div>
        )}
      </div>

      {/* Actividad (lo que hacen los usuarios) vs Errores (lo que falla) */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {([{ id: 'actividad', label: 'Actividad', icon: History }, { id: 'errores', label: 'Errores', icon: AlertTriangle }, { id: 'datos', label: 'Mis Datos', icon: DatabaseBackup }] as const).map((t) => (
          <button
            key={t.id}
            onClick={() => setVista(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer',
              vista === t.id ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {vista === 'datos' ? (
        // 🔑 **Mis Datos** (decisión del usuario, 04/10/2026): la exportación de datos y el estado del
        // respaldo viven en **Auditoría**, no en Facturación — es donde se mira todo lo que tiene que ver
        // con la custodia de la información (qué se hizo y adónde está).
        <div className="space-y-3">
          <EstadoRespaldo />
          <ExportarDatos />
        </div>
      ) : vista === 'errores' ? (
        <ErroresPanel />
      ) : (
        <>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-9" />
        </div>
        <select value={filtroUsuario} onChange={(e) => setFiltroUsuario(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Todos los usuarios</option>
          {usuarios.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={filtroModulo} onChange={(e) => setFiltroModulo(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Todos los módulos</option>
          {modulos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select value={filtroAccion} onChange={(e) => setFiltroAccion(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Todas las acciones</option>
          {acciones.map((a) => <option key={a} value={a}>{ACCION_LABELS[a] || a}</option>)}
        </select>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Total: <strong className="num">{logs.length}</strong></span>
        <span>Filtrados: <strong className="num">{filtrados.length}</strong></span>
        <span>Usuarios: <strong className="num">{usuarios.length}</strong></span>
      </div>

      {/* Tabla */}
      {cargando ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtrados.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Sin registros</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/60">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2.5">Fecha / Hora</th>
                <th className="px-3 py-2.5">Usuario</th>
                <th className="px-3 py-2.5">Módulo</th>
                <th className="px-3 py-2.5">Acción</th>
                <th className="px-3 py-2.5">Entidad</th>
                <th className="px-3 py-2.5">ID</th>
                <th className="px-3 py-2.5">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((l) => {
                const fecha = l.timestamp ? new Date(l.timestamp) : null
                return (
                  <tr key={l.id} className="border-t border-border/60 hover:bg-muted/30">
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {fecha ? fecha.toLocaleDateString('es-PE') : '—'}
                      <br />
                      <span className="text-muted-foreground">{fecha ? fecha.toLocaleTimeString('es-PE') : ''}</span>
                    </td>
                    <td className="px-3 py-2 text-xs font-medium">{l.usuario}</td>
                    <td className="px-3 py-2 text-xs">{ACCION_MODULO[l.accion] || '—'}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', ACCION_COLORS[l.accion] || 'bg-gray-100 text-gray-700')}>
                        {ACCION_LABELS[l.accion] || l.accion}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.entidad}</td>
                    <td className="max-w-[120px] truncate px-3 py-2 font-mono text-[11px] text-muted-foreground" title={l.entidadId}>{l.entidadId}</td>
                    <td className="max-w-[200px] truncate px-3 py-2 text-xs text-muted-foreground" title={JSON.stringify(l.detalle || {})}>{l.detalle ? JSON.stringify(l.detalle) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  )
}
