/**
 * **Punto de equilibrio** — la tarjeta que contesta *«¿cuánto tengo que vender para no perder?»*
 * (Dashboard Gerencial).
 *
 * 🔑 **La cuenta no se hace acá**: `lib/punto-equilibrio.ts` (puro y testeado) tiene las reglas —
 * **fijos ÷ margen de contribución**— y `lib/ventas-mensuales.ts` la del margen, la **misma** que usan
 * Análisis y el gráfico de margen por mes. Esta pantalla solo junta los datos y los muestra.
 *
 * **De dónde sale cada número**:
 *   - **Costos fijos** = los **Egresos sin la mercadería** (categorías «Compras», «compra» y
 *     «pago_proveedor»: su costo ya está en el margen y contarlas acá pagaría dos veces la misma compra).
 *     📌 **De qué meses**: el **promedio de los meses terminados con gastos cargados**; si no hay historia,
 *     el mes en curso **marcado como mínimo** (`baseDeCostosFijos`). Antes se usaba solo el mes en curso, que
 *     el día 3 son **3 días de gastos** contra un objetivo de mes completo ⇒ equilibrio irrealmente bajo.
 *   - **Margen %** = el de los **últimos 3 meses** (ponderado por ventas): el de un mes suelto es ruidoso.
 *   - **Impuesto a las ventas** (`config.impuestoVentasPorcentaje`) = se paga **como porcentaje de lo
 *     vendido**, así que se **resta del margen** y no se suma a los fijos. ⚠️ Si además está cargado como
 *     Egreso de categoría «Impuestos», se avisa: sería contarlo dos veces.
 *   - **Vendido** = lo del **mes en curso**, en **soles netos** (la misma base que el margen; con el catálogo
 *     exonerado neto = total, así que no cambia nada hoy).
 *
 * ⚠️ **Los avisos son parte de la tarjeta**: sin costos fijos, con el mes a medias, con mercadería sin costo
 * (margen inflado ⇒ equilibrio demasiado bajo) o con margen ≤ 0, se dice. Un punto de equilibrio que miente
 * es peor que no tenerlo.
 */
import * as React from 'react'
import { AlertTriangle, Info, Scale, Target } from 'lucide-react'

import { obtenerEgresosPorFecha } from '@/services/egresos'
import { obtenerVentasPorRango } from '@/services/reportes'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'
import {
  baseDeCostosFijos,
  categoriasAusentes,
  impuestosEnEgresos,
  puntoDeEquilibrio,
  resumenDeEgresos,
  type EgresoParaFijos,
  type MesDeEgresos,
} from '@/lib/punto-equilibrio'
import { anioDeFecha, mapaDeCostos, margenDelPeriodo, mesDeFecha, type DocDeVenta } from '@/lib/ventas-mensuales'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const claveDeMes = (anio: number, mes: number) => `${anio}-${String(mes).padStart(2, '0')}`

/** Cuántos meses se miran para el margen (uno solo es ruidoso). */
const MESES_PARA_MARGEN = 3
/** Cuántos meses **terminados** se promedian para los costos fijos. */
const MESES_PARA_FIJOS = 3

type EgresoDeFecha = EgresoParaFijos & { fecha?: string }
type Datos = {
  anio: number
  mes: number
  egresos: EgresoDeFecha[]
  docs: DocDeVenta[]
  mesesMedidos: number
}

