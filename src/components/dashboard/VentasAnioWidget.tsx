/**
 * **Ventas por mes del año elegido** — el gráfico del **Dashboard Gerencial**.
 *
 * 🔑 **Para qué**: el dashboard muestra el **día** (ventas de hoy, por hora, top productos). Esto
 * agrega la mirada larga: los **12 meses** de un año, con un **selector de año**, para ver cómo viene
 * el negocio y comparar meses de un vistazo.
 *
 * 🔑 **La cuenta NO se hace acá**: `serieMensual()` (`lib/ventas-mensuales.ts`, puro y testeado) es la
 * que sabe qué es una venta y que **la nota de crédito resta**, la misma regla que usan Reportes y el
 * Dashboard Operaciones ⇒ el gráfico no puede contradecir a los reportes.
 *
 * 📌 **Una sola consulta por año** (`obtenerVentasPorRango`, rango de `fecha`): sin índice compuesto y
 * sin filtro por usuario (es un dashboard gerencial, ve todo). Con el volumen real (~200 documentos
 * por año) es un viaje y nada más.
 *
 * ⚠️ **Nada de `setState` sincrónico en el efecto**: los datos se guardan **con su año**
 * (`{ anio, docs }`), así mientras llega el año nuevo se muestra «Cargando…» en vez de las barras del
 * año anterior con la etiqueta del nuevo.
 */
import * as React from 'react'
import { PiggyBank, TrendingUp } from 'lucide-react'

import { primerAnioDeVentas, obtenerVentasPorRango } from '@/services/reportes'
import { useProductos } from '@/hooks/use-productos'
import {
  aniosParaSelector,
  etiquetaMes,
  mapaDeCostos,
  serieMensual,
  type DocDeVenta,
} from '@/lib/ventas-mensuales'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function VentasAnioWidget() {
  // El año actual se lee UNA vez (con inicializador perezoso: nada de `new Date()` en el render).
  const [anioActual] = React.useState(() => new Date().getFullYear())
  const [anio, setAnio] = React.useState(() => new Date().getFullYear())
  const [datos, setDatos] = React.useState<{ anio: number; docs: DocDeVenta[] } | null>(null)
  const [primerAnio, setPrimerAnio] = React.useState(0)
  const [error, setError] = React.useState('')
  // El costo de lo vendido sale del catálogo (promedio ponderado): sin él no hay margen que mostrar.
  const { productos } = useProductos()
  const costos = React.useMemo(() => mapaDeCostos(productos), [productos])

  // El selector: desde el año del primer comprobante hasta el actual (una lectura chica).
  React.useEffect(() => {
    let vivo = true
    primerAnioDeVentas().then((a) => {
      if (vivo) setPrimerAnio(a)
    })
    return () => {
      vivo = false
    }
  }, [])

  // Las ventas del año elegido. `obtenerVentasPorRango` ya normaliza las horas y filtra lo que no es
  // una venta (anulado, consolidado, pedidos): no hay que volver a filtrar acá.
  React.useEffect(() => {
    let vivo = true
    obtenerVentasPorRango(new Date(anio, 0, 1), new Date(anio, 11, 31))
      .then((docs) => {
        if (vivo) setDatos({ anio, docs: docs as DocDeVenta[] })
      })
      .catch((e) => {
        console.error('❌ No se pudieron leer las ventas del año:', e)
        if (vivo) {
          setError('No se pudieron cargar las ventas del año')
          setDatos({ anio, docs: [] })
        }
      })
    return () => {
      vivo = false
    }
  }, [anio])

  const listo = datos?.anio === anio
  const serie = React.useMemo(
    () => serieMensual(listo ? datos?.docs : [], anio, { costos }),
    [listo, datos, anio, costos],
  )
  const anios = React.useMemo(() => aniosParaSelector(primerAnio, anioActual), [primerAnio, anioActual])
  // Las barras son el MARGEN, así que el “mejor mes” es el de mejor margen (no el de más venta).
  const mejorMargen = React.useMemo(
    () => serie.meses.reduce<typeof serie.meses[number] | null>((mejor, m) => (m.margen > (mejor?.margen ?? 0) ? m : mejor), null),
    [serie],
  )

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <PiggyBank className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold">Margen por mes</span>
          <span className="text-[11px] text-muted-foreground">(ventas − costo de la mercadería)</span>
        </div>
        <div className="flex items-center gap-3">
          {listo && serie.comprobantes > 0 && (
            <span className="text-right">
              <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Margen del año</span>
              <span className="num text-sm font-extrabold">{fmt(serie.margen)}</span>
              <span className="block text-[10px] text-muted-foreground">
                {serie.margenPct.toFixed(1)}% de {fmt(serie.ingreso)} vendidos
              </span>
            </span>
          )}
          <select
            value={anio}
            onChange={(e) => setAnio(Number(e.target.value))}
            aria-label="Año"
            className="h-9 rounded-lg border bg-background px-3 text-sm font-semibold"
          >
            {anios.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="p-4">
        {!listo ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Cargando {anio}…</div>
        ) : serie.comprobantes === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Sin ventas en {anio}
            {error ? ` · ${error}` : ''}
          </div>
        ) : (
          <>
            <div className="flex h-44 items-end gap-1">
              {serie.meses.map((m) => {
                const alto = m.margen > 0 ? Math.max(3, (m.margen / serie.maxMargen) * 100) : 0
                const esMejor = mejorMargen?.mes === m.mes && m.margen > 0
                return (
                  <div key={m.mes} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <div
                      className={cn('w-full rounded-t', m.margen < 0 ? 'bg-destructive/70' : esMejor ? 'bg-primary' : 'bg-primary/60')}
                      style={{ height: `${alto}%` }}
                      title={`${etiquetaMes(anio, m.mes)}: margen ${fmt(m.margen)} · vendido ${fmt(m.total)} · costo ${fmt(m.costo)} · ${m.comprobantes} comprobante${m.comprobantes === 1 ? '' : 's'}`}
                    />
                    <span className={cn('h-4 text-[9px] font-semibold', esMejor ? 'text-primary' : 'text-muted-foreground')}>
                      {m.label}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-[11px] text-muted-foreground">
              <span>
                {serie.comprobantes} comprobante{serie.comprobantes === 1 ? '' : 's'} ·{' '}
                {serie.mesesConVentas} mes{serie.mesesConVentas === 1 ? '' : 'es'} con ventas · costo de lo vendido {fmt(serie.costo)}
              </span>
              {mejorMargen && mejorMargen.margen > 0 && (
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <TrendingUp className="h-3 w-3 text-primary" />
                  Mejor mes: {etiquetaMes(anio, mejorMargen.mes)} · {fmt(mejorMargen.margen)}
                </span>
              )}
            </div>
            {serie.itemsSinCosto > 0 && (
              <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                ⚠️ {serie.itemsSinCosto} línea{serie.itemsSinCosto === 1 ? '' : 's'} sin costo en el catálogo (los «Embalaje y otros»
                se venden sin costo cargado): el margen está <b>inflado</b>. Cargales el costo en Inventario para que este número sea real.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
