import { Banknote, Calculator, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, FileText, Loader2, Search } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePermisos } from '@/context/permisos'
import { useAuth } from '@/context/auth'
import { obtenerArqueoDelDia } from '@/services/reportes'
import { rectificarTurno } from '@/services/turnos'
import { cn } from '@/lib/utils'
import { abrirPDFArqueo, type TurnoArqueo } from '@/lib/pdf'
import { diagnosticarDiferencia, type Diagnostico } from '@/lib/diagnosticos'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { lineasDeOrigen, type ConciliacionMedios, type DesgloseBolsillo, type DesgloseTurno } from '@/lib/arqueo'

const MESES_CORTO = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC']
const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)
const parseDecimal = (s: string) => parseFloat(String(s).replace(',', '.')) || 0

const formatearFechaLarga = (fecha: Date) => {
  const texto = fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

export function ArqueoCaja() {
  // Empresa para el encabezado de los PDF (nombre, RUC, dirección).
  const { config } = useConfiguracion()
  const { tienePermiso } = usePermisos()
  const { user } = useAuth()
  const verTodo = tienePermiso('verTodo')
  const miUid = verTodo ? undefined : (user?.uid || undefined)
  const hoy = new Date()
  const [fechaSel, setFechaSel] = React.useState(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()))
  const [arqueo, setArqueo] = React.useState<{ numCierres: number; numTurnos: number; totalVentas: number; totalEfectivo: number; totalTransferencia: number; totalGastos: number; totalGastosEfectivo: number; montoInicialTotal: number; efectivoEsperadoTotal: number; efectivoContadoTotal: number; diferenciaTotal: number; totalNeto: number; numTransacciones: number; desgloseDia: DesgloseTurno; turnos: TurnoArqueo[] } | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [expandidos, setExpandidos] = React.useState<Record<string, boolean>>({})
  const [contados, setContados] = React.useState<Record<string, string>>({})
  const [turnoRectificar, setTurnoRectificar] = React.useState<TurnoArqueo | null>(null)
  const [montoRectificar, setMontoRectificar] = React.useState('')
  const [motivoRectificacion, setMotivoRectificacion] = React.useState('')
  const [procesandoRectificacion, setProcesandoRectificacion] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)

  const esHoy = fechaSel.toDateString() === hoy.toDateString()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const cambiarDia = (delta: number) => {
    setFechaSel(new Date(fechaSel.getFullYear(), fechaSel.getMonth(), fechaSel.getDate() + delta))
  }

  const irAFecha = (fecha: Date) => {
    setFechaSel(new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate()))
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

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  async function onRectificar() {
    if (!user || !turnoRectificar?.id) return
    const montoReal = parseFloat(montoRectificar)
    if (isNaN(montoReal) || montoReal < 0) {
      setToast('⚠️ Ingrese un monto válido')
      return
    }
    if (!motivoRectificacion.trim()) {
      setToast('⚠️ Ingrese el motivo')
      return
    }
    setProcesandoRectificacion(true)
    const r = await rectificarTurno({
      turnoId: turnoRectificar.id,
      montoInicialReal: montoReal,
      motivo: motivoRectificacion.trim(),
      usuarioId: user.uid,
      usuarioNombre: user.email?.split('@')[0] || 'Usuario',
    })
    setProcesandoRectificacion(false)
    if (r.success) {
      setToast('✅ Turno rectificado')
      setTurnoRectificar(null)
      setMontoRectificar('')
      setMotivoRectificacion('')
      const resultado = await obtenerArqueoDelDia(fechaSel, miUid)
      if (resultado.success) setArqueo(resultado as any)
    } else {
      setToast('❌ ' + (r.error || 'Error'))
    }
  }

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
        <button
          onClick={() => inputRef.current?.showPicker()}
          className="flex-1 cursor-pointer text-center hover:opacity-80 transition-opacity"
        >
          <div className="text-sm font-bold">{formatearFechaLarga(fechaSel)}</div>
          <div className="mt-1 flex items-center justify-center gap-2">
            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {MESES_CORTO[fechaSel.getMonth()]} {fechaSel.getFullYear()}
            </span>
            {esHoy && (
              <span className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">HOY</span>
            )}
          </div>
        </button>
        <input
          ref={inputRef}
          type="date"
          value={fechaSel.toISOString().split('T')[0]}
          onChange={(e) => {
            if (e.target.value) {
              const [y, m, d] = e.target.value.split('-').map(Number)
              irAFecha(new Date(y, m - 1, d))
            }
          }}
          className="sr-only"
          aria-label="Seleccionar fecha"
        />
        <Button variant="ghost" size="icon" onClick={() => cambiarDia(1)} aria-label="Día siguiente">
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {arqueo && arqueo.turnos.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => abrirPDFArqueo({ fecha: fechaSel, turnos: arqueo.turnos, empresa: config, resumen: { totalVentas: arqueo.totalVentas, totalEfectivo: arqueo.totalEfectivo, totalTransferencia: arqueo.totalTransferencia, totalGastos: arqueo.totalGastos, totalNeto: arqueo.totalNeto, numTurnos: arqueo.numTurnos, numCierres: arqueo.numCierres, numTransacciones: arqueo.numTransacciones, montoInicialTotal: arqueo.montoInicialTotal, efectivoEsperadoTotal: arqueo.efectivoEsperadoTotal, efectivoContadoTotal: arqueo.efectivoContadoTotal, diferenciaTotal: arqueo.diferenciaTotal } })}>
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
          <OrigenesCorto desglose={arqueo?.desgloseDia?.efectivo} />
        </div>
        <div className="rounded-2xl border bg-card p-4 shadow-card">
          <div className="text-xs text-muted-foreground">📲 Transferencia</div>
          <div className="num mt-1 font-bold">{fmt(arqueo?.totalTransferencia ?? 0)}</div>
          <OrigenesCorto desglose={arqueo?.desgloseDia?.transferencia} />
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

      {
        /* Cierre del día: el consolidado que antes se calculaba y se tiraba.
           Solo tiene sentido si hay al menos un turno cerrado (si no, no hay "contado"). */
        (arqueo?.numCierres ?? 0) > 0 && (
          <div className="rounded-2xl border bg-card shadow-card">
            <div className="border-b px-4 py-3">
              <span className="text-sm font-bold">Caja del día</span>
              <span className="ml-2 text-[11px] text-muted-foreground">
                (solo turnos cerrados: {arqueo?.numCierres}
                {(arqueo?.numTurnos ?? 0) > (arqueo?.numCierres ?? 0)
                  ? ` de ${arqueo?.numTurnos} — el resto sigue abierto y todavía no se contó`
                  : ''}
                )
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
              <Mini label="Fondo inicial" value={fmt(arqueo?.montoInicialTotal ?? 0)} />
              <Mini label="Efectivo esperado" value={fmt(arqueo?.efectivoEsperadoTotal ?? 0)} />
              <Mini label="Efectivo contado" value={fmt(arqueo?.efectivoContadoTotal ?? 0)} />
              <Mini
                label="Diferencia"
                value={fmt(arqueo?.diferenciaTotal ?? 0)}
                accent={Math.abs(arqueo?.diferenciaTotal ?? 0) > 0.009}
              />
            </div>
            <div className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              La caja cuadra <b>solo el efectivo</b>: las transferencias (Yape, Plin, tarjeta) se concilian aparte.
            </div>
          </div>
        )
      }

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
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Monto inicial</span>
                      <div className="flex items-center gap-2">
                        <span className="num font-semibold">{fmt(turno.montoInicial)}</span>
                        {!abierto && tienePermiso('rectificarTurno') && (
                          <button
                            onClick={() => {
                              setMontoRectificar(String(turno.montoInicial))
                              setMotivoRectificacion('')
                              setTurnoRectificar(turno)
                            }}
                            className="text-xs text-primary hover:underline cursor-pointer"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    </div>
                    <Row label="Efectivo (cajón)" value={'+ ' + fmt(turno.totalEfectivo)} valueClass="text-emerald-600" />
                    <Origenes desglose={turno.desglose?.efectivo} className="pl-3" />
                    <Row label="Transferencia" value={fmt(turno.totalTransferencia)} />
                    <Origenes desglose={turno.desglose?.transferencia} className="pl-3" />
                    <ConciliacionBilleteras conciliacion={turno.conciliacion} />
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
                        {contadoIngresado && !diffTurnoOk && (
                          <DiagnosticoPanel
                            diags={diagnosticarDiferencia({
                              montoInicial: turno.montoInicial,
                              totalEfectivo: turno.totalEfectivo,
                              totalTransferencia: turno.totalTransferencia,
                              totalGastosEfectivo: turno.totalGastosEfectivo,
                              efectivoEsperado: turno.efectivoEsperado,
                              efectivoContado: contado,
                              comprobantes: turno.comprobantes,
                              gastosDelTurno: turno.gastosDelTurno,
                            })}
                          />
                        )}
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

                        {/* Diagnóstico inteligente */}
                        {!diffTurnoOk && (
                          <DiagnosticoPanel
                            diags={diagnosticarDiferencia({
                              montoInicial: turno.montoInicial,
                              totalEfectivo: turno.totalEfectivo,
                              totalTransferencia: turno.totalTransferencia,
                              totalGastosEfectivo: turno.totalGastosEfectivo,
                              efectivoEsperado: turno.efectivoEsperado,
                              efectivoContado: turno.efectivoContado,
                              comprobantes: turno.comprobantes,
                              gastosDelTurno: turno.gastosDelTurno,
                            })}
                          />
                        )}
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
                          <div key={comp.id || comp.serieNumero || idx} className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border/60 bg-background px-3 py-2">
                            <div className="min-w-[7.5rem]">
                              <div className="num whitespace-nowrap text-xs font-bold text-indigo-600">{comp.serieNumero || 'S/C'}</div>
                              <div className="truncate text-[11px] text-muted-foreground">{comp.clienteNombre}</div>
                              {comp.vendedorNombre && comp.vendedorNombre !== '-' ? (
                                <div className="text-[10px] text-muted-foreground">👤 {comp.vendedorNombre}</div>
                              ) : null}
                              {comp.fecha ? (
                                <div className="text-[10px] text-muted-foreground">{new Date(comp.fecha).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}</div>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="num text-xs font-bold">{fmt(comp.total)}</div>
                              <Badge variant={comp.esCobro ? 'warning' : comp.tipoPago === 'efectivo' ? 'success' : comp.tipoPago === 'credito' ? 'warning' : 'secondary'} className="mt-1">
                                {comp.esCobro
                                  ? `${comp.tipoPago === 'efectivo' ? '💵 Efectivo' : comp.tipoPago === 'transferencia' ? '📲 Transferencia' : comp.tipoPago === 'yape' ? '📱 Yape' : comp.tipoPago === 'plin' ? '📱 Plin' : '💳 Crédito'} · Op: ${comp.operacion || 'SN'}`
                                  : comp.tipoPago === 'efectivo' ? '💵 EFECTIVO' : comp.tipoPago === 'credito' ? '💳 CRÉDITO' : '📲 TRANSF'}
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

      {/* Modal Rectificar Turno */}
      {turnoRectificar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTurnoRectificar(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-bold">📝 Rectificar Monto Inicial</h3>
            <div className="space-y-3">
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <div className="text-muted-foreground">Turno</div>
                <div className="font-bold">{turnoRectificar.usuarioNombre} · {turnoRectificar.tipoTurno === 'tarde' ? '🌙 Tarde' : '🌅 Mañana'}</div>
              </div>
              <div className="rounded-lg bg-muted/60 p-3 text-sm">
                <div className="text-muted-foreground">Monto inicial registrado</div>
                <div className="font-bold">{fmt(turnoRectificar.montoInicial)}</div>
              </div>
              <div>
                <Label>Monto inicial real (S/)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={montoRectificar}
                  onChange={(e) => setMontoRectificar(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Motivo de la rectificación</Label>
                <Input
                  value={motivoRectificacion}
                  onChange={(e) => setMotivoRectificacion(e.target.value)}
                  placeholder="Ej: Cajero olvidó ingresar monto inicial"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setTurnoRectificar(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={onRectificar} disabled={procesandoRectificacion}>
                  {procesandoRectificacion ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Rectificar'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={cn('pointer-events-none fixed bottom-16 left-1/2 z-50 -translate-x-1/2 transition-opacity', toast ? 'opacity-100' : 'opacity-0')}>
        <div className="rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-white shadow-lg">{toast}</div>
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

/**
 * Líneas de origen de un bolsillo (· ventas · cobranza de crédito · notas).
 *
 * El total del bolsillo es la plata que entró al cajón o a la billetera (y contra eso se
 * concilia), pero **no todo es venta del día**: una cobranza de crédito es plata de una
 * deuda anterior. Los orígenes que están en cero no se muestran, así que en el caso normal
 * (todo ventas) no aparece ninguna línea extra.
 */
function Origenes({ desglose, className }: { desglose?: DesgloseBolsillo; className?: string }) {
  if (!desglose) return null
  const lineas = lineasDeOrigen(desglose).filter((l) => l.origen !== 'ventas')
  if (lineas.length === 0) return null
  return (
    <div className={cn('space-y-0.5', className)}>
      {lineas.map((l) => (
        <div key={l.origen} className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-muted-foreground">
            {l.origen === 'cobranzas' ? '↳ cobranza de crédito' : '↳ notas (NC/ND)'}
          </span>
          <span className={cn('num font-semibold', l.monto < 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-500')}>
            {l.monto < 0 ? '- ' : ''}
            {fmt(Math.abs(l.monto))}
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-muted-foreground/70">↳ ventas del día</span>
        <span className="num text-muted-foreground">{fmt(desglose.ventas)}</span>
      </div>
    </div>
  )
}

/**
 * Conciliación por billetera declarada al cerrar: lo que dice el sistema vs lo que
 * realmente llegó a Yape/Plin/tarjeta. Solo se muestra si el cajero declaró algo
 * (es un control **opcional** del cierre).
 */
function ConciliacionBilleteras({ conciliacion }: { conciliacion?: ConciliacionMedios }) {
  const filas = Object.entries(conciliacion ?? {}).filter(([, v]) => v.declarado !== 0)
  if (filas.length === 0) return null
  return (
    <div className="mt-1 rounded-lg border border-border/60 bg-background px-3 py-2">
      <div className="text-[11px] font-bold text-muted-foreground">Conciliación con la billetera</div>
      {filas.map(([medio, v]) => (
        <div key={medio} className="flex items-center justify-between text-[11px]">
          <span className="capitalize text-muted-foreground">{medio}</span>
          <span className="num">
            <span className="text-muted-foreground">sistema {fmt(v.sistema)} · declarado {fmt(v.declarado)} · </span>
            <span className={cn('font-bold', v.diferencia === 0 ? 'text-emerald-600' : 'text-destructive')}>
              {v.diferencia === 0 ? 'OK' : `dif ${fmt(v.diferencia)}`}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Versión de una línea para las tarjetas del encabezado del día (achicada). */
function OrigenesCorto({ desglose }: { desglose?: DesgloseBolsillo }) {  if (!desglose) return null
  const partes = lineasDeOrigen(desglose)
  if (partes.length <= 1) return null
  return (
    <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
      {partes.map((p) => `${p.label} ${fmt(p.monto)}`).join(' · ')}
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

function DiagnosticoPanel({ diags }: { diags: Diagnostico[] }) {
  if (diags.length === 0) return null
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground">
        <Search className="h-3 w-3" /> Diagnóstico
      </div>
      {diags.map((d, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg px-3 py-2 text-xs',
            d.tipo === 'ok' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
            d.tipo === 'pista' && 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
            d.tipo === 'alerta' && 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300',
          )}
        >
          {d.icono} {d.texto}
        </div>
      ))}
    </div>
  )
}
