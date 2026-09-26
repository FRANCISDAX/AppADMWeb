/**
 * Tests de la calculadora de precio de venta (`lib/precio-venta.ts`).
 *
 * 🔑 **Lo que estos tests protegen**, que es lo que puede costar plata de verdad:
 *
 * - **Margen vs markup**: con un costo de S/ 3.1667, «30% sobre el costo» da S/ 4.12 y «30% sobre el
 *   precio» da S/ 4.52. Confundirlos deja menos margen del que el negocio pidió, y la diferencia
 *   (23,1% contra 30%) es la que este módulo hace visible.
 * - **El IGV no es plata del negocio**: en un producto gravado, el margen se mide **sin IGV**, y el
 *   precio que se propone **ya lo incluye** (nunca se recarga al cobrar).
 * - **El redondeo sube, no baja**: el margen objetivo es un piso. Y no se va un escalón de más por un
 *   céntimo de coma flotante.
 * - **Los casos en los que la cuenta no existe** (sin costo, margen ≥ 100%): devuelve `null` en vez de
 *   un número inventado o un `Infinity` que después se guarda en la base.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { margenDePrecio, precioDesdeMargen, precioFinalConIgv, precioSinIgv, redondearPrecio } from './precio-venta.ts'

/** El costo del caso real del usuario: una caja de 12 a S/ 38. */
const COSTO_CAJA = 38 / 12 // 3.1666…

describe('precioSinIgv / precioFinalConIgv', () => {
  it('un exonerado no lleva IGV: el precio es la plata del negocio', () => {
    assert.equal(precioSinIgv(10, '20'), 10)
    assert.equal(precioFinalConIgv(10, '20'), 10)
  })

  it('un gravado despeja el 18% (y lo vuelve a sumar al revés)', () => {
    assert.equal(Number(precioSinIgv(118, '10').toFixed(2)), 100)
    assert.equal(Number(precioFinalConIgv(100, '10').toFixed(2)), 118)
    // Ida y vuelta: no se pierde ni se inventa plata.
    assert.equal(Number(precioFinalConIgv(precioSinIgv(99.9, '10'), '10').toFixed(2)), 99.9)
  })

  it('una afectación vacía o rara se trata como exonerada (no se inventa IGV)', () => {
    assert.equal(precioSinIgv(50), 50)
    assert.equal(precioSinIgv(50, ''), 50)
    assert.equal(precioSinIgv(50, '30'), 50, 'inafecto')
  })
})

describe('margenDePrecio (qué deja el precio que ya se escribió)', () => {
  it('mide el margen sobre el precio de venta y también el markup sobre el costo', () => {
    const m = margenDePrecio(4.5238, COSTO_CAJA, '20')
    assert.equal(Number(m.margenPct.toFixed(1)), 30.0)
    assert.equal(Number(m.markupPct.toFixed(1)), 42.9, 'el mismo precio, leído sobre el costo')
    assert.equal(m.margen, 1.36)
    assert.equal(m.gravado, false)
  })

  it('el markup del 30% deja 23,1% de margen (la confusión que cuesta plata)', () => {
    const precio = precioDesdeMargen(COSTO_CAJA, { margenPct: 30, base: 'costo' })
    assert.equal(precio, 4.12)
    const m = margenDePrecio(4.12, COSTO_CAJA, '20')
    assert.equal(Number(m.margenPct.toFixed(1)), 23.1)
  })

  it('un producto gravado devuelve el margen real (sin el IGV que no es del negocio)', () => {
    // El mismo precio de S/ 4.52 con IGV: al negocio le quedan S/ 3.83 → el margen NO es 30%.
    const m = margenDePrecio(4.52, COSTO_CAJA, '10')
    assert.equal(m.neto, 3.83)
    assert.equal(Number(m.margenPct.toFixed(1)), 17.3)
    assert.equal(m.gravado, true)
  })

  it('vender por debajo del costo da margen negativo (no lo esconde)', () => {
    const m = margenDePrecio(2, COSTO_CAJA, '20')
    assert.ok(m.margen < 0)
    assert.ok(m.margenPct < 0)
  })

  it('sin precio o sin costo no rompe ni inventa porcentajes', () => {
    const sinPrecio = margenDePrecio(0, COSTO_CAJA, '20')
    assert.equal(sinPrecio.margenPct, 0)
    const sinCosto = margenDePrecio(4.5, 0, '20')
    assert.equal(sinCosto.markupPct, 0, 'sin costo no hay markup que calcular')
    assert.equal(sinCosto.margenPct, 100)
  })
})

