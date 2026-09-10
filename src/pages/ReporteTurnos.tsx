import { CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ModalDetalleVenta } from '@/components/ModalDetalleVenta'
import { usePermisos } from '@/context/permisos'
import { calcularResumenMensual, cargarTodosLosTurnos, filtrarTurnosPorMes, obtenerRangoMes, type TurnoReporte } from '@/services/reportes'
import { cn } from '@/lib/utils'

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril',
  'Mayo', 'Junio', 'Julio', 'Agosto',
  'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]
const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

export function ReporteTurnos() {
  const { tienePermiso } = usePermisos()
  const hoy = new Date()
  const [turnos, setTurnos] = React.useState<TurnoReporte[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [filtro, setFiltro] = React.useState<'todos' | 'mañana' | 'tarde'>('todos')
  const [mes, setMes] = React.useState(hoy.getMonth())
  const [anio, setAnio] = React.useState(hoy.getFullYear())
  const [expandido, setExpandido] = React.useState<Record<string, boolean>>({})
  const [detalle, setDetalle] = React.useState<{ venta: any; serieNumero?: string; fecha?: string; tipoDoc?: string } | null>(null)

  const cambiarMes = (delta: number) => {
    let nuevoMes = mes + delta
    let nuevoAnio = anio
    if (nuevoMes < 0) {
      nuevoMes = 11
      nuevoAnio--
    }
    if (nuevoMes > 11) {
      nuevoMes = 0
      nuevoAnio++
    }
    setMes(nuevoMes)
    setAnio(nuevoAnio)
  }

  React.useEffect(() => {
    let activo = true
    setCargando(true)
    ;(async () => {
      try {
        const { inicio, fin } = obtenerRangoMes(mes, anio)
        const data = await cargarTodosLosTurnos(inicio, fin)
        if (activo) setTurnos(data)
      } catch (e) {
        console.error('❌ Error cargando turnos:', e)
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => {
      activo = false
    }
  }, [mes, anio])

  if (!tienePermiso('reporteTurnos')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <CalendarRange className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Reporte por Turnos</p>
        <p className="text-xs">Pedí el permiso «reporteTurnos» al administrador.</p>
      </div>
    )
  }

  const turnosFiltrados = filtrarTurnosPorMes(turnos, mes, anio, filtro)
  const resumen = calcularResumenMensual(turnosFiltrados)
  const totalCredito = Math.max(0, resumen.totalVentas - resumen.totalEfectivo - resumen.totalTransferencia)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Selector de mes */}
      <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card p-2 shadow-card">
        <Button variant="ghost" size="icon" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-[180px] text-center">
          <div className="text-lg font-extrabold text-primary">{MESES[mes]}</div>
          <div className="text-sm text-muted-foreground">{anio}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* Filtro por turno */}
      <div className="flex gap-1.5 rounded-xl bg-muted p-1">
        {(['todos', 'mañana', 'tarde'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFiltro(t)}
            className={cn('flex-1 rounded-lg py-2 text-sm font-bold transition-colors cursor-pointer', filtro === t ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
          >
            {t === 'todos' ? 'Todos' : t === 'mañana' ? '🌅 Mañana' : '🌙 Tarde'}
          </button>
        ))}
      </div>

      {cargando ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando turnos…</span>
        </div>
      ) : (
        <>
          {/* Resumen mensual */}
          <div className="overflow-hidden rounded-2xl brand-grad text-white shadow-card">
            <div className="p-5">
              <div className="mb-3 text-center text-sm font-bold uppercase tracking-wide text-white/90">
                📊 Resumen de {MESES[mes].toUpperCase()} {anio}
              </div>
              <div className="flex items-center justify-between border-b border-white/30 pb-3">
                <span className="text-sm text-white/80">Total Ventas</span>
                <span className="num text-xl font-bold">{fmt(resumen.totalVentas)}</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <div className="text-center">
                  <div className="num text-base font-bold">{fmt(resumen.totalEfectivo)}</div>
                  <div className="text-[11px] text-white/80">💵 Efectivo</div>
                </div>
                <div className="text-center">
                  <div className="num text-base font-bold">{fmt(resumen.totalTransferencia)}</div>
                  <div className="text-[11px] text-white/80">📲 Transferencia</div>
                </div>
                <div className="text-center">
                  <div className="num text-base font-bold">{fmt(totalCredito)}</div>
                  <div className="text-[11px] text-white/80">💳 Crédito</div>
                </div>
                <div className="text-center">
                  <div className="num text-base font-bold">{resumen.totalTransacciones}</div>
                  <div className="text-[11px] text-white/80">📄 Ventas</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-white/30 pt-3">
                <span className="text-sm text-white/80">💸 Gastos del mes</span>
                <span className="num font-bold text-red-100">{fmt(resumen.totalGastos)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg bg-white/15 px-3 py-2">
                <span className="text-sm font-bold">📊 Neto (Ventas - Gastos)</span>
                <span className="num text-lg font-bold">{fmt(resumen.totalNeto)}</span>
              </div>
              <div className="mt-3 text-center text-[11px] text-white/70">
                🗓️ {turnosFiltrados.length} turno{turnosFiltrados.length !== 1 ? 's' : ''} en el mes
              </div>
            </div>
          </div>

          {/* Lista de turnos */}
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
            <div className="border-b px-4 py-3">
              <span className="text-sm font-bold">📜 Turnos del mes</span>
              <Badge variant="secondary" className="ml-2">{turnosFiltrados.length}</Badge>
            </div>
            {turnosFiltrados.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <CalendarRange className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm font-medium">No hay turnos en este mes</p>
              </div>
            ) : (
              <div className="divide-y">
                {turnosFiltrados.map((turno) => {
                  const abierto = expandido[turno.id || '']
                  const ventas = turno.ventasDelTurno || []
                  return (
                    <div key={turno.id}>
                      <button onClick={() => setExpandido((p) => ({ ...p, [turno.id || '']: !p[turno.id || ''] }))} className="w-full px-4 py-3 text-left text-sm hover:bg-muted/40 cursor-pointer">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-semibold">{new Date(turno.fechaApertura || '').toLocaleDateString('es-PE')}</div>
                            <div className="truncate text-xs text-muted-foreground">👤 {turno.usuarioNombre || 'Usuario'}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={turno.tipoTurno === 'tarde' ? 'warning' : 'success'}>
                              {turno.tipoTurno === 'tarde' ? '🌙 Tarde' : '🌅 Mañana'}
                            </Badge>
                            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', abierto && 'rotate-180')} />
                          </div>
                        </div>
                        <div className="mt-2 flex items-center justify-around border-t border-b border-border/60 py-2">
                          <div className="text-center">
                            <div className="num font-bold text-primary">{fmt(turno.totalVentas || 0)}</div>
                            <div className="text-[10px] text-muted-foreground">Ventas</div>
                          </div>
                          <div className="text-center">
                            <div className="num font-bold text-primary">{ventas.length}</div>
                            <div className="text-[10px] text-muted-foreground">Transacciones</div>
                          </div>
                        </div>
                        <div className="mt-1 text-right text-[11px] text-muted-foreground">
                          🕐 {turno.fechaApertura ? new Date(turno.fechaApertura).toLocaleTimeString('es-PE') : ''}
                        </div>
                      </button>

                      {abierto && (
                        <div className="border-t bg-muted/20 px-4 py-2">
                          {ventas.length === 0 ? (
                            <p className="py-6 text-center text-xs text-muted-foreground">Sin comprobantes en este turno</p>
                          ) : (
                            <div className="divide-y">
                              {ventas.map((v: any, i) => {
                                const anulada = v.estado === 'anulada'
                                const tipo = v.tipoPago || 'efectivo'
                                const tipoLabel = tipo === 'efectivo' ? '💵 Efectivo' : tipo === 'transferencia' ? '📲 Transferencia' : '💳 Crédito'
                                return (
                                  <div key={v.id || i} onClick={() => setDetalle({ venta: v, serieNumero: v.serie_numero || v.serieNumero, fecha: v.fecha, tipoDoc: v.tipoDoc })} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-xs transition-colors hover:bg-muted/40">
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate font-semibold">{v.serie_numero || v.serieNumero || '-'}</div>
                                      <div className="truncate text-muted-foreground">{v.cliente_nombre && v.cliente_nombre !== '-' ? v.cliente_nombre : 'Consumidor'}</div>
                                    </div>
                                    <div className="text-right">
                                      <div className={cn('num font-bold', anulada && 'line-through text-muted-foreground')}>{fmt(v.total ?? 0)}</div>
                                      <div className={cn('text-[10px]', anulada ? 'text-red-600' : 'text-muted-foreground')}>{anulada ? '🗑️ Anulada' : tipoLabel}</div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {detalle && (
        <ModalDetalleVenta
          venta={detalle.venta}
          serieNumero={detalle.serieNumero}
          fecha={detalle.fecha}
          tipoDoc={detalle.tipoDoc}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  )
}
