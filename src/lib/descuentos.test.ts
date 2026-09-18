import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { calcularDescuentos, revisarDescuentoManual, type DescuentoVolumen } from './descuentos.ts'

/**
 * Caso real del negocio (huevos): precio de lista S/ 0.60 y una promoción de
 * volumen del 16,67% (equivale a bajar el unitario a S/ 0.50) que aplica **desde
 * 2 unidades**. El producto se vende por unidad, media docena (factor 6) y
 * docena (factor 12).
 *
 * ⚠️ El PDV debe mandar el precio **por unidad base** y la cantidad en
 * **unidades base** (`cantidad: qty * factor`). Si manda `precio × factor` con
 * `cantidad: qty`, la media docena entra como cantidad 1, la promo no llega al
 * mínimo de 2 y el huevo queda a 0.60 en vez de 0.50. Estos tests fijan ese
 * contrato.
 */
const PROMO_HUEVOS: DescuentoVolumen = {
  promocionId: 'promo-huevos',
  nombre: 'Huevo desde 2 a 0.50',
  tipo: 'porcentaje',
  descuento: 16.67,
  valor: 16.67,
  productos: ['huevos'],
}

const item = (cantidadBase: number, precioBase = 0.6) => ({
  productoId: 'huevos',
  nombre: 'Huevo',
  precioUnitario: precioBase,
  cantidad: cantidadBase,
})

const total = (cantidadBase: number): number =>
  calcularDescuentos([item(cantidadBase)], { reglasVolumen: [PROMO_HUEVOS] }).totalFinal

test('1 huevo suelto se cobra al precio de lista (la promo arranca en 2)', () => {
  const r = calcularDescuentos([item(1)], { reglasVolumen: [PROMO_HUEVOS] })
  assert.equal(r.totalFinal, 0.6)
  assert.equal(r.volumen.length, 0, 'no se aplica ninguna promoción con 1 unidad')
})

test('2 huevos: la promo baja el unitario a 0.50', () => {
  assert.equal(total(2), 1.0)
})

test('media docena (6 unidades base) también recibe la promo', () => {
  // Este es el bug que se corrigió: con cantidad 1 (una unidad de venta) la
  // promo no se aplicaba y la media docena salía S/ 3.60 en vez de S/ 3.00.
  assert.equal(total(6), 3.0, 'media docena a S/ 3.00 (0.50 c/u)')
})

test('docena completa (12) a S/ 6.00', () => {
  assert.equal(total(12), 6.0)
})

test('cantidades impares también quedan a 0.50 por unidad', () => {
  assert.equal(total(3), 1.5)
  assert.equal(total(7), 3.5)
  assert.equal(total(50), 25.0)
})

test('el subtotal bruto sigue siendo precio × unidades base', () => {
  const r = calcularDescuentos([item(6)], { reglasVolumen: [PROMO_HUEVOS] })
  assert.equal(r.totalBruto, 3.6)
  assert.equal(r.totalDescuento, 0.6)
  assert.equal(r.totalFinal, 3.0)
})

test('la promo se aplica sumando todas las líneas del mismo producto', () => {
  // 1 suelto + media docena = 7 huevos → 7 × 0.50
  const r = calcularDescuentos([item(1), item(6)], { reglasVolumen: [PROMO_HUEVOS] })
  assert.equal(r.totalFinal, 3.5)
})

test('sin promociones cargadas no se descuenta nada', () => {
  const r = calcularDescuentos([item(6)], { reglasVolumen: [] })
  assert.equal(r.totalFinal, 3.6)
})

test('una promoción inactiva o de otro producto no toca la venta', () => {
  const otra = { ...PROMO_HUEVOS, productos: ['gaseosas'] }
  assert.equal(calcularDescuentos([item(6)], { reglasVolumen: [otra] }).totalFinal, 3.6)
})

test('el descuento por producto y el de volumen se acumulan en orden', () => {
  const r = calcularDescuentos([{ ...item(6), descuentoPorcentaje: 10 }], { reglasVolumen: [PROMO_HUEVOS] })
  // 3.60 − 10% = 3.24; luego la promo del 16.67% sobre 3.24 → 2.70
  assert.equal(r.totalFinal, 2.7)
})

// ─── Tope del descuento manual (política del negocio) ──────────────────────────

test('sin tope configurado (0) no se recorta nada', () => {
  const r = revisarDescuentoManual({ tipo: 'porcentaje', valor: 80, subtotal: 100, topePorcentaje: 0 })
  assert.equal(r.excede, false)
  assert.equal(r.valorAjustado, 80)
  assert.equal(r.mensaje, '')
})

test('un descuento dentro del tope pasa tal cual', () => {
  const r = revisarDescuentoManual({ tipo: 'porcentaje', valor: 10, subtotal: 200, topePorcentaje: 15 })
  assert.equal(r.excede, false)
  assert.equal(r.porcentaje, 10)
  assert.equal(r.valorAjustado, 10)
})

test('justo en el tope NO excede (el límite es el límite)', () => {
  const r = revisarDescuentoManual({ tipo: 'porcentaje', valor: 15, subtotal: 200, topePorcentaje: 15 })
  assert.equal(r.excede, false)
})

test('un porcentaje mayor al tope se recorta al tope', () => {
  const r = revisarDescuentoManual({ tipo: 'porcentaje', valor: 40, subtotal: 200, topePorcentaje: 15 })
  assert.equal(r.excede, true)
  assert.equal(r.valorAjustado, 15)
  assert.match(r.mensaje, /15%/)
})

test('un descuento EN SOLES se mide en porcentaje contra el subtotal', () => {
  // S/ 60 sobre S/ 200 = 30% → con tope 15% se recorta a S/ 30.
  const r = revisarDescuentoManual({ tipo: 'monto', valor: 60, subtotal: 200, topePorcentaje: 15 })
  assert.equal(r.porcentaje, 30)
  assert.equal(r.excede, true)
  assert.equal(r.valorAjustado, 30)
})

test('un monto chico en una venta grande no excede', () => {
  // S/ 5 sobre S/ 200 = 2.5% → pasa con tope 10%.
  const r = revisarDescuentoManual({ tipo: 'monto', valor: 5, subtotal: 200, topePorcentaje: 10 })
  assert.equal(r.porcentaje, 2.5)
  assert.equal(r.excede, false)
  assert.equal(r.valorAjustado, 5)
})

test('carrito vacío (subtotal 0) no puede exceder nada ni dividir por cero', () => {
  const r = revisarDescuentoManual({ tipo: 'monto', valor: 50, subtotal: 0, topePorcentaje: 10 })
  assert.equal(r.porcentaje, 0)
  assert.equal(r.excede, false)
})

test('valores raros (negativos, NaN, undefined) no rompen ni descuentan', () => {
  assert.equal(revisarDescuentoManual({ tipo: 'porcentaje', valor: -10, subtotal: 100, topePorcentaje: 15 }).valorAjustado, 0)
  assert.equal(revisarDescuentoManual({ tipo: 'porcentaje', valor: NaN, subtotal: 100, topePorcentaje: 15 }).excede, false)
  assert.equal(revisarDescuentoManual({ tipo: 'monto', valor: 10, subtotal: Number('x'), topePorcentaje: 15 }).excede, false)
})