export function PuntoEquilibrioWidget() {
  const { productos } = useProductos()
  const { config } = useConfiguracion()
  const costos = React.useMemo(() => mapaDeCostos(productos), [productos])
  /** Impuesto que se paga como **porcentaje de lo vendido** (`0` = no hay): sale del margen, no de los fijos. */
  const impuestoVentasPct = Number(config.impuestoVentasPorcentaje) || 0
  /** Días de atención del mes para el «por día» (Configuración → Empresa; 26 de fábrica). */
  const diasDeAtencion = Math.max(1, Math.floor(Number(config.diasAtencionMes) || 26))

  const [datos, setDatos] = React.useState<Datos | null>(null)
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    let vivo = true
    const hoy = new Date()
    const anio = hoy.getFullYear()
    const mes = hoy.getMonth() + 1
    // El margen se mide con los últimos 3 meses (incluido el actual).
    const inicioMedicion = new Date(anio, mes - MESES_PARA_MARGEN, 1)
    // Los fijos necesitan los meses TERMINADOS: se arranca MESES_PARA_FIJOS + 1 hacia atrás.
    const inicioFijos = new Date(anio, mes - 1 - MESES_PARA_FIJOS, 1)

    Promise.all([
      obtenerEgresosPorFecha(iso(inicioFijos), iso(hoy)),
      obtenerVentasPorRango(inicioMedicion, hoy),
    ])
      .then(([egresos, docs]) => {
        if (!vivo) return
        setDatos({
          anio,
          mes,
          egresos: (egresos ?? []) as EgresoDeFecha[],
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
    const claveActual = claveDeMes(datos.anio, datos.mes)

    // 1) Agrupar los egresos por mes (YYYY-MM) para separar el mes en curso de los terminados.
    const grupos = new Map<string, EgresoDeFecha[]>()
    for (const e of datos.egresos) {
      const a = anioDeFecha(e.fecha)
      const m = mesDeFecha(e.fecha)
      if (!a || !m) continue
      const clave = claveDeMes(a, m)
      const lista = grupos.get(clave)
      if (lista) lista.push(e)
      else grupos.set(clave, [e])
    }
    const mesesCompletos: MesDeEgresos[] = [...grupos.entries()]
      .filter(([clave]) => clave < claveActual)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, egresos]) => ({ mes, egresos }))
    const egresosDelMes = grupos.get(claveActual) ?? []

    // 2) ¿Con qué fijos se calcula? Promedio de meses terminados; si no hay, mes en curso = mínimo.
    const base = baseDeCostosFijos({
      mesesCompletos,
      mesEnCurso: { mes: claveActual, egresos: egresosDelMes },
      maximoMeses: MESES_PARA_FIJOS,
    })
    const desglose = resumenDeEgresos(egresosDelMes)
    const faltanCategorias = base.completo ? [] : categoriasAusentes(desglose.porCategoria.map((c) => c.categoria))
    const impuestoComoEgreso = impuestosEnEgresos(egresosDelMes)

    // 3) El margen del período y lo vendido ESTE mes (en neto: la misma base que el margen).
    const periodo = margenDelPeriodo(datos.docs, costos)
    const docsDelMes = datos.docs.filter((d) => anioDeFecha(d.fecha) === datos.anio && mesDeFecha(d.fecha) === datos.mes)
    const vendidoMes = margenDelPeriodo(docsDelMes, costos).ingreso

    return {
      periodo,
      base,
      desglose,
      faltanCategorias,
      impuestoComoEgreso,
      diasDelMes: new Date(datos.anio, datos.mes, 0).getDate(),
      diaDeHoy: new Date().getDate(),
      r: puntoDeEquilibrio({
        costosFijos: base.monto,
        vendido: vendidoMes,
        margen: periodo.margenPct / 100,
        dias: diasDeAtencion,
        impuestoVentasPct,
      }),
    }
  }, [datos, costos, impuestoVentasPct, diasDeAtencion])

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

  const { periodo, base, desglose, faltanCategorias, impuestoComoEgreso, diasDelMes, diaDeHoy, r } = calculo!
  const sinFijos = r.costosFijos <= 0
  const sinMargen = r.equilibrio === null
  const mesesCortos = base.mesesUsados.map((m) => m.slice(5)).join(' + ')

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
            {base.motivo === 'promedio'
              ? `promedio de ${mesesCortos} (meses cerrados)`
              : base.motivo === 'provisionado'
                ? `mes en curso con sus provisiones cargadas`
                : `⚠️ mínimo: día ${diaDeHoy} de ${diasDelMes}, faltan gastos`}
            {desglose.mercaderia > 0 ? ` · (+${fmt(desglose.mercaderia)} de mercadería, no es fijo)` : ''}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Margen de los últimos {datos.mesesMedidos} meses</div>
          <div className="num text-lg font-extrabold">{periodo.margenPct.toFixed(1)}%</div>
          <div className="text-[10px] text-muted-foreground">
            {r.impuestoVentasPct > 0
              ? `− ${r.impuestoVentasPct}% de impuesto = ${(r.margenContribucion * 100).toFixed(1)}% de contribución`
              : 'de cada sol vendido, después de la mercadería'}
          </div>
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

        {!sinFijos && base.motivo === 'incompleto' && (
          <p className="font-semibold text-amber-600">
            ⚠️ <b>Mínimo conocido, no la realidad</b>: el mes va por el día {diaDeHoy} de {diasDelMes} y no hay un
            mes cerrado con gastos suficientes. Cargá los gastos fijos como <b>provisión</b> (aunque todavía no los
            pagues) y el equilibrio pasa a ser el del mes completo.
            {faltanCategorias.length > 0 && (
              <> Falta cargar: <b>{faltanCategorias.join(', ')}</b>.</>
            )}
          </p>
        )}

        {!sinFijos && base.motivo === 'provisionado' && (
          <p>
            ℹ️ Los costos fijos son los <b>provisionados de este mes</b>: cuentan aunque todavía no se hayan pagado
            (devengo). Cuando los pagues, marcá cada uno como <b>«Pagado»</b>: solo los de <b>caja</b> se descuentan
            del efectivo.
          </p>
        )}

        {!sinFijos && base.motivo === 'promedio' && (
          <p>
            ℹ️ Los costos fijos son el <b>promedio de {mesesCortos}</b> (meses cerrados con gastos cargados). El mes en
            curso no entra: hasta que no cierra, sus gastos están incompletos.
          </p>
        )}

        {sinMargen && !sinFijos && (
          <p className="font-semibold text-destructive">
            ⚠️ El margen de los últimos meses es 0% o negativo
            {r.impuestoVentasPct > 0 ? ` (o el impuesto del ${r.impuestoVentasPct}% se lo come todo)` : ''}: con ese margen{' '}
            <b>ningún</b> nivel de venta cubre los costos fijos. Antes de mirar el equilibrio hay que revisar los precios y los costos
            (Inventario → «sin costo»).
          </p>
        )}

        {impuestoComoEgreso > 0 && r.impuestoVentasPct > 0 && (
          <p className="font-semibold text-amber-600">
            ⚠️ Cargaste {fmt(impuestoComoEgreso)} en Egresos con categoría «Impuestos» y además el {r.impuestoVentasPct}% de las ventas
            se descuenta del margen: si ese es el <b>mismo</b> impuesto, se está contando dos veces (el equilibrio sale más alto de lo
            real).
          </p>
        )}

        {r.impuestoVentasPct > 0 && (
          <p>
            ℹ️ El <b>impuesto a las ventas</b> ({r.impuestoVentasPct} %, Configuración → Empresa) <b>no</b> se cuenta como costo fijo:
            crece con lo que vendés, así que se resta del margen (del {periodo.margenPct.toFixed(1)}% de margen quedan{' '}
            {(r.margenContribucion * 100).toFixed(1)}% para cubrir los fijos). Con lo vendido este mes ({fmt(r.vendido)}) te toca{' '}
            <b>{fmt(r.impuestoDelMes)}</b> de impuesto.
          </p>
        )}

        {periodo.itemsSinCosto > 0 && (
          <p className="font-semibold text-amber-600">
            ⚠️ {periodo.itemsSinCosto} línea{periodo.itemsSinCosto === 1 ? '' : 's'} vendida{periodo.itemsSinCosto === 1 ? '' : 's'} sin costo
            en el catálogo: el margen está inflado y el equilibrio sale <b>más bajo</b> de lo real.
          </p>
        )}

        {desglose.porCategoria.length > 0 && (
          <details className="pt-1">
            <summary className="flex cursor-pointer items-center gap-1 font-semibold">
              <Info className="h-3 w-3" /> Qué hay cargado este mes por categoría
            </summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              {desglose.porCategoria.map((c) => (
                <li key={c.categoria} className={cn('flex justify-between gap-2', !c.fijo && 'opacity-60')}>
                  <span>
                    {c.categoria}
                    {!c.fijo && ' · mercadería (no es fijo)'}
                  </span>
                  <span className="num">{fmt(c.monto)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}

        {desglose.mercaderia > 0 && (
          <p>
            ℹ️ La mercadería de este mes ({fmt(desglose.mercaderia)}, categorías «Compras» / pagos a proveedores) <b>no</b> cuenta como
            costo fijo: su costo ya está descontado en el margen. Contarla dos veces pediría vender mucho más de lo necesario.
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
