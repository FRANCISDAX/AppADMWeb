import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Filter, Info, Loader2, Printer, Search } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, orderBy, query } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cn } from '@/lib/utils'
import { abrirPDFCierreCaja, type CierreCajaPDF } from '@/lib/pdf'

const fmt = (n: number) => 'S/ ' + n.toFixed(2)

type Cierre = {
  id: string
  turnoId?: string
  usuarioId?: string
  usuarioNombre?: string
  tipoTurno?: string
  fechaApertura?: string
  fechaCierre?: string
  montoInicial?: number
  totalVentas?: number
  totalEfectivo?: number
  totalTransferencia?: number
  totalGastos?: number
  totalGastosEfectivo?: number
  totalGastosTransferencia?: number
  efectivoEsperado?: number
  montoFinalEfectivo?: number
  diferencia?: number
  observaciones?: string
  analisis?: {
    causas: { tipo: string; descripcion: string; ventaId?: string; monto?: number; hora?: string }[]
    recomendaciones: string[]
  }
}

export function AuditoriaCaja() {
  const [cierres, setCierres] = React.useState<Cierre[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [busqueda, setBusqueda] = React.useState('')
  const [expandido, setExpandido] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState<'todos' | 'con_diferencia' | 'cuadrados'>('todos')

  React.useEffect(() => {
    let activo = true
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, COL.CIERRES), orderBy('createdAt', 'desc')))
        if (!activo) return
        const data = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Cierre[]
        setCierres(data)
      } catch (e) {
        console.error('Error cargando cierres:', e)
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
  }, [])

  const filtrados = React.useMemo(() => {
    let lista = cierres

    if (filtro === 'con_diferencia') {
      lista = lista.filter((c) => Math.abs(c.diferencia ?? 0) > 0.01)
    } else if (filtro === 'cuadrados') {
      lista = lista.filter((c) => Math.abs(c.diferencia ?? 0) < 0.01)
    }

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase()
      lista = lista.filter((c) =>
        (c.usuarioNombre ?? '').toLowerCase().includes(q) ||
        (c.tipoTurno ?? '').toLowerCase().includes(q) ||
        (c.fechaCierre ?? '').includes(q) ||
        (c.fechaApertura ?? '').includes(q)
      )
    }

    return lista
  }, [cierres, filtro, busqueda])

  if (cargando) {
    return (
      <div className="flex h-48 items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" /> <span className="ml-2 text-sm">Cargando cierres…</span>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 rounded-xl bg-muted p-1">
          {([
            { key: 'todos', label: 'Todos' },
            { key: 'con_diferencia', label: 'Con diferencia' },
            { key: 'cuadrados', label: 'Cuadrados' },
          ] as const).map((f) => (
            <button
              key={f.key}
              onClick={() => setFiltro(f.key)}
              className={cn('rounded-lg px-3 py-1.5 text-xs font-bold transition-colors cursor-pointer', filtro === f.key ? 'bg-white text-primary shadow-sm' : 'text-muted-foreground')}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por usuario, turno…"
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
          />
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="rounded-lg bg-muted/40 p-2">
          <div className="text-muted-foreground">Total cierres</div>
          <div className="font-bold">{cierres.length}</div>
        </div>
        <div className="rounded-lg bg-muted/40 p-2">
          <div className="text-muted-foreground">Con diferencia</div>
          <div className="font-bold text-red-600">{cierres.filter((c) => Math.abs(c.diferencia ?? 0) > 0.01).length}</div>
        </div>
        <div className="rounded-lg bg-muted/40 p-2">
          <div className="text-muted-foreground">Cuadrados</div>
          <div className="font-bold text-emerald-600">{cierres.filter((c) => Math.abs(c.diferencia ?? 0) < 0.01).length}</div>
        </div>
      </div>

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
          <Filter className="mx-auto mb-2 h-8 w-8" />
          {cierres.length === 0 ? 'No hay cierres de caja registrados' : 'No se encontraron resultados'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((c) => {
            const cuadra = Math.abs(c.diferencia ?? 0) < 0.01
            const expandir = expandido === c.id
            return (
              <div key={c.id} className="rounded-2xl border bg-card shadow-card overflow-hidden">
                {/* Cabecera */}
                <button
                  onClick={() => setExpandido(expandir ? null : c.id)}
                  className="flex w-full items-center gap-3 p-4 text-left cursor-pointer"
                >
                  {cuadra ? (
                    <CheckCircle className="h-5 w-5 shrink-0 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{c.usuarioNombre ?? '—'}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {c.tipoTurno === 'tarde' ? '🌙 Tarde' : '🌅 Mañana'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {c.fechaCierre ? new Date(c.fechaCierre).toLocaleString('es-PE') : '—'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn('num font-extrabold', cuadra ? 'text-emerald-700' : 'text-red-700')}>
                      {cuadra ? '✓ Cuadrado' : fmt(c.diferencia ?? 0)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Esperado: {fmt(c.efectivoEsperado ?? 0)} · Real: {fmt(c.montoFinalEfectivo ?? 0)}
                    </div>
                  </div>
                  {expandir ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>

                {/* Detalle expandido */}
                {expandir && (
                  <div className="border-t bg-muted/20 p-4 space-y-3">
                    {/* Resumen financiero */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Fondo inicial</div>
                        <div className="font-bold">{fmt(c.montoInicial ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Total ventas</div>
                        <div className="font-bold">{fmt(c.totalVentas ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Efectivo vendido</div>
                        <div className="font-bold text-emerald-600">{fmt(c.totalEfectivo ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Transferencia</div>
                        <div className="font-bold">{fmt(c.totalTransferencia ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Gastos efectivo</div>
                        <div className="font-bold text-red-600">-{fmt(c.totalGastosEfectivo ?? 0)}</div>
                      </div>
                      <div className="rounded-lg bg-background p-2.5">
                        <div className="text-muted-foreground">Gastos transferencia</div>
                        <div className="font-bold">-{fmt(c.totalGastosTransferencia ?? 0)}</div>
                      </div>
                    </div>

                    {/* Diferencia destacada */}
                    <div className={cn(
                      'rounded-xl border p-3 text-center',
                      cuadra ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950' : 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950'
                    )}>
                      <div className="text-xs text-muted-foreground">Diferencia</div>
                      <div className={cn('text-xl font-extrabold', cuadra ? 'text-emerald-700' : 'text-red-700')}>
                        {cuadra ? 'S/ 0.00' : fmt(c.diferencia ?? 0)}
                      </div>
                    </div>

                    {/* Análisis */}
                    {c.analisis && (c.analisis.causas.length > 0 || c.analisis.recomendaciones.length > 0) && (
                      <div className="space-y-2">
                        {c.analisis.causas.length > 0 && (
                          <div>
                            <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground mb-1.5">
                              <Search className="h-3.5 w-3.5" /> Posibles causas
                            </h4>
                            <div className="space-y-1">
                              {c.analisis.causas.map((causa, i) => (
                                <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs dark:border-amber-800 dark:bg-amber-950">
                                  <span className="font-semibold text-amber-700 dark:text-amber-300">{causa.descripcion}</span>
                                  {causa.hora && <span className="ml-1 text-muted-foreground">— {causa.hora}</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {c.analisis.recomendaciones.length > 0 && (
                          <div>
                            <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground mb-1.5">
                              <Info className="h-3.5 w-3.5" /> Recomendaciones
                            </h4>
                            <ul className="space-y-1">
                              {c.analisis.recomendaciones.map((rec, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                  <span className="mt-0.5 text-primary">•</span>
                                  {rec}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Observaciones */}
                    {c.observaciones && (
                      <div className="rounded-lg bg-muted/40 p-2.5 text-xs">
                        <span className="font-semibold">Observaciones: </span>
                        <span className="text-muted-foreground">{c.observaciones}</span>
                      </div>
                    )}

                    {/* Imprimir */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => abrirPDFCierreCaja(c as CierreCajaPDF)}
                    >
                      <Printer className="mr-2 h-4 w-4" />
                      Imprimir PDF
                    </Button>

                    {/* Fechas */}
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Apertura: {c.fechaApertura ? new Date(c.fechaApertura).toLocaleString('es-PE') : '—'}</span>
                      <span>ID: {c.id.slice(0, 8)}…</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default AuditoriaCaja
