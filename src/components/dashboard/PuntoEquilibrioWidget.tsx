/**
 * **Punto de equilibrio** — la tarjeta que contesta *«¿cuánto tengo que vender para no perder?»*
 * (Dashboard Gerencial).
 *
 * 🔑 **La cuenta no se hace acá**: `lib/punto-equilibrio.ts` (puro y testeado) tiene la regla —
 * **fijos ÷ margen**— y `lib/ventas-mensuales.ts` la del margen, la **misma** que usan Análisis y el
 * gráfico de margen por mes. Esta pantalla solo junta los datos y los muestra.
 *
 * **De dónde sale cada número**:
 *   - **Costos fijos** = los **Egresos del mes** sin la categoría «Compras» (esa es mercadería y su
 *     costo ya está adentro del margen: contarla dos veces pediría vender mucho más de lo necesario).
 *   - **Margen %** = el de los **últimos 3 meses** (ponderado por ventas): el de un mes suelto es
 *     ruidoso y haría saltar el equilibrio de un mes al otro.
 *   - **Vendido** = lo del **mes en curso**, para saber cuánto falta.
 *
 * ⚠️ **Los avisos son parte de la tarjeta**: si no hay costos fijos cargados, si hay mercadería sin
 * costo (margen inflado ⇒ equilibrio demasiado bajo) o si el margen es ≤ 0 (no hay equilibrio
 * posible), se dice. Un punto de equilibrio que miente es peor que no tenerlo.
 */
import * as React from 'react'
import { AlertTriangle, Scale, Target } from 'lucide-react'

import { obtenerEgresosPorFecha } from '@/services/egresos'
import { obtenerVentasPorRango } from '@/services/reportes'
import { useProductos } from '@/hooks/use-productos'
import { comprasDeEgresos, costosFijosDe, puntoDeEquilibrio } from '@/lib/punto-equilibrio'
import { anioDeFecha, mapaDeCostos, margenDelPeriodo, mesDeFecha, type DocDeVenta } from '@/lib/ventas-mensuales'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Cuántos meses se miran para el margen (uno solo es ruidoso). */
const MESES_PARA_MARGEN = 3

