import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  IGV_RATE,
  afectacionDe,
  esGravado,
  importeBrutoDe,
  itemsConDescuento,
  repartirDescuento,
  totalDeclarado,
  valorUnitarioSunat,
} from './sunat-importes.ts'

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

// ─── IGV: el precio del producto es final al público (con IGV) ────────────────
// Caso del negocio: en Lima un polo cuesta S/ 100 en la etiqueta. La boleta debe
// salir por S/ 100 mostrando el desglose (base 84.75 + IGV 15.25).

test('solo la afectación 10 (gravado) lleva IGV', () => {
  assert.equal(esGravado('10'), true)
  assert.equal(esGravado('20'), false, 'exonerado')
  assert.equal(esGravado('30'), false, 'inafecto')
  assert.equal(esGravado(''), false)
})

test('un producto exonerado se declara al precio tal cual (su caso actual)', () => {
  // Huevos: precio final 0.60, exonerado → la base es 0.60 y no hay IGV.
  assert.equal(valorUnitarioSunat(0.6, '20'), 0.6)
  assert.equal(valorUnitarioSunat(3.0, '30'), 3.0)
})

test('un polo gravado de S/ 100 se declara con base 84.75 (sin IGV)', () => {
  const valor = valorUnitarioSunat(100, '10')
  assert.equal(Number(valor.toFixed(2)), 84.75)
  assert.equal(Number((valor * 1).toFixed(2)), 84.75, 'base de 1 unidad')
  // y el IGV sale de la diferencia: 100 − 84.75 = 15.25
  assert.equal(Number((100 - Number(valor.toFixed(2))).toFixed(2)), 15.25)
})

test('el valor sin IGV multiplicado por la cantidad da la base de la línea', () => {
  const valor = valorUnitarioSunat(100, '10')
  for (const cantidad of [1, 2, 3, 7, 12]) {
    const base = Math.round(valor * cantidad * 100) / 100
    // base + IGV debe dar el importe cobrado (100 × cantidad) al céntimo
    const total = Math.round(valor * cantidad * (1 + IGV_RATE) * 100) / 100
    assert.equal(total, Math.round(cantidad * 100 * 100) / 100, `${cantidad} unidades`)
    assert.ok(base < total, 'la base es menor al total (hay IGV)')
  }
})

test('con descuento: primero se reparte el descuento y después se despeja el IGV', () => {
  // Polo de 100 con 20 de descuento → se cobra 80 → base 67.80 + IGV 12.20
  const conDescuento = itemsConDescuento([{ id: 'polo', cantidad: 1, precioVenta: 100, subtotal: 100, tipoAfectacion: '10' }], 20)
  assert.equal(conDescuento[0].subtotal, 80)
  const valor = valorUnitarioSunat(conDescuento[0].precioVenta, '10')
  const base = Math.round(valor * 1 * 100) / 100
  const total = Math.round(valor * 1 * (1 + IGV_RATE) * 100) / 100
  assert.equal(base, 67.8)
  assert.equal(total, 80, 'lo cobrado, al céntimo')
})

// ─── Afectación declarada (el bug de los pedidos) ─────────────────────────────

test('manda la afectación del propio item', () => {
  assert.equal(afectacionDe({ tipoAfectacion: '20' }), '20')
  assert.equal(afectacionDe({ tipoAfectacion: '10' }), '10')
  assert.equal(afectacionDe({ tipoAfectacionEfectivo: '30', tipoAfectacion: '10' }), '30')
})

test('un item SIN afectación cae en el default del negocio (región exonerada)', () => {
  // ⚠️ Era el bug: los items del pedido viajaban sin `tipoAfectacion`, así que un producto
  // exonerado se declaraba GRAVADO y el comprobante sumaba 18% de IGV que nadie cobró.
  assert.equal(afectacionDe({}, { regionExonerada: true }), '20')
  assert.equal(afectacionDe(null, { regionExonerada: true }), '20')
  assert.equal(afectacionDe(undefined, { regionExonerada: true }), '20')
})

test('sin región exonerada, lo que no trae afectación es gravado (comportamiento histórico)', () => {
  assert.equal(afectacionDe({}), '10')
  assert.equal(afectacionDe({}, { regionExonerada: false }), '10')
})

test('la afectación propia gana sobre la config: la región exonerada NO es un override', () => {
  assert.equal(afectacionDe({ tipoAfectacion: '10' }, { regionExonerada: true }), '10')
})

test('una afectación vacía o en blanco se trata como ausente', () => {
  assert.equal(afectacionDe({ tipoAfectacion: '' }, { regionExonerada: true }), '20')
  assert.equal(afectacionDe({ tipoAfectacion: '   ' }, { regionExonerada: true }), '20')
})
