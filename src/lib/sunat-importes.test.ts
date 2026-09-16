import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { importeBrutoDe, itemsConDescuento, repartirDescuento, totalDeclarado } from './sunat-importes.ts'

/** Item como se guarda en el documento (web): cantidad en unidades base. */
const item = (cantidad: number, precioVenta: number, extra: Record<string, unknown> = {}) => ({
  id: 'huevos',
  nombre: 'Huevo',
  cantidad,
  precioVenta,
  subtotal: Math.round(cantidad * precioVenta * 100) / 100,
  ...extra,
})

const suma = (items: { subtotal?: number }[]) => Math.round(items.reduce((s, it) => s + (Number(it.subtotal) || 0), 0) * 100) / 100

test('sin descuento los items quedan igual (el camino normal no cambia)', () => {
  const items = [item(6, 0.6)]
  const r = itemsConDescuento(items, 0)
  assert.equal(r[0].precioVenta, 0.6)
  assert.equal(r[0].subtotal, 3.6)
  assert.equal(totalDeclarado(items, 0), 3.6)
})

test('caso real: media docena con promo del 16.67% declara S/ 3.00, no S/ 3.60', () => {
  // El PDV cobra 3.00 (descuento 0.60 sobre 3.60) — eso es lo que debe declarar.
  const items = [item(6, 0.6)]
  const r = itemsConDescuento(items, 0.6)
  assert.equal(r[0].subtotal, 3.0)
  assert.equal(r[0].precioVenta, 0.5, 'precio unitario efectivo')
  assert.equal(totalDeclarado(items, 0.6), 3.0)
})

test('la docena declara S/ 6.00 (0.50 por huevo)', () => {
  const items = [item(12, 0.6)]
  const r = itemsConDescuento(items, 1.2)
  assert.equal(r[0].subtotal, 6.0)
  assert.equal(r[0].precioVenta, 0.5)
})

test('un huevo suelto no lleva descuento y declara 0.60', () => {
  const items = [item(1, 0.6)]
  assert.equal(totalDeclarado(items, 0), 0.6)
  assert.equal(itemsConDescuento(items, 0)[0].precioVenta, 0.6)
})

test('el descuento se reparte y la suma de las líneas es exacta', () => {
  const items = [item(3, 1.5), item(2, 0.9), item(7, 0.35)]
  const bruto = suma(items.map((it) => ({ subtotal: importeBrutoDe(it) })))
  const partes = repartirDescuento(items, 1.11)
  assert.equal(suma(partes.map((p) => ({ subtotal: p }))), 1.11, 'el descuento repartido suma exacto')
  const r = itemsConDescuento(items, 1.11)
  assert.equal(suma(r), Math.round((bruto - 1.11) * 100) / 100, 'las líneas suman el total cobrado')
  assert.equal(totalDeclarado(items, 1.11), Math.round((bruto - 1.11) * 100) / 100)
})

test('descuento con céntimos imposibles de repartir: el sobrante cae en una línea', () => {
  // 3 líneas iguales y 0.01 de descuento → no se puede repartir en 3 partes iguales
  const items = [item(1, 1), item(1, 1), item(1, 1)]
  const partes = repartirDescuento(items, 0.01)
  assert.equal(Math.round(partes.reduce((s, x) => s + x, 0) * 100) / 100, 0.01)
})

test('un descuento mayor al total no deja importes negativos', () => {
  const items = [item(2, 0.6)]
  const r = itemsConDescuento(items, 99)
  assert.equal(suma(r), 0)
  assert.ok(r.every((it) => (it.subtotal ?? 0) >= 0))
})

test('los items manuales también entran en el reparto', () => {
  const catalogo = item(6, 0.6) // 3.60
  const manual = { id: 'manual-1', nombre: 'Bolsa', cantidad: 1, precioVenta: 0.5, subtotal: 0.5 }
  const items = [catalogo, manual] // bruto 4.10
  const r = itemsConDescuento(items, 0.7)
  assert.equal(suma(r), 3.4, 'cada línea recibe su parte del descuento')
  assert.equal(r[0].subtotal, 2.99, 'catálogo: 3.60 − 0.61')
  assert.equal(r[1].subtotal, 0.41, 'manual: 0.50 − 0.09')
})

test('cantidad 0 (o rara) no rompe el precio unitario', () => {
  const r = itemsConDescuento([{ id: 'x', cantidad: 0, precioVenta: 2, subtotal: 2 }], 0.5)
  assert.equal(r[0].subtotal, 1.5)
  assert.ok(Number.isFinite(Number(r[0].precioVenta)))
})

test('el precio unitario declarado reconstruye el importe de la línea', () => {
  // Lo que hace el backend: base = cantidad × precio_unitario
  const items = [item(6, 0.6), item(3, 2.5)]
  const r = itemsConDescuento(items, 1.8)
  for (const it of r) {
    const base = Math.round(Number(it.cantidad) * Number(it.precioVenta) * 100) / 100
    assert.equal(base, it.subtotal, `línea ${String(it.id)}: ${String(it.cantidad)} × ${String(it.precioVenta)} = ${String(it.subtotal)}`)
  }
})