export function PuntoEquilibrioWidget() {
  const { productos } = useProductos()
  const costos = React.useMemo(() => mapaDeCostos(productos), [productos])

  const [datos, setDatos] = React.useState<{
    anio: number
    mes: number
    fijos: number
    compras: number
    docs: DocDeVenta[]
    mesesMedidos: number
  } | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let vivo = true
    const hoy = new Date()
    const anio = hoy.getFullYear()
    const mes = hoy.getMonth() + 1
    const inicioMes = new Date(anio, mes - 1, 1)
    const inicioMedicion = new Date(anio, mes - MESES_PARA_MARGEN, 1) // los últimos 3 meses, incluido el actual

    Promise.all([
      obtenerEgresosPorFecha(iso(inicioMes), iso(hoy)),
      obtenerVentasPorRango(inicioMedicion, hoy),
    ])
      .then(([egresos, docs]) => {
        if (!vivo) return
        setDatos({
          anio,
          mes,
          fijos: costosFijosDe(egresos),
          compras: comprasDeEgresos(egresos),
          docs: docs as DocDeVenta[],
          mesesMedidos: MESES_PARA_MARGEN,
        })
      })
      .catch((e) => {
        console.error('❌ No se pudo calcular el punto de equilibrio:', e)
        if (vivo) setError('No se pudieron leer los gastos y las ventas del mes')
      })
    return () => {
      vivo = false
    }
  }, [])

  const calculo = React.useMemo(() => {
    if (!datos) return null
    const periodo = margenDelPeriodo(datos.docs, costos)
    // Lo vendido **del mes en curso** (el período medido puede incluir los dos meses anteriores).
    const vendidoMes = datos.docs
      .filter((d) => anioDeFecha(d.fecha) === datos.anio && mesDeFecha(d.fecha) === datos.mes)
      .reduce((s, d) => s + (Number(d.venta?.total) || 0), 0)
    return {
      periodo,
      r: puntoDeEquilibrio({
        costosFijos: datos.fijos,
        vendido: vendidoMes,
        margen: periodo.margenPct / 100,
      }),
    }
  }, [datos, costos])

  if (!datos) {
    return (
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="flex items-center gap-2 text-sm font-bold">
          <Scale className="h-4 w-4 text-primary" /> Punto de equilibrio
        </div>
        <p className="py-6 text-center text-sm text-muted-foreground">{error || 'Calculando…'}</p>
      </div>
    )
  }

  const { periodo, r } = calculo!
  const sinFijos = r.costosFijos <= 0
  const sinMargen = r.equilibrio === null

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Punto de equilibrio</span>
          <span className="text-[11px] text-muted-foreground">(cuánto hay que vender para no perder)</span>
        </div>
        {r.equilibrio !== null && (
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', r.alcanzado ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300')}>
            {r.alcanzado ? '✅ Mes cubierto' : `Faltan ${fmt(r.falta ?? 0)}`}
          </span>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Costos fijos del mes</div>
          <div className="num text-lg font-extrabold">{fmt(r.costosFijos)}</div>
          <div className="text-[10px] text-muted-foreground">
            {datos.compras > 0 ? `(+ ${fmt(datos.compras)} de mercadería, que no es fijo)` : 'de tus Egresos del mes'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Margen de los últimos {datos.mesesMedidos} meses</div>
          <div className="num text-lg font-extrabold">{periodo.margenPct.toFixed(1)}%</div>
          <div className="text-[10px] text-muted-foreground">de cada sol vendido, después de la mercadería</div>
        </div>
        <div>
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Target className="h-3 w-3" /> Punto de equilibrio
          </div>
          <div className="num text-lg font-extrabold">{r.equilibrio === null ? '—' : fmt(r.equilibrio)}</div>
          <div className="text-[10px] text-muted-foreground">
            {r.porDia !== null ? `≈ ${fmt(r.porDia)} por día (${r.dias} días)` : 'sin margen no hay equilibrio'}
          </div>
        </div>
      </div>

      {r.equilibrio !== null && (
        <div className="px-4 pb-4">
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Vendido este mes: <b className="text-foreground">{fmt(r.vendido)}</b></span>
            <span className="text-muted-foreground">{r.avancePct.toFixed(0)}% del equilibrio</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-all', r.alcanzado ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${r.avancePct}%` }} />
          </div>
        </div>
      )}

      <div className="space-y-1 border-t px-4 py-3 text-[10px] text-muted-foreground">
        {sinFijos && (
          <p className="font-semibold text-amber-600">
            ⚠️ No hay costos fijos cargados este mes en Egresos/Gastos: cargá el alquiler, los sueldos y los servicios para que este
            número sirva.
          </p>
        )}
        {sinMargen && !sinFijos && (
          <p className="font-semibold text-destructive">
            ⚠️ El margen de los últimos meses es 0% o negativo: con ese margen <b>ningún</b> nivel de venta cubre los costos fijos. Antes
            de mirar el equilibrio hay que revisar los precios y los costos (Inventario → «sin costo»).
          </p>
        )}
        {periodo.itemsSinCosto > 0 && (
          <p className="font-semibold text-amber-600">
            ⚠️ {periodo.itemsSinCosto} línea{periodo.itemsSinCosto === 1 ? '' : 's'} vendida{periodo.itemsSinCosto === 1 ? '' : 's'} sin costo
            en el catálogo: el margen está inflado y el equilibrio sale <b>más bajo</b> de lo real.
          </p>
        )}
        {datos.compras > 0 && (
          <p>
            ℹ️ La mercadería de este mes ({fmt(datos.compras)}, categoría «Compras») <b>no</b> cuenta como costo fijo: su costo ya está
            descontado en el margen. Contarla dos veces pediría vender mucho más de lo necesario.
          </p>
        )}
        <p className="flex items-start gap-1">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            El margen sale de las ventas y del <b>costo promedio</b> del catálogo (el mismo de Análisis), y asume que la mezcla de
            productos se mantiene. Es una referencia para decidir, no un número de SUNAT.
          </span>
        </p>
      </div>
    </div>
  )
}
