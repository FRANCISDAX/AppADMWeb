/**
 * **El punto de equilibrio** (`lib/punto-equilibrio.ts`).
 *
 * ⚠️ Lo que estos tests fijan es lo que puede hacer daño si se calcula mal: que **la mercadería no
 * cuente como costo fijo** (se pagaría dos veces) y que **con margen 0 o negativo no se invente un
 * número** — ahí no hay equilibrio posible y la pantalla tiene que decirlo.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

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
