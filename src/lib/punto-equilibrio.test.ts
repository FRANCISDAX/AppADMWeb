/**
 * **El punto de equilibrio** (`lib/punto-equilibrio.ts`).
 *
 * ⚠️ Lo que estos tests fijan es lo que puede hacer daño si se calcula mal: que **la mercadería no
 * cuente como costo fijo** (se pagaría dos veces), que **el impuesto a las ventas salga del margen**
 * (es variable: como fijo el equilibrio queda corto) y que **con margen 0 o negativo no se invente un
 * número** — ahí no hay equilibrio posible y la pantalla tiene que decirlo.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { comprasDeEgresos, costosFijosDe, esCostoFijo, puntoDeEquilibrio } from './punto-equilibrio.ts'

describe('esCostoFijo — la mercadería NO es un costo fijo', () => {
  it('alquiler, sueldos, servicios e impuestos son fijos', () => {
    for (const categoria of ['Alquiler', 'Sueldos', 'Servicios', 'Impuestos', 'Mantenimiento', 'Transporte', 'Otros']) {
      assert.equal(esCostoFijo({ categoria }), true, categoria)
    }
  })

  it('«Compras» es mercadería (costo variable), no un fijo', () => {
    // 📌 El caso real: las bolsas se cargaron en Gastos/Egresos con la categoría «Compras». Su costo ya
    // está adentro del margen; contarlo como fijo pediría vender mucho más de lo necesario.
    assert.equal(esCostoFijo({ categoria: 'Compras' }), false)
    assert.equal(esCostoFijo({ categoria: 'compras ' }), false, 'sin importar mayúsculas ni espacios')
  })

  it('una categoría que no conocemos cuenta como fija (no se esconde un gasto)', () => {
    assert.equal(esCostoFijo({ categoria: 'Algo nuevo' }), true)
    assert.equal(esCostoFijo({ categoria: '' }), true)
    assert.equal(esCostoFijo(null), true)
  })
})

describe('costosFijosDe / comprasDeEgresos', () => {
  const egresos = [
    { categoria: 'Alquiler', monto: 1200 },
    { categoria: 'Sueldos', monto: 1500 },
    { categoria: 'Compras', monto: 800 },
    { categoria: 'Servicios', monto: 300 },
    { categoria: 'Compras', monto: 200 },
  ]

  it('suma solo los fijos', () => {
    assert.equal(costosFijosDe(egresos), 3000, '1200 + 1500 + 300: la mercadería queda afuera')
  })

  it('y dice aparte cuánto fue mercadería (para poder avisarlo)', () => {
    assert.equal(comprasDeEgresos(egresos), 1000, '800 + 200')
  })

  it('un monto basura no rompe la suma', () => {
    assert.equal(costosFijosDe([{ categoria: 'Alquiler', monto: 'x' as unknown as number }]), 0)
    assert.equal(costosFijosDe(null), 0)
  })
})

describe('puntoDeEquilibrio — la cuenta', () => {
  it('fijos ÷ margen: con S/ 3.000 fijos y 25% hay que vender S/ 12.000', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 4000, margen: 0.25 })
    assert.equal(r.equilibrio, 12000)
    assert.equal(r.falta, 8000, 'vendió 4.000: le faltan 8.000')
    assert.equal(r.avancePct, 33.33, 'un tercio del camino')
    assert.equal(r.alcanzado, false)
    assert.equal(r.porDia, 461.54, '12.000 en 26 días')
  })

  it('pasado el equilibrio, no “falta” nada y avisa que ya está alcanzado', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 15000, margen: 0.25 })
    assert.equal(r.falta, 0)
    assert.equal(r.alcanzado, true)
    assert.equal(r.avancePct, 100, 'la barra no pasa del 100%')
  })

  it('respeta los días de atención para el “por día”', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 0, margen: 0.25, dias: 30 })
    assert.equal(r.porDia, 400)
    assert.equal(r.dias, 30)
  })

  it('⚠️ con margen 0 o negativo NO hay equilibrio: devuelve null, no un número imposible', () => {
    for (const margen of [0, -0.1]) {
      const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 5000, margen })
      assert.equal(r.equilibrio, null, `margen ${margen}`)
      assert.equal(r.falta, null)
      assert.equal(r.porDia, null)
      assert.equal(r.alcanzado, false)
      assert.equal(r.avancePct, 0)
    }
  })

  it('sin costos fijos cargados el equilibrio es 0 (y ya está alcanzado)', () => {
    const r = puntoDeEquilibrio({ costosFijos: 0, vendido: 100, margen: 0.25 })
    assert.equal(r.equilibrio, 0)
    assert.equal(r.alcanzado, true)
    assert.equal(r.porDia, 0)
  })

  it('un margen de 1 (mercadería sin costo) da un equilibrio igual a los fijos', () => {
    // No es un error de la cuenta: es el síntoma de que faltan costos, y por eso el margen se mide
    // aparte y la pantalla avisa los ítems sin costo.
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 0, margen: 1 })
    assert.equal(r.equilibrio, 3000)
  })

  it('valores basura no producen NaN', () => {
    const r = puntoDeEquilibrio({ costosFijos: Number.NaN, vendido: Number.NaN, margen: 0.3 })
    assert.equal(r.costosFijos, 0)
    assert.equal(r.vendido, 0)
    assert.equal(r.equilibrio, 0)
  })
})

describe('puntoDeEquilibrio — el impuesto a las ventas (costo VARIABLE)', () => {
  // 📌 El caso real (29/09/2026): fijos S/ 212 (internet 127 + agua 15 + luz 70) y un pago a cuenta del
  // **1,5 % de lo vendido**. Cargarlo como Egreso del mes lo volvía un costo fijo y el equilibrio salía
  // **S/ 966,11**; restándolo del margen da **S/ 1.015,81**. La diferencia no es cosmética: S/ 49,70 al mes.
  const MARGEN = 0.2237
  const IMPUESTO = 1.5

  it('sin impuesto (0 o sin el parámetro) la cuenta es la de siempre', () => {
    const sinParametro = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN })
    const conCero = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: 0 })
    assert.equal(conCero.equilibrio, sinParametro.equilibrio, 'una config vieja (sin el campo) no paga nada')
    assert.equal(conCero.margenContribucion, MARGEN)
    assert.equal(conCero.impuestoDelMes, 0)
  })

  it('el impuesto se RESTA del margen y el equilibrio sube', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    assert.equal(r.margen, MARGEN, 'el margen medido no se toca: se informa aparte')
    assert.equal(r.margenContribucion, 0.2087, '22,37 % − 1,50 %')
    assert.equal(r.equilibrio, 1015.81, '212 ÷ 0,2087')
    assert.equal(r.porDia, 39.07)
    assert.equal(r.impuestoVentasPct, IMPUESTO)
  })

  it('y NO como un costo fijo: la diferencia se mide', () => {
    const variable = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    const comoFijo = puntoDeEquilibrio({ costosFijos: 212 + 4.12, vendido: 274.6, margen: MARGEN })
    assert.equal(comoFijo.equilibrio, 966.12, 'cargado en Egresos del mes (el 1,5 % de lo vendido: S/ 4,12)')
    assert.ok((variable.equilibrio ?? 0) > (comoFijo.equilibrio ?? 0), 'el variable exige vender más: el fijo queda corto')
  })

  it('dice cuánto se lleva el impuesto de lo vendido (para cotejarlo con lo que se paga)', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 1000, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    assert.equal(r.impuestoDelMes, 15, '1,5 % de 1.000')
  })

  it('⚠️ si el impuesto se come todo el margen, no hay equilibrio: null, no un número imposible', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 500, margen: 0.01, impuestoVentasPct: 1.5 })
    assert.equal(r.equilibrio, null)
    assert.equal(r.falta, null)
    assert.equal(r.porDia, null)
    assert.equal(r.margenContribucion, -0.005, 'queda negativo: vender más agranda la pérdida')
  })

  it('un impuesto basura o negativo no inventa plata', () => {
    assert.equal(puntoDeEquilibrio({ costosFijos: 212, vendido: 0, margen: MARGEN, impuestoVentasPct: Number.NaN }).impuestoVentasPct, 0)
    assert.equal(puntoDeEquilibrio({ costosFijos: 212, vendido: 0, margen: MARGEN, impuestoVentasPct: -5 }).margenContribucion, MARGEN)
  })
})

/**
 * 🛡️ **Test-guarda del cableado**: la cuenta del impuesto está en `lib/` (una sola implementación), y
 * la tarjeta tiene que **leer el porcentaje de la configuración** y pasarlo. Si alguien agrega el campo
 * y no lo conecta —o lo conecta a los fijos en vez del margen— el número vuelve a mentir sin que nada
 * falle. Se lee el código fuente porque el cálculo es puro y el cableado es lo que puede romperse.
 */
describe('🛡️ el impuesto llega desde la configuración hasta la cuenta', () => {
  const aca = dirname(fileURLToPath(import.meta.url))
  const widget = readFileSync(join(aca, '..', 'components', 'dashboard', 'PuntoEquilibrioWidget.tsx'), 'utf8')

  it('existe en la configuración y por defecto es 0 (sin impuesto)', () => {
    const def = readFileSync(join(aca, '..', 'constants', 'tributario.ts'), 'utf8')
    assert.match(def, /impuestoVentasPorcentaje: 0/, 'el default tiene que estar declarado')
  })

  it('la tarjeta lo lee de la config y se lo pasa a puntoDeEquilibrio', () => {
    assert.match(widget, /const impuestoVentasPct = Number\(config\.impuestoVentasPorcentaje\) \|\| 0/)
    assert.match(widget, /puntoDeEquilibrio\(\{[\s\S]*impuestoVentasPct,/)
  })

  it('y se puede guardar desde Configuración', () => {
    const pagina = readFileSync(join(aca, '..', 'pages', 'Configuracion.tsx'), 'utf8')
    assert.match(pagina, /set\('impuestoVentasPorcentaje',/)
  })
})
