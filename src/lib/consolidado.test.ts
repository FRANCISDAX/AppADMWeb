import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  CLIENTE_CONSOLIDADO_POR_DEFECTO,
  DNI_CONSOLIDADO_POR_DEFECTO,
  consolidarItems,
  descuentoConsolidado,
  documentoClienteConsolidado,
  nombreClienteConsolidado,
  totalConsolidado,
} from './consolidado.ts'

// 🔑 Receptor de la boleta consolidada (21/09/2026): una consolidada agrupa las notas de venta del
// día y **no tiene un cliente real** — el nombre es un rótulo que se imprime y se declara a SUNAT.
// El nombre estaba fijo en 'CONSUMIDOR FINAL' (y ahora es configurable desde Configuración → SUNAT).

test('sin configuración, el receptor de la consolidada sigue siendo el de siempre', () => {
  assert.equal(nombreClienteConsolidado(undefined), CLIENTE_CONSOLIDADO_POR_DEFECTO)
  assert.equal(nombreClienteConsolidado({}), 'CONSUMIDOR FINAL')
  assert.equal(nombreClienteConsolidado(null), 'CONSUMIDOR FINAL')
})

test('el nombre configurado se usa tal cual (con los espacios de los bordes recortados)', () => {
  assert.equal(nombreClienteConsolidado({ clienteDefaultNombre: 'VENTAS DEL DÍA' }), 'VENTAS DEL DÍA')
  assert.equal(nombreClienteConsolidado({ clienteDefaultNombre: '  CLIENTES VARIOS  ' }), 'CLIENTES VARIOS')
})

test('un nombre en blanco NO se declara: vuelve al valor por defecto', () => {
  // ⚠️ Nunca se manda un receptor sin nombre a SUNAT ni se imprime una boleta con el campo vacío.
  assert.equal(nombreClienteConsolidado({ clienteDefaultNombre: '' }), 'CONSUMIDOR FINAL')
  assert.equal(nombreClienteConsolidado({ clienteDefaultNombre: '   ' }), 'CONSUMIDOR FINAL')
  assert.equal(nombreClienteConsolidado({ clienteDefaultNombre: null }), 'CONSUMIDOR FINAL')
})

test('el documento del receptor también es configurable, con 00000000 como respaldo', () => {
  assert.equal(documentoClienteConsolidado(undefined), DNI_CONSOLIDADO_POR_DEFECTO)
  assert.equal(documentoClienteConsolidado({ clienteDefaultDni: '00000000' }), '00000000')
  assert.equal(documentoClienteConsolidado({ clienteDefaultDni: ' ' }), '00000000')
  assert.equal(documentoClienteConsolidado({ clienteDefaultDni: '20123456789' }), '20123456789')
})

// 📌 Caso real (18/09/2026): la boleta consolidada de una NV con promoción salía con las líneas
// a precio de lista, el total neto y **sin ninguna fila de descuento** que lo explicara.

const nv = (total: number, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  id: `2026-9_NV01-${total}`,
  venta: { total, items, ...extra },
})

test('el descuento del consolidado es la suma de los descuentos de cada NV', () => {
  const nvs = [
    nv(1.0, [{ id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2 }], { descuentoTotal: 0.2 }),
    nv(1.0, [{ id: 'galleta', cantidad: 2, precioVenta: 0.5, subtotal: 1.0 }]),
  ]
  assert.equal(descuentoConsolidado(nvs), 0.2)
})

test('lee también el nombre viejo del descuento (NV anteriores al 18/09/2026)', () => {
  const nvs = [nv(1.0, [{ id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2 }], { descuento_total: 0.2 })]
  assert.equal(descuentoConsolidado(nvs), 0.2)
})

test('sin descuentos (o con basura) devuelve 0: el camino normal no cambia', () => {
  assert.equal(descuentoConsolidado([]), 0)
  assert.equal(descuentoConsolidado(null), 0)
  assert.equal(descuentoConsolidado([nv(1, []), nv(2, [], { descuentoTotal: 'x' })]), 0)
})

