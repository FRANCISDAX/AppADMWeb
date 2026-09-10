import { Clock, Loader2, Lock, LockOpen } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { CierreCaja } from '@/components/CierreCaja'
import { abrirTurno, buscarTurnoAbierto, cerrarTurno, type Turno } from '@/services/turnos'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

export function Turnos() {
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const [turno, setTurno] = React.useState<Turno | null>(null)
  const esDueno = !!turno?.usuarioId && turno.usuarioId === user?.uid
  const esSupervisor = tienePermiso('verTodo')
  const [cargando, setCargando] = React.useState(true)
  const [tipoTurno, setTipoTurno] = React.useState('mañana')
  const [montoInicial, setMontoInicial] = React.useState('')
  const [procesando, setProcesando] = React.useState(false)
  const [toast, setToast] = React.useState<string | null>(null)

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
    const r = await abrirTurno({ tipoTurno, montoInicial: parseFloat(montoInicial) || 0, usuarioId: user.uid, usuarioNombre: user.email?.split('@')[0] || 'Usuario' })
    setProcesando(false)
    if (r.success) {
      setToast('✅ Turno abierto')
      setMontoInicial('')
      setTurno(r.turno ?? null)
    } else {
      setToast('⚠️ ' + (r.error || 'Error'))
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
              <Info label="Monto inicial" value={fmt(turno.montoInicial ?? 0)} />
              <Info label="Total ventas" value={fmt(turno.totalVentas ?? 0)} />
              <Info label="Efectivo" value={fmt(turno.totalEfectivo ?? 0)} />
              <Info label="Transferencia" value={fmt(turno.totalTransferencia ?? 0)} />
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
                  const tipo = v.tipoPago || 'efectivo'
                  const tipoLabel = tipo === 'efectivo' ? '💵 Efectivo' : tipo === 'transferencia' ? '📲 Transferencia' : '💳 Crédito'
                  return (
                    <div key={v.id || i} className="flex items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">{v.serie_numero || v.serieNumero || '-'}</div>
                        <div className="truncate text-xs text-muted-foreground">{v.cliente_nombre && v.cliente_nombre !== '-' ? v.cliente_nombre : 'Consumidor'}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={cn('num font-bold', anulada && 'line-through text-muted-foreground')}>{fmt(v.total ?? 0)}</div>
                        <div className={cn('text-[11px]', anulada ? 'text-red-600' : 'text-muted-foreground')}>
                          {anulada ? '🗑️ Anulada' : tipoLabel}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

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
                  ventasDelTurno: turno.ventasDelTurno ?? [],
                }}
                onConfirm={async (montoFinal, obs) => {
                  setProcesando(true)
                  const r = await cerrarTurno({ turnoId: turno.id!, montoFinalEfectivo: montoFinal, observaciones: obs, usuarioId: user?.uid || '', esSupervisor })
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
