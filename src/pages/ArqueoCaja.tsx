import { Banknote, Calculator, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Loader2 } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { obtenerArqueoDelDia } from '@/services/reportes'
import { cn } from '@/lib/utils'
import { abrirPDFArqueo, type TurnoArqueo } from '@/lib/pdf'

const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)
const parseDecimal = (s: string) => parseFloat(String(s).replace(',', '.')) || 0

const formatearFechaLarga = (fecha: Date) => {
  const texto = fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function ArqueoCaja() {
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? undefined : (user?.uid || undefined)
  const hoy = new Date()
  const [fechaSel, setFechaSel] = React.useState(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()))
  const [arqueo, setArqueo] = React.useState<{ numCierres: number; numTurnos: number; totalVentas: number; totalEfectivo: number; totalTransferencia: number; totalGastos: number; totalGastosEfectivo: number; montoInicialTotal: number; efectivoEsperadoTotal: number; efectivoContadoTotal: number; diferenciaTotal: number; totalNeto: number; numTransacciones: number; turnos: TurnoArqueo[] } | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [expandidos, setExpandidos] = React.useState<Record<string, boolean>>({})
  const [contados, setContados] = React.useState<Record<string, string>>({})

  const esHoy = fechaSel.toDateString() === hoy.toDateString()

  const cambiarDia = (delta: number) => {
    setFechaSel(new Date(fechaSel.getFullYear(), fechaSel.getMonth(), fechaSel.getDate() + delta))
  }

  React.useEffect(() => {
    let activo = true
    setCargando(true)
    ;(async () => {
      try {
        const resultado = await obtenerArqueoDelDia(fechaSel, miUid)
        if (activo) setArqueo(resultado.success ? (resultado as any) : null)
      } catch (e) {
        console.error('❌ Error al cargar arqueo:', e)
        if (activo) setArqueo(null)
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => {
      activo = false
    }
  }, [fechaSel, miUid])

  const toggleTurno = (id: string) => {
    setExpandidos((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (!tienePermiso('arqueoCaja')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Banknote className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso al módulo de Arqueo de Caja</p>
        <p className="text-xs">Pedí el permiso «arqueoCaja» al administrador.</p>
      </div>
    )
  }

  if (cargando) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 py-24 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="text-sm">Cargando arqueo de caja…</span>
      </div>
    )
  }

  const sinTurnos = !arqueo || arqueo.turnos.length === 0

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Selector de fecha */}
      <div className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-2 shadow-card">
        <Button variant="ghost" size="icon" onClick={() => cambiarDia(-1)} aria-label="Día anterior">
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 text-center">
          <div className="text-sm font-bold">{formatearFechaLarga(fechaSel)}</div>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {MESES_CORTO[fechaSel.getMonth()]} {fechaSel.getFullYear()}
            </span>
            {esHoy && (
              <span className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">HOY</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={() => cambiarDia(1)} aria-label="Día siguiente">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {arqueo && arqueo.turnos.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => abrirPDFArqueo({ fecha: fechaSel, turnos: arqueo.turnos, resumen: { totalVentas: arqueo.totalVentas, totalEfectivo: arqueo.totalEfectivo, totalTransferencia: arqueo.totalTransferencia, totalGastos: arqueo.totalGastos, totalNeto: arqueo.totalNeto, numTurnos: arqueo.numTurnos, numTransacciones: arqueo.numTransacciones, montoInicialTotal: arqueo.montoInicialTotal, efectivoEsperadoTotal: arqueo.efectivoEsperadoTotal, efectivoContadoTotal: arqueo.efectivoContadoTotal, diferenciaTotal: arqueo.diferenciaTotal } })}>
            <FileText className="mr-2 h-4 w-4" /> Exportar PDF
          </Button>
        </div>
      )}

      {/* Hero: arqueo del día (por turnos aperturados) */}
      <div className="brand-grad overflow-hidden rounded-2xl text-white shadow-card">
        <div className="p-5">
          <div className="text-xs font-medium uppercase tracking-widest text-white/80">Arqueo del día · Ventas</div>
          <div className="num mt-1 text-3xl font-bold">{fmt(arqueo?.totalVentas ?? 0)}</div>
          <div className="mt-4 flex items-center border-t border-white/25 pt-3">
            <div className="flex flex-1 items-center gap-2">
              <span className="text-sm font-bold">{arqueo?.numTransacciones ?? 0}</span>
              <span className="text-[11px] text-white/75">Ventas</span>
            </div>
            <div className="h-6 w-px bg-white/30" />
            <div className="flex flex-1 items-center gap-2 pl-4">
              <span className="text-sm font-bold">{arqueo?.numTurnos ?? 0}</span>
              <span className="text-[11px] text-white/75">Turnos</span>
            </div>
          </div>
          {sinTurnos && <p className="mt-3 text-xs text-white/75">No hay turnos aperturados este día.</p>}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">💵 Efectivo</div>
          <div className="num mt-1 font-bold">{fmt(arqueo?.totalEfectivo ?? 0)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">📲 Transferencia</div>
          <div className="num mt-1 font-bold">{fmt(arqueo?.totalTransferencia ?? 0)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">💸 Gastos</div>
          <div className="num mt-1 font-bold text-destructive">{fmt(arqueo?.totalGastos ?? 0)}</div>
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">📊 Neto</div>
          <div className="num mt-1 font-bold">{fmt(arqueo?.totalNeto ?? 0)}</div>
        </div>
      </div>

      {/* Turnos del día (por fecha de apertura) */}
      <div className="rounded-2xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Banknote className="h-4 w-4 text-indigo-600" />
            </div>
            <span className="text-sm font-bold">Turnos del día</span>
            <span className="text-[11px] text-muted-foreground">(por apertura)</span>
          </div>
          <span className="num text-sm font-bold text-primary">{arqueo?.numTurnos ?? 0}</span>
        </div>

        {sinTurnos ? (
          <div className="py-16 text-center text-muted-foreground">
            <Calculator className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium">Sin turnos aperturados</p>
            <p className="text-xs">Este día aún no se aperturó ningún turno de caja.</p>
          </div>
        ) : (
          arqueo!.turnos.map((turno) => {
            const expandido = !!expandidos[turno.id]
            const abierto = turno.estado === 'abierto'
            const esManana = turno.tipoTurno === 'mañana'
            const contado = abierto ? parseDecimal(contados[turno.id] ?? '') : (turno.efectivoContado || 0)
            const diffTurno = contado - turno.efectivoEsperado
            const diffTurnoOk = Math.abs(diffTurno) < 0.01
            const contadoIngresado = abierto ? contados[turno.id] !== undefined && contados[turno.id] !== '' : true
            return (
              <div key={turno.id} className="border-b border-border/60 last:border-0">
                <button onClick={() => toggleTurno(turno.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 cursor-pointer">
                  <Badge variant={abierto ? 'warning' : esManana ? 'success' : 'secondary'}>
                    {abierto ? '🔓 ABIERTO' : esManana ? '🌅 MAÑANA' : '🌙 TARDE'}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{turno.usuarioNombre}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {turno.fechaApertura ? 'Apertura ' + new Date(turno.fechaApertura).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
                      {turno.fechaCierre ? ' · Cierre ' + new Date(turno.fechaCierre).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
                    </div>
                  </div>
                  {expandido ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>

                <div className="grid grid-cols-4 gap-2 border-y border-border/60 px-4 py-2 text-center">
                  <Mini label="Ventas" value={fmt(turno.totalVentas)} />
                  <Mini label="N° Ventas" value={String(turno.numVentas)} />
                  <Mini label="Esperado" value={fmt(turno.efectivoEsperado)} />
                  <Mini label="Diferencia" value={contadoIngresado ? (diffTurnoOk ? 'S/ 0.00' : diffTurno > 0 ? `+ ${fmt(diffTurno)}` : fmt(diffTurno)) : '—'} accent={contadoIngresado && !diffTurnoOk} />
                </div>

                {expandido && (
                  <div className="space-y-2 px-4 py-3">
                    <Row label="Monto inicial" value={fmt(turno.montoInicial)} />
                    <Row label="Ventas efectivo" value={'+ ' + fmt(turno.totalEfectivo)} valueClass="text-emerald-600" />
                    <Row label="Ventas transferencia" value={fmt(turno.totalTransferencia)} />
                    <Row label="Gastos en efectivo" value={'- ' + fmt(turno.totalGastosEfectivo)} valueClass="text-destructive" />
                    {turno.gastosDelTurno.filter((g) => g.tipoPago === 'caja').length > 0 && (
                      <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                        <div className="mb-1.5 text-[11px] font-bold text-muted-foreground">Detalle gastos (caja)</div>
                        {turno.gastosDelTurno.filter((g) => g.tipoPago === 'caja').map((g, i) => (
                          <div key={i} className="flex items-center justify-between py-1 text-xs">
                            <div className="min-w-0 flex-1">
                              <span className="font-medium">{g.descripcion}</span>
                              <span className="ml-1.5 text-[10px] text-muted-foreground">({g.categoria})</span>
                            </div>
                            <span className="num font-semibold text-destructive">- {fmt(g.monto)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-1.5 text-xs">
                      <span className="font-semibold text-primary">Efectivo esperado</span>
                      <span className="num font-bold text-primary">{fmt(turno.efectivoEsperado)}</span>
                    </div>

                    {abierto ? (
                      <div className="rounded-lg border border-dashed p-3">
                        <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                          Efectivo contado (vista previa del cuadre antes de cerrar)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            value={contados[turno.id] ?? ''}
                            onChange={(e) => setContados((p) => ({ ...p, [turno.id]: e.target.value }))}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="h-8 w-32 rounded border px-2 text-right text-sm"
                          />
                          <span className={cn('text-sm font-bold', contadoIngresado ? (diffTurnoOk ? 'text-emerald-600' : 'text-destructive') : 'text-muted-foreground')}>
                            {contadoIngresado ? (diffTurnoOk ? '✓ Cuadra' : `Diferencia ${diffTurno > 0 ? '+ ' : ''}${fmt(diffTurno)}`) : '—'}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          Turno aún <b>abierto</b>: podés ir verificando si el efectivo cuadra. Al cerrarlo se registra el contado definitivo.
                        </p>
                      </div>
                    ) : (
                      <>
                        <Row label="Efectivo contado" value={fmt(turno.efectivoContado)} />
                        <div className={cn('flex items-center justify-between rounded-lg px-3 py-1.5 text-xs', diffTurnoOk ? 'bg-emerald-50 dark:bg-emerald-500/10' : 'bg-red-50 dark:bg-red-500/10')}>
                          <span className={cn('font-medium', diffTurnoOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive')}>
                            {diffTurnoOk ? 'Sin diferencia' : 'Diferencia'}
                          </span>
                          <span className={cn('num font-bold', diffTurnoOk ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive')}>
                            {diffTurnoOk ? 'S/ 0.00' : diffTurno > 0 ? `+ ${fmt(diffTurno)}` : fmt(diffTurno)}
                          </span>
                        </div>
                      </>
                    )}

                    {turno.observaciones ? (
                      <div className="rounded-lg bg-card px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Observaciones:</span> {turno.observaciones}
                      </div>
                    ) : null}

                    {turno.comprobantes.length > 0 && (
                      <div className="border-t border-border/60 pt-2">
                        <div className="mb-2 text-xs font-bold text-muted-foreground">🧾 Comprobantes ({turno.comprobantes.length})</div>
                        {turno.comprobantes.map((comp, idx) => (
                          <div key={comp.id || comp.serieNumero || idx} className="mb-1.5 flex items-center justify-between rounded-lg border border-border/60 bg-background px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-xs font-bold text-indigo-600">{comp.serieNumero || 'S/C'}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{comp.clienteNombre}</div>
                              {comp.fecha ? (
                                <div className="text-[10px] text-muted-foreground">{new Date(comp.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</div>
                              ) : null}
                            </div>
                            <div className="text-right">
                              <div className="num text-xs font-bold">{fmt(comp.total)}</div>
                              <Badge variant={comp.esCobro ? 'warning' : comp.tipoPago === 'efectivo' ? 'success' : comp.tipoPago === 'credito' ? 'warning' : 'secondary'} className="mt-1">
                                {comp.esCobro ? '💸 COBRO' : comp.tipoPago === 'efectivo' ? '💵 EFECTIVO' : comp.tipoPago === 'credito' ? '💳 CRÉDITO' : '📲 TRANSF'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('num font-semibold', valueClass)}>{value}</span>
    </div>
  )
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className={cn('num text-xs font-bold', accent ? 'text-destructive' : 'text-foreground')}>{value}</div>
    </div>
  )
}
