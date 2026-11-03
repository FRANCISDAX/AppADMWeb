import { AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Filter, Info, Loader2, Printer, Search } from 'lucide-react'
import * as React from 'react'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { Button } from '@/components/ui/button'
import { db } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { cn } from '@/lib/utils'
import { abrirPDFCierreCaja, type CierreCajaPDF } from '@/lib/pdf'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { origenDelEfectivo, pistasDelCierre, resumenPorRubro, signoDe } from '@/lib/auditoria-caja'
import { mediosDelTurno } from '@/lib/arqueo'
import { diaLocalISO } from '@/lib/fechas'

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
  /** Items del turno tal como los guarda el cierre: con ellos se recalcula cada rubro. */
  ventas?: any[]
  gastos?: any[]
  /** Lo que el cajero declaró al cerrar, por billetera (opcional). */
  conciliacion?: Record<string, { sistema?: number; declarado?: number; diferencia?: number }>
  analisis?: {
    causas: { tipo: string; descripcion: string; ventaId?: string; monto?: number; hora?: string }[]
    recomendaciones: string[]
  }
}

/**
 * **El mes de los cierres** (`YYYY-MM`): los totales por rubro son del mes, no de todo el año.
 *
 * ⚠️ El corte es por **día local**: el cierre se guarda con `createdAt` en ISO/UTC, así que el rango se arma
 * con la medianoche local del día 1 (`lib/fechas.ts`), no con el texto del `<input type="month">`.
 */
function rangoDelMes(mes: string): { desdeISO: string; hastaISO: string } | null {
  const [y, m] = String(mes ?? '').split('-').map(Number)
  if (!y || !m) return null
  return { desdeISO: new Date(y, m - 1, 1, 0, 0, 0, 0).toISOString(), hastaISO: new Date(y, m, 1, 0, 0, 0, 0).toISOString() }
}

/** El mes actual del navegador como `YYYY-MM`. */function mesDeHoy(): string {
  return diaLocalISO().slice(0, 7)
}

/** Lista vacía **estable** (identidad fija) para no invalidar los `useMemo` en cada render. */
const SIN_CIERRES: Cierre[] = []