describe('precioDesdeMargen (de margen objetivo a precio)', () => {
  it('margen sobre el PRECIO de venta: costo ÷ (1 − m)', () => {
    // 3.1667 ÷ 0.70 = 4.5238 → 4.52 (y ese precio deja el 30% pedido; al redondear al céntimo baja
    // una décima de punto: 29,9% — por eso existe el redondeo hacia arriba).
    assert.equal(precioDesdeMargen(COSTO_CAJA, { margenPct: 30, base: 'precio' }), 4.52)
    const m = margenDePrecio(4.52, COSTO_CAJA, '20').margenPct
    assert.ok(m >= 29.9 && m <= 30, `deja ~30% (${m.toFixed(2)}%)`)
  })

  it('markup sobre el COSTO: costo × (1 + m)', () => {
    assert.equal(precioDesdeMargen(COSTO_CAJA, { margenPct: 30, base: 'costo' }), 4.12)
  })

  it('con un producto gravado, el precio que devuelve YA incluye el IGV', () => {
    // Para ganar 30% sobre un gravado el precio final tiene que ser 5.34, no 4.52.
    const precio = precioDesdeMargen(COSTO_CAJA, { margenPct: 30, base: 'precio', afectacion: '10' })
    assert.equal(precio, 5.34)
    assert.equal(Number(margenDePrecio(5.34, COSTO_CAJA, '10').margenPct.toFixed(1)), 30.0)
  })

  it('el caso del usuario, con los dos ejemplos de compra', () => {
    // Caja de 12 a S/ 38 → 3.1667 por botella; paquete de 6 a S/ 12 → 2.00 por galleta.
    assert.equal(precioDesdeMargen(38 / 12, { margenPct: 25, base: 'precio' }), 4.22)
    assert.equal(precioDesdeMargen(12 / 6, { margenPct: 25, base: 'precio' }), 2.67)
  })

  it('devuelve null cuando la cuenta no existe (en vez de Infinity o un número inventado)', () => {
    assert.equal(precioDesdeMargen(0, { margenPct: 30 }), null, 'sin costo no hay margen')
    assert.equal(precioDesdeMargen(COSTO_CAJA, { margenPct: 100, base: 'precio' }), null, 'margen 100% divide por cero')
    assert.equal(precioDesdeMargen(COSTO_CAJA, { margenPct: 120, base: 'precio' }), null)
    assert.equal(precioDesdeMargen(COSTO_CAJA, { margenPct: Number.NaN }), null)
    // Con markup sí se puede pasar de 100% (recargar más del doble es una decisión, no un error).
    assert.equal(precioDesdeMargen(10, { margenPct: 150, base: 'costo' }), 25)
  })
})

describe('redondearPrecio (siempre hacia arriba: el margen es un piso)', () => {
  it('sin redondear deja el céntimo exacto', () => {
    assert.equal(redondearPrecio(4.5238, 'exacto'), 4.52)
    assert.equal(redondearPrecio(4.5238), 4.52)
  })

  it('a .00 o .50 sube al escalón siguiente', () => {
    assert.equal(redondearPrecio(4.5238, 'medio'), 5.0)
    assert.equal(redondearPrecio(4.12, 'medio'), 4.5)
    assert.equal(redondearPrecio(4.5, 'medio'), 4.5, 'un precio que ya está redondeado no se mueve')
  })

  it('a .00, .50 o .90 (los finales de tienda)', () => {
    assert.equal(redondearPrecio(4.5238, 'comercio'), 4.9)
    assert.equal(redondearPrecio(4.12, 'comercio'), 4.5)
    assert.equal(redondearPrecio(5, 'comercio'), 5)
    assert.equal(redondearPrecio(4.95, 'comercio'), 5)
    assert.equal(redondearPrecio(3.2, 'comercio'), 3.5)
  })

  it('a la décima', () => {
    assert.equal(redondearPrecio(4.5238, 'decima'), 4.6)
    assert.equal(redondearPrecio(4.5, 'decima'), 4.5)
  })

  it('un céntimo de coma flotante no empuja el precio un escalón de más', () => {
    assert.equal(redondearPrecio(4.5 + 1e-12, 'medio'), 4.5)
    assert.equal(redondearPrecio(4.9 + 1e-12, 'comercio'), 4.9)
  })

  it('nunca devuelve un precio negativo', () => {
    assert.equal(redondearPrecio(-3, 'comercio'), 0)
    assert.equal(redondearPrecio(0, 'medio'), 0)
  })

  it('el redondeo no puede bajar el margen objetivo', () => {
    const exacto = precioDesdeMargen(COSTO_CAJA, { margenPct: 30 })
    const redondeado = precioDesdeMargen(COSTO_CAJA, { margenPct: 30, redondeo: 'comercio' })
    assert.ok(redondeado !== null && exacto !== null && redondeado >= exacto)
    assert.ok(margenDePrecio(redondeado, COSTO_CAJA, '20').margenPct >= 30)
  })
})