test('el total del consolidado es la suma de los totales (ya netos) de cada NV', () => {
  assert.equal(totalConsolidado([nv(1.0, []), nv(1.0, [])]), 2)
  assert.equal(totalConsolidado([nv(2.2, []), nv('3' as unknown as number, [])]), 5.2)
  assert.equal(totalConsolidado(null), 0)
})

test('la boleta consolidada cuadra: líneas de lista − descuento = total', () => {
  // NV1: 2 huevos a 0.60 con promo (2 o más a 0.50) → cobrado 1.00, lista 1.20
  // NV2: 2 galletas a 0.50 → cobrado 1.00
  const nvs = [
    nv(1.0, [{ id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '20' }], { descuentoTotal: 0.2 }),
    nv(1.0, [{ id: 'galleta', cantidad: 2, precioVenta: 0.5, subtotal: 1.0, tipoAfectacion: '20' }]),
  ]
  const items = consolidarItems(nvs)
  const lista = items.reduce((s, it) => s + it.subtotal, 0)
  assert.equal(Math.round(lista * 100) / 100, 2.2, 'las líneas siguen a precio de lista')
  assert.equal(Math.round((lista - descuentoConsolidado(nvs)) * 100) / 100, totalConsolidado(nvs))
  assert.equal(totalConsolidado(nvs), 2)
})

test('junta el mismo producto repetido en varias NV (mismo precio y unidad)', () => {
  const nvs = [
    nv(1.2, [{ id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2, unidad: 'NIU' }]),
    nv(0.6, [{ id: 'huevo', cantidad: 1, precioVenta: 0.6, subtotal: 0.6, unidad: 'NIU' }]),
  ]
  const items = consolidarItems(nvs)
  assert.equal(items.length, 1)
  assert.equal(items[0].cantidad, 3)
  assert.equal(items[0].subtotal, 1.8)
  assert.equal(Math.round(items[0].precioVenta * items[0].cantidad * 100) / 100, 1.8, 'precio × cantidad = subtotal')
})

test('⚠️ el mismo producto a precios distintos NO se junta: el precio unitario dejaría de explicar el subtotal', () => {
  const nvs = [
    nv(1.2, [{ id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2 }]),
    nv(0.5, [{ id: 'huevo', cantidad: 1, precioVenta: 0.5, subtotal: 0.5 }]),
  ]
  const items = consolidarItems(nvs)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((it) => [it.cantidad, it.precioVenta, it.subtotal]), [[2, 0.6, 1.2], [1, 0.5, 0.5]])
})

test('una presentación y la unidad base del mismo producto tampoco se juntan', () => {
  const nvs = [
    nv(3.6, [{ id: 'gaseosa', cantidad: 6, precioVenta: 0.6, subtotal: 3.6, unidad: 'NIU' }]),
    nv(3.0, [{ id: 'gaseosa', cantidad: 1, precioVenta: 3.0, subtotal: 3.0, unidad: 'PAQ' }]),
  ]
  assert.equal(consolidarItems(nvs).length, 2)
})

test('aguanta NV sin items, items nulos y cantidades basura', () => {
  const nvs = [
    { id: 'a', venta: { total: 0 } },
    { id: 'b', venta: { total: 0, items: [null, 'x', { id: 'p', cantidad: 'y', precioVenta: 'z' }] } },
  ]
  const items = consolidarItems(nvs as never)
  assert.equal(items.length, 1, 'solo el item con forma de objeto entra')
  assert.equal(items[0].cantidad, 1, 'sin cantidad usable se asume 1 (no imprime 0)')
  assert.equal(items[0].subtotal, 0)
})

test('no muta las NV originales', () => {
  const item = { id: 'huevo', cantidad: 2, precioVenta: 0.6, subtotal: 1.2 }
  const nvs = [nv(1.2, [item]), nv(1.2, [item])]
  consolidarItems(nvs)
  assert.equal(item.cantidad, 2, 'el item de la NV queda intacto')
  assert.equal(item.subtotal, 1.2)
})