export function AuditoriaCaja() {
  // Empresa para el encabezado de los PDF (nombre, RUC, dirección y firmas).
  const { config } = useConfiguracion()
  /**
   * ⚠️ Los cierres se guardan **con el mes al que pertenecen** y el «cargando» se **deriva** (`mes pedido ≠
   * mes cargado`): así el efecto no llama a `setState` de forma síncrona (sube el baseline de lint) y nunca se
   * muestran los totales de un mes mientras se pide otro.
   */
  const [datos, setDatos] = React.useState<{ mes: string; cierres: Cierre[] }>({ mes: '', cierres: [] })
  const [busqueda, setBusqueda] = React.useState('')
  const [expandido, setExpandido] = React.useState<string | null>(null)
  const [filtro, setFiltro] = React.useState<'todos' | 'con_diferencia' | 'cuadrados'>('todos')
  /** 🔑 **Los totales son del MES elegido** (no de todo el año): pedido del usuario, 30/10/2026. */
  const [mes, setMes] = React.useState(mesDeHoy())

  const cargando = datos.mes !== mes
  // ⚠️ Array **estable** cuando todavía no llegó el mes pedido: si se devolviera `[]` nuevo en cada render, el
  // `useMemo` de abajo se recalcularía siempre (y el lint lo marca).
  const cierres = datos.mes === mes ? datos.cierres : SIN_CIERRES

  React.useEffect(() => {
    const rango = rangoDelMes(mes)
    if (!rango) return
    let activo = true
    ;(async () => {
      try {
        // Rango sobre `createdAt` (un solo campo ⇒ índice automático): no se baja el año entero.
        const snap = await getDocs(
          query(
            collection(db, COL.CIERRES),
            where('createdAt', '>=', rango.desdeISO),
            where('createdAt', '<', rango.hastaISO),
            orderBy('createdAt', 'desc'),
          )
        )
        if (!activo) return
        setDatos({ mes, cierres: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Cierre[] })
      } catch (e) {
        console.error('Error cargando cierres del mes:', e)
        if (activo) setDatos({ mes, cierres: [] })
      }
    })()
    return () => { activo = false }
  }, [mes])

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
        {/* 🔑 **Se elige el MES**: los totales por rubro son de ese mes, no de todo el año. */}
        <div className="flex items-center gap-2">
          <label htmlFor="auditoria-mes" className="text-xs font-bold text-muted-foreground">Mes</label>
          <input
            id="auditoria-mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value || mesDeHoy())}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          />
        </div>
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

      {/* 🔑 **Totales por rubro del MES elegido**: el efectivo se CUENTA (esperado vs contado) y cada
          billetera (Yape, Plin, tarjeta, transferencia) se CRUZA contra lo declarado al cerrar. */}
      {filtrados.length > 0 && (() => {
        const r = resumenPorRubro(filtrados as never)
        const estado = (d: number | null) => {
          const s = signoDe(d)
          return s === 'cuadra'
            ? <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">✓ cuadra</span>
            : <span className="rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-500/15 dark:text-red-300">{s === 'faltante' ? 'faltante' : 'sobrante'} {fmt(Math.abs(Number(d) || 0))}</span>
        }
        return (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-card">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
              <span className="text-sm font-bold">Totales por rubro · {mes} · {r.cierres} cierre(s)</span>
              <span className="num text-xs text-muted-foreground">Ventas {fmt(r.ventas.total)} · {r.ventas.tickets} ítems</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/20 text-left text-muted-foreground">
                    <th className="px-4 py-2">Rubro</th>
                    <th className="px-4 py-2 text-right">Sistema</th>
                    <th className="px-4 py-2 text-right">Contado / declarado</th>
                    <th className="px-4 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-4 py-2 font-semibold">💵 Efectivo en cajón</td>
                    <td className="px-4 py-2 text-right num">{fmt(r.efectivo.esperado)}</td>
                    <td className="px-4 py-2 text-right num">{fmt(r.efectivo.contado)}</td>
                    <td className="px-4 py-2 text-center">{estado(r.efectivo.diferencia)}</td>
                  </tr>
                  {r.transferencia.medios.map((m) => (
                    <tr key={m.medio}>
                      <td className="px-4 py-2 font-semibold">{m.icono} {m.label}</td>
                      <td className="px-4 py-2 text-right num">{fmt(m.sistema)}</td>
                      <td className="px-4 py-2 text-right num">{m.declarado === null ? '—' : fmt(m.declarado)}</td>
                      <td className="px-4 py-2 text-center">
                        {m.declarado === null
                          ? <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">sin conciliar</span>
                          : estado(m.diferencia)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted/20">
                    <td className="px-4 py-2 font-semibold">🏦 Todo por transferencia</td>
                    <td className="px-4 py-2 text-right num">{fmt(r.transferencia.total)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">no pasa por el cajón</td>
                    <td className="px-4 py-2 text-center text-[10px] text-muted-foreground">
                      {r.transferencia.conciliado ? 'cruzado por billetera' : 'sin conciliar'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t bg-muted/20 p-3 text-[11px] sm:grid-cols-4">
              <div><span className="text-muted-foreground">Fondo inicial </span><span className="num font-bold">{fmt(r.efectivo.fondo)}</span></div>
              <div><span className="text-muted-foreground">Ventas efectivo </span><span className="num font-bold text-emerald-600">{fmt(r.efectivo.ventas)}</span></div>
              <div><span className="text-muted-foreground">Gastos efectivo </span><span className="num font-bold text-red-600">-{fmt(r.efectivo.gastos)}</span></div>
              <div><span className="text-muted-foreground">Cierres con diferencia </span><span className="num font-bold text-red-600">{r.efectivo.conDiferencia}</span></div>
            </div>
          </div>
        )
      })()}

      {/* Lista */}
      {filtrados.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-muted/40 p-8 text-center text-sm text-muted-foreground">
          <Filter className="mx-auto mb-2 h-8 w-8" />
          {cierres.length === 0 ? `No hay cierres de caja en ${mes}` : 'No se encontraron resultados'}
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
                    {/* 🔑 **Dos rubros, dos formas de cuadrar**: el efectivo se CUENTA; las transferencias se
                        CRUZAN contra lo declarado en el cierre (nunca pasan por el cajón). */}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border bg-background p-2.5 text-xs">
                        <div className="mb-1.5 font-bold">💵 Efectivo (se cuenta)</div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Fondo inicial</span><span className="num">{fmt(c.montoInicial ?? 0)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">+ Ventas en efectivo</span><span className="num text-emerald-600">{fmt(c.totalEfectivo ?? 0)}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">− Gastos en efectivo</span><span className="num text-red-600">-{fmt(c.totalGastosEfectivo ?? 0)}</span></div>
                        <div className="mt-1 flex justify-between border-t pt-1"><span className="font-semibold">= Esperado</span><span className="num font-bold">{fmt(c.efectivoEsperado ?? 0)}</span></div>
                        <div className="flex justify-between"><span className="font-semibold">Contado</span><span className="num font-bold">{fmt(c.montoFinalEfectivo ?? 0)}</span></div>
                        <div className={cn('mt-1 flex justify-between border-t pt-1', cuadra ? 'text-emerald-700' : 'text-red-700')}>
                          <span className="font-bold">{signoDe(c.diferencia) === 'sobrante' ? 'Sobrante' : signoDe(c.diferencia) === 'faltante' ? 'Faltante' : 'Diferencia'}</span>
                          <span className="num font-extrabold">{cuadra ? 'S/ 0.00' : fmt(Math.abs(c.diferencia ?? 0))}</span>
                        </div>
                      </div>

                      <div className="rounded-xl border bg-background p-2.5 text-xs">
                        <div className="mb-1.5 font-bold">📲 Transferencias (se cruzan)</div>
                        {(() => {
                          const medios = mediosDelTurno({ ventasDelTurno: (c.ventas ?? []) as never, totalEfectivo: c.totalEfectivo, totalTransferencia: c.totalTransferencia })
                            .filter((m) => m.medio !== 'efectivo')
                          if (medios.length === 0) return <p className="text-muted-foreground">Este turno no tiene cobros por transferencia.</p>
                          return (
                            <>
                              {medios.map((m) => {
                                const dec = c.conciliacion?.[m.medio]?.declarado
                                const dif = dec === undefined ? null : Number(dec) - m.monto
                                return (
                                  <div key={m.medio} className="flex items-center justify-between gap-1">
                                    <span className="text-muted-foreground">{m.icono} {m.label}</span>
                                    <span className="num">{fmt(m.monto)}</span>
                                    <span className={cn('num text-[10px] font-bold', dif === null ? 'text-muted-foreground' : Math.abs(dif) < 0.01 ? 'text-emerald-600' : 'text-red-600')}>
                                      {dif === null ? 'sin conciliar' : Math.abs(dif) < 0.01 ? '✓' : fmt(dif)}
                                    </span>
                                  </div>
                                )
                              })}
                              <div className="mt-1 flex justify-between border-t pt-1">
                                <span className="font-semibold">Total transferencia</span>
                                <span className="num font-bold">{fmt(c.totalTransferencia ?? 0)}</span>
                              </div>
                              <div className="flex justify-between"><span className="text-muted-foreground">− Gastos por transferencia</span><span className="num text-red-600">-{fmt(c.totalGastosTransferencia ?? 0)}</span></div>
                            </>
                          )
                        })()}
                      </div>
                    </div>

                    {/* De dónde salió el efectivo del cajón: es lo que permite rastrear una diferencia. */}
                    <div className="rounded-xl border bg-background p-2.5 text-xs">
                      <div className="mb-1 font-bold">De dónde salió el efectivo</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {origenDelEfectivo(c as never).map((l) => (
                          <span key={l.origen} className="text-muted-foreground">
                            {l.label}: <span className={cn('num font-bold', l.monto < 0 ? 'text-red-600' : 'text-foreground')}>{fmt(l.monto)}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* 🔑 **¿Qué pudo pasar?** Pistas calculadas de los datos del cierre (no consejos genéricos):
                        un documento por el importe exacto, duplicados, montos redondos, y el cruce entre rubros. */}
                    {(() => {
                      const pistas = pistasDelCierre(c as never)
                      if (pistas.length === 0) return null
                      return (
                        <div className="space-y-1.5">
                          <h4 className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
                            <Search className="h-3.5 w-3.5" /> ¿Qué pudo haber pasado?
                          </h4>
                          {pistas.map((p, i) => (
                            <div key={i} className={cn(
                              'rounded-lg border p-2.5 text-xs',
                              p.fuerza === 'fuerte'
                                ? 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-950'
                                : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
                            )}>
                              <div className="flex items-center gap-1.5">
                                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-bold', p.signo === 'faltante' ? 'bg-red-200 text-red-800 dark:bg-red-500/20 dark:text-red-300' : 'bg-amber-200 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300')}>
                                  {p.signo} {fmt(p.monto)}
                                </span>
                                <span className="text-[10px] font-semibold text-muted-foreground">{p.rubro}</span>
                              </div>
                              <p className="mt-1 leading-snug">{p.texto.replace(/\*\*/g, '')}</p>
                              {p.documentos.length > 0 && (
                                <p className="mt-1 font-mono text-[10px] text-muted-foreground">Revisar: {p.documentos.join(' · ')}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })()}

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
                      onClick={() => abrirPDFCierreCaja(c as CierreCajaPDF, config)}
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
