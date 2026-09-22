import { Clock, Loader2, Lock, LockOpen, Truck } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { CierreCaja } from '@/components/CierreCaja'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { abrirTurno, buscarTurnoAbierto, cerrarTurno, editarMontoInicial, type Turno } from '@/services/turnos'
import { obtenerEnviosPendientesAnteriores, actualizarEstadoEnvio, type EnvioPendiente, type EnvioEstado } from '@/services/envios'
import { obtenerPagosYapeDelTurno } from '@/services/yape'
import type { PagoYape } from '@/lib/yape'
import { cn } from '@/lib/utils'
import { desglosarTurno, lineasDeOrigen, type DesgloseTurno } from '@/lib/arqueo'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

export function Turnos() {
  const { user } = useAuth()
  const { tienePermiso, cajaId } = usePermisos()
  // `config.conteoCiego` (Configuración → Empresa): oculta el "Debería haber" hasta que el
  // cajero registre el conteo.
  const { config } = useConfiguracion()
  const [turno, setTurno] = React.useState<Turno | null>(null)
  const esDueno = !!turno?.usuarioId && turno.usuarioId === user?.uid
  const esSupervisor = tienePermiso('verTodo')
  const [cargando, setCargando] = React.useState(true)
  const [tipoTurno, setTipoTurno] = React.useState('mañana')
  const [montoInicial, setMontoInicial] = React.useState('')
  const [procesando, setProcesando] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)
  const [editandoMonto, setEditandoMonto] = React.useState(false)
  const [nuevoMontoInicial, setNuevoMontoInicial] = React.useState('')
  const [enviosAnteriores, setEnviosAnteriores] = React.useState<EnvioPendiente[]>([])
  /** Avisos de Yape **confirmados en este turno** (para el cruce del cierre). `null` = leyendo. */
  const [pagosYapeTurno, setPagosYapeTurno] = React.useState<PagoYape[] | null>(null)
  const [mostrarEnvios, setMostrarEnvios] = React.useState(false)
  const [cargandoEnvios, setCargandoEnvios] = React.useState(false)
  const [envioActualizando, setEnvioActualizando] = React.useState<string | null>(null)

  // Envíos del turno actual
  const enviosTurnoActual = React.useMemo(() => {
    return (turno?.ventasDelTurno ?? []).filter(
      (v: Record<string, any>) => v.envio?.tipo === 'domicilio' && v.envio?.estado !== 'entregado' && v.estado !== 'anulada'
    )
  }, [turno])

  // Cargar envíos pendientes de turnos anteriores
  React.useEffect(() => {
    if (!turno) return
    let cancel = false
    ;(async () => {
      setCargandoEnvios(true)
      try {
        const anteriores = await obtenerEnviosPendientesAnteriores(turno.id)
        if (!cancel) setEnviosAnteriores(anteriores)
      } catch {
        // silenciar
      } finally {
        if (!cancel) setCargandoEnvios(false)
      }
    })()
    return () => { cancel = true }
  }, [turno])

  // 🔑 Avisos de Yape confirmados en este turno: es lo que el sistema puede afirmar que entró por
  // Yape **con un aviso detrás**, para cruzarlo contra los cobros por Yape del turno al cerrar.
  // Se leen al abrir el turno (no en vivo): el cierre es una foto del momento.
  React.useEffect(() => {
    if (!turno?.id) return
    let cancel = false
    ;(async () => {
      setPagosYapeTurno(null) // «leyendo»: el cierre no puede decir «no llegó ningún aviso» antes de saber
      const avisos = await obtenerPagosYapeDelTurno(turno.fechaApertura)
      if (!cancel) setPagosYapeTurno(avisos)
    })()
    return () => { cancel = true }
  }, [turno?.id, turno?.fechaApertura])

  async function onCambiarEstadoEnvio(envio: EnvioPendiente | { docId: string; turnoId?: string; serieNumero: string }, nuevoEstado: EnvioEstado) {
    setEnvioActualizando(envio.docId)
    const r = await actualizarEstadoEnvio({
      docId: envio.docId,
      turnoId: envio.turnoId || turno?.id,
      serieNumero: envio.serieNumero,
      nuevoEstado,
    })
    setEnvioActualizando(null)
    if (r.success) {
      if (nuevoEstado === 'entregado' || nuevoEstado === 'cancelado') {
        setEnviosAnteriores((prev) => prev.filter((e) => e.docId !== envio.docId))
      } else {
        setEnviosAnteriores((prev) => prev.map((e) => e.docId === envio.docId ? { ...e, envio: { ...e.envio, estado: nuevoEstado } } : e))
      }
      setToast(`✅ Envío ${nuevoEstado === 'en_camino' ? 'en camino' : nuevoEstado === 'entregado' ? 'entregado' : 'cancelado'}`)
    } else {
      setToast('❌ ' + (r.error || 'Error'))
    }
  }

  function estadoBadge(estado: EnvioEstado) {
    if (estado === 'pendiente') return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">🟡 Pendiente</span>
    if (estado === 'en_camino') return <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">🔵 En camino</span>
    if (estado === 'entregado') return <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">🟢 Entregado</span>
    return <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900/30 dark:text-red-400">🔴 Cancelado</span>
  }

  function EnvioCard({ envio, esDelTurno }: { envio: EnvioPendiente | { docId: string; turnoId?: string; serieNumero: string; clienteNombre?: string; envio: { direccion: string; referencia?: string; notas?: string; estado: EnvioEstado; costo: number } }; esDelTurno?: boolean }) {
    const actualizando = envioActualizando === envio.docId
    return (
      <div className="rounded-xl border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-[7.5rem] flex-1">
            <div className="num whitespace-nowrap text-xs font-bold">{envio.serieNumero}</div>
            <div className="text-xs text-muted-foreground truncate">{envio.clienteNombre || '—'}</div>
          </div>
          {estadoBadge(envio.envio.estado)}
        </div>
        <div className="text-xs">
          <span className="text-muted-foreground">📍</span> {envio.envio.direccion}
          {envio.envio.referencia && <span className="text-muted-foreground"> · Ref: {envio.envio.referencia}</span>}
        </div>
        {envio.envio.notas && <div className="text-xs text-muted-foreground">📝 {envio.envio.notas}</div>}
        <div className="text-xs font-semibold text-primary">Costo envío: {fmt(envio.envio.costo)}</div>
        <div className="flex gap-1.5 pt-1">
          {envio.envio.estado === 'pendiente' && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[10px]"
              disabled={actualizando}
              onClick={() => onCambiarEstadoEnvio(envio, 'en_camino')}
            >
              {actualizando ? <Loader2 className="h-3 w-3 animate-spin" /> : '📤 En camino'}
            </Button>
          )}
          {envio.envio.estado === 'en_camino' && (
            <Button
              size="sm"
              className="h-7 text-[10px]"
              disabled={actualizando}
              onClick={() => onCambiarEstadoEnvio(envio, 'entregado')}
            >
              {actualizando ? <Loader2 className="h-3 w-3 animate-spin" /> : '✅ Entregado'}
            </Button>
          )}
          {(envio.envio.estado === 'pendiente' || envio.envio.estado === 'en_camino') && (
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-[10px]"
              disabled={actualizando}
              onClick={() => onCambiarEstadoEnvio(envio, 'cancelado')}
            >
              {actualizando ? <Loader2 className="h-3 w-3 animate-spin" /> : '✕ Cancelar'}
            </Button>
          )}
        </div>
        {esDelTurno && <span className="text-[10px] text-muted-foreground">Este turno</span>}
      </div>
    )
  }

  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  React.useEffect(() => {
    let unsub = true
    ;(async () => {
      const t = await buscarTurnoAbierto(user?.uid, tienePermiso('verTodo'))
      if (unsub) setTurno(t)
      if (unsub) setCargando(false)
    })()
    return () => {
      unsub = false
    }
  }, [user])

  async function onAbrir() {
    if (!user) return
    setProcesando(true)
    const r = await abrirTurno({ tipoTurno, montoInicial: parseFloat(montoInicial) || 0, usuarioId: user.uid, usuarioNombre: user.email?.split('@')[0] || 'Usuario', cajaId: cajaId || undefined })
    setProcesando(false)
    if (r.success) {
      setToast('✅ Turno abierto')
      setMontoInicial('')
      setTurno(r.turno ?? null)
    } else {
      setToast('⚠️ ' + (r.error || 'Error'))
    }
  }

  async function onEditarMontoInicial() {
    if (!user || !turno?.id) return
    const nuevoMonto = parseFloat(nuevoMontoInicial)
    if (isNaN(nuevoMonto) || nuevoMonto < 0) {
      setToast('⚠️ Ingrese un monto válido')
      return
    }
    setProcesando(true)
    const r = await editarMontoInicial({ turnoId: turno.id, montoInicial: nuevoMonto, usuarioId: user.uid })
    setProcesando(false)
    if (r.success) {
      setToast('✅ Monto inicial actualizado')
      setTurno({ ...turno, montoInicial: nuevoMonto })
      setEditandoMonto(false)
      setNuevoMontoInicial('')
    } else {
      setToast('❌ ' + (r.error || 'Error'))
    }
  }

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando turno…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {!turno ? (
        /* ===== Abrir turno ===== */
        <>
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="mb-4 flex items-center gap-2">
              <LockOpen className="h-5 w-5 text-primary" />
              <h2 className="font-bold">Abrir Turno</h2>
            </div>
            <div className="space-y-4">
              <div>
                <Label>Turno</Label>
                <div className="mt-1 grid grid-cols-2 gap-1.5">
                  {(['mañana', 'tarde'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTipoTurno(t)}
                      className={cn('h-11 rounded-lg text-sm font-bold border cursor-pointer', tipoTurno === t ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}
                    >
                      {t === 'mañana' ? '🌅 Mañana' : '🌙 Tarde'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Monto inicial en caja (S/)</Label>
                <Input type="number" inputMode="decimal" value={montoInicial} onChange={(e) => setMontoInicial(e.target.value)} placeholder="0.00" className="mt-1" />
              </div>
              <Button className="w-full" onClick={onAbrir} disabled={procesando}>
                {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
                {procesando ? 'Abriendo…' : 'Abrir Turno'}
              </Button>
            </div>
          </div>
        </>
      ) : (
        /* ===== Turno activo ===== */
        <>
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="h-5 w-5 text-emerald-600" />
              <h2 className="font-bold">Turno activo</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Turno" value={turno.tipoTurno === 'tarde' ? 'Tarde' : 'Mañana'} />
              <Info label="Apertura" value={turno.fechaApertura ? new Date(turno.fechaApertura).toLocaleString('es-PE') : '—'} />
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Monto inicial</span>
                  {tienePermiso('editarMontoInicial') && (
                    <button
                      onClick={() => {
                        setNuevoMontoInicial(String(turno.montoInicial ?? 0))
                        setEditandoMonto(true)
                      }}
                      className="text-xs text-primary hover:underline cursor-pointer"
                    >
                      ✏️ Editar
                    </button>
                  )}
                </div>
                <div className="num font-semibold">{fmt(turno.montoInicial ?? 0)}</div>
              </div>
              <Info label="Total ventas" value={fmt(turno.totalVentas ?? 0)} />
              <Info label="Efectivo" value={fmt(turno.totalEfectivo ?? 0)} />
              <Info label="Transferencia" value={fmt(turno.totalTransferencia ?? 0)} />
              <OrigenesTurno desglose={desglosarTurno(turno)} />
            </div>
          </div>

          {/* Comprobantes emitidos */}
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-bold">Comprobantes emitidos</h2>
              <span className="num text-sm text-muted-foreground">{(turno.ventasDelTurno ?? []).length}</span>
            </div>
            {(turno.ventasDelTurno ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin comprobantes en este turno</p>
            ) : (
              <div className="divide-y">
                {(turno.ventasDelTurno ?? []).map((v, i) => {
                  const anulada = v.estado === 'anulada'
                  const esCobro = v.tipo === 'cobro_credito'
                  const tipo = v.tipoPago || 'efectivo'
                  const tipoLabel = tipo === 'efectivo' ? '💵 Efectivo' : tipo === 'transferencia' ? '📲 Transferencia' : tipo === 'yape' ? '📱 Yape' : tipo === 'plin' ? '📱 Plin' : '💳 Crédito'
                  const op = v.operacion || 'SN'
                  return (
                    <div key={v.id || i} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 text-sm">
                      <div className="min-w-[7.5rem] flex-1">
                        <div className="num whitespace-nowrap font-semibold">{v.serie_numero || v.serieNumero || '-'}</div>
                        <div className="truncate text-xs text-muted-foreground">{v.cliente_nombre && v.cliente_nombre !== '-' ? v.cliente_nombre : 'Consumidor'}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn('num font-bold', anulada && 'line-through text-muted-foreground')}>{fmt(v.total ?? 0)}</div>
                        <div className={cn('text-[11px]', anulada ? 'text-red-600' : 'text-muted-foreground')}>
                          {anulada ? '🗑️ Anulada' : esCobro ? `${tipoLabel} · Op: ${op}` : tipoLabel}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Envíos Pendientes */}
          {(enviosTurnoActual.length > 0 || enviosAnteriores.length > 0) && (
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <button
                onClick={() => setMostrarEnvios(!mostrarEnvios)}
                className="flex w-full items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Truck className="h-5 w-5 text-primary" />
                  <h2 className="font-bold">Envíos Pendientes</h2>
                </div>
                <div className="flex items-center gap-2">
                  {enviosAnteriores.length > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {enviosAnteriores.length} de turnos anteriores
                    </span>
                  )}
                  <span className="num text-sm text-muted-foreground">
                    {enviosTurnoActual.length + enviosAnteriores.length}
                  </span>
                </div>
              </button>
              {mostrarEnvios && (
                <div className="mt-3 space-y-3">
                  {enviosTurnoActual.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">De este turno</div>
                      <div className="space-y-2">
                        {enviosTurnoActual.map((v: Record<string, any>) => (
                          <EnvioCard
                            key={v.serie_numero || v.serieNumero}
                            envio={{
                              docId: `${new Date(v.fecha).getFullYear().toString().slice(0, 4)}-${String(new Date(v.fecha).getMonth() + 1).padStart(2, '0')}_${v.tipoDoc || 'NV'}-${v.serie_numero || v.serieNumero}`,
                              turnoId: turno?.id,
                              serieNumero: v.serie_numero || v.serieNumero || '',
                              clienteNombre: v.cliente_nombre,
                              envio: { direccion: v.envio.direccion, referencia: v.envio.referencia, notas: v.envio.notas, estado: v.envio.estado, costo: v.envio.costo },
                            }}
                            esDelTurno
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {enviosAnteriores.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-muted-foreground">De turnos anteriores</div>
                      {cargandoEnvios ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {enviosAnteriores.map((e) => (
                            <EnvioCard key={e.docId} envio={e} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cerrar turno */}
          {esDueno || esSupervisor ? (
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="mb-4 flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                <h2 className="font-bold">Cerrar Turno</h2>
              </div>
              <CierreCaja
                turno={{
                  montoInicial: turno.montoInicial ?? 0,
                  totalEfectivo: turno.totalEfectivo ?? 0,
                  totalGastosEfectivo: turno.totalGastosEfectivo ?? 0,
                  vueltoTransferencia: turno.vueltoTransferencia ?? 0,
                  ventasDelTurno: turno.ventasDelTurno ?? [],
                }}
                conteoCiego={config.conteoCiego === true}
                pagosYape={pagosYapeTurno}
                onConfirm={async (montoFinal, obs, conciliacion) => {
                  setProcesando(true)
                  const r = await cerrarTurno({ turnoId: turno.id!, montoFinalEfectivo: montoFinal, observaciones: obs, usuarioId: user?.uid || '', esSupervisor, conciliacion })
                  setProcesando(false)
                  if (r.success) {
                    setToast('✅ Turno cerrado · Diferencia ' + fmt(r.cierre?.diferencia ?? 0))
                    setTurno(null)
                  } else {
                    setToast('❌ ' + (r.error || 'Error'))
                  }
                }}
                onCancel={() => {}}
                procesando={procesando}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              🔒 Este turno fue abierto por otro usuario. Solo el dueño (o un admin con acceso especial) puede cerrarlo.
            </div>
          )}
        </>
      )}

      {/* Modal Editar Monto Inicial */}
      {editandoMonto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditandoMonto(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-4 font-bold">✏️ Editar Monto Inicial</h3>
            <div className="space-y-3">
              <div>
                <Label>Monto inicial real (S/)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={nuevoMontoInicial}
                  onChange={(e) => setNuevoMontoInicial(e.target.value)}
                  placeholder="0.00"
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setEditandoMonto(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={onEditarMontoInicial} disabled={procesando}>
                  {procesando ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="num font-semibold">{value}</div>
    </div>
  )
}

/**
 * Aclara de dónde viene cada bolsillo: "Efectivo" y "Transferencia" son la plata que entró
 * al cajón y a la billetera (ventas + cobranzas de crédito). Sin esto, una cobranza de
 * S/ 47 por Yape se lee como si fuera una venta del día.
 */
function OrigenesTurno({ desglose }: { desglose: DesgloseTurno }) {
  const lineas = [
    { etiqueta: 'Efectivo', d: desglose.efectivo },
    { etiqueta: 'Transferencia', d: desglose.transferencia },
  ].flatMap(({ etiqueta, d }) =>
    lineasDeOrigen(d)
      .filter((l) => l.origen !== 'ventas')
      .map((l) => ({ key: `${etiqueta}-${l.origen}`, texto: `${etiqueta}: ${l.label} ${fmt(l.monto)}` })),
  )
  if (lineas.length === 0) return null
  return (
    <div className="col-span-2 mt-1 space-y-0.5 rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
      <div className="font-semibold">El total incluye:</div>
      {lineas.map((l) => (
        <div key={l.key} className="num">• {l.texto}</div>
      ))}
    </div>
  )
}
