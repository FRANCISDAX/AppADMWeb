import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { construirPayloadComprobante, construirPayloadNota } from './sunat.ts'

// 📌 Caso real (18/09/2026): al enviar a SUNAT salía
// *"decimal input should have no more that 2 decimal places"*. Ese mensaje es del **backend**
// (`appadm-sunat`, Pydantic: `precio_unitario = Field(decimal_places=2)`), así que el payload tiene
// que salir con **2 decimales** en `cantidad` y `precio_unitario` — sin dejar de declarar lo cobrado.

/** `true` si el número se puede escribir con 2 decimales (lo que exige la API). */
const esDosDecimales = (n: number) => Number(n.toFixed(2)) === n

const CONFIG = {
  ruc: '20123456789',
  nombre: 'NEGOCIO DE PRUEBA',
  serieBoleta: 'B001',
  regionExonerada: true,
}

/** 2 huevos con promo «2 o más a S/ 0.50» (lista 0.60) + 2 galletas a 0.50: cobrado 2.00. */
const ITEMS_PROMO = [
  { id: 'huevo', nombre: 'HUEVOS', cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '20', unidad: 'NIU' },
  { id: 'galleta', nombre: 'GALLETAS', cantidad: 2, precioVenta: 0.5, subtotal: 1.0, tipoAfectacion: '20', unidad: 'NIU' },
]

const docBase = (items: Record<string, unknown>[], descuentoTotal: number, total: number) => ({
  id: '2026-9_B001-000001',
  tipoDoc: 'BOLETA',
  serie: 'B001',
  numero: 1,
  venta: {
    id: 'v1',
    fecha: '2026-09-18T10:00:00.000Z',
    items,
    total,
    descuentoTotal,
    cliente_dni: '12345678',
    cliente_nombre: 'CONSUMIDOR FINAL',
  },
})

test('comprobante con promoción: precio unitario y cantidad con 2 decimales', () => {
  const payload = construirPayloadComprobante(docBase(ITEMS_PROMO, 0.2, 2), CONFIG)
  for (const it of payload.items) {
    assert.ok(esDosDecimales(it.precio_unitario), `precio_unitario ${it.precio_unitario} debe tener 2 decimales`)
    assert.ok(esDosDecimales(it.cantidad), `cantidad ${it.cantidad} debe tener 2 decimales`)
  }
})

test('comprobante con promoción: las líneas siguen sumando el total cobrado', () => {
  const payload = construirPayloadComprobante(docBase(ITEMS_PROMO, 0.2, 2), CONFIG)
  const suma = payload.items.reduce((s, it) => s + it.precio_unitario * it.cantidad, 0)
  assert.equal(Number(suma.toFixed(2)), payload.totales.total)
  assert.equal(payload.totales.total, 2)
  assert.equal(payload.totales.op_exoneradas, 2)
  assert.equal(payload.totales.igv, 0)
})

test('sin descuento los precios de lista no se tocan', () => {
  const payload = construirPayloadComprobante(
    docBase([{ id: 'p', nombre: 'PAN', cantidad: 3, precioVenta: 0.5, subtotal: 1.5, tipoAfectacion: '20' }], 0, 1.5),
    CONFIG,
  )
  assert.equal(payload.items[0].precio_unitario, 0.5)
  assert.equal(payload.items[0].cantidad, 3)
  assert.equal(payload.totales.total, 1.5)
})

test('línea GRAVADA: el valor sin IGV también sale con 2 decimales y cuadra con el IGV', () => {
  // 11.80 con IGV al 18% = base 10.00 exacta
  const payload = construirPayloadComprobante(
    docBase([{ id: 'g', nombre: 'GRAVADO', cantidad: 1, precioVenta: 11.8, subtotal: 11.8, tipoAfectacion: '10' }], 0, 11.8),
    { ...CONFIG, regionExonerada: false },
  )
  assert.equal(payload.items[0].precio_unitario, 10)
  assert.equal(payload.totales.op_gravadas, 10)
  assert.equal(payload.totales.igv, 1.8)
  assert.equal(payload.totales.total, 11.8)
})

test('línea gravada con precio no exacto: la base se redondea a 2 decimales y el total sigue siendo el cobrado', () => {
  const payload = construirPayloadComprobante(
    docBase([{ id: 'g', nombre: 'GRAVADO', cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '10' }], 0, 1.2),
    { ...CONFIG, regionExonerada: false },
  )
  const it = payload.items[0]
  assert.ok(esDosDecimales(it.precio_unitario), `precio_unitario ${it.precio_unitario}`)
  assert.equal(Number((it.precio_unitario * it.cantidad).toFixed(2)), payload.totales.op_gravadas)
  assert.equal(payload.totales.total, 1.2)
})

test('una cantidad con 3 decimales (venta por peso) se declara con 2', () => {
  const payload = construirPayloadComprobante(
    docBase([{ id: 'k', nombre: 'QUESO', cantidad: 1.255, precioVenta: 20, subtotal: 25.1, tipoAfectacion: '20', unidad: 'KGM' }], 0, 25.1),
    CONFIG,
  )
  const it = payload.items[0]
  assert.ok(esDosDecimales(it.cantidad), `cantidad ${it.cantidad}`)
  assert.equal(it.unidad, 'KGM')
  assert.ok(esDosDecimales(it.precio_unitario))
})

test('la nota de crédito/débito también sale con 2 decimales y declara lo cobrado', () => {
  const doc = docBase(ITEMS_PROMO, 0.2, 2)
  const payload = construirPayloadNota({ ...doc, tipoDoc: 'NC', venta: { ...doc.venta, codigoMotivo: '07' } }, CONFIG)
  for (const it of payload.items) {
    assert.ok(esDosDecimales(it.precio_unitario), `precio_unitario ${it.precio_unitario}`)
    assert.ok(esDosDecimales(it.cantidad), `cantidad ${it.cantidad}`)
  }
  assert.equal(payload.totales.total, 2)
  assert.equal(payload.items.reduce((s, it) => s + it.precio_unitario * it.cantidad, 0).toFixed(2), '2.00')
})

test('los totales del comprobante siempre salen con 2 decimales', () => {
  const payload = construirPayloadComprobante(docBase(ITEMS_PROMO, 0.2, 2), CONFIG)
  for (const [k, v] of Object.entries(payload.totales)) {
    assert.ok(esDosDecimales(v as number), `${k} = ${v} debe tener 2 decimales`)
  }
})

test('la suma de floats (0.1 + 0.2) no se manda como 0.30000000000000004', () => {
  // Si el payload lleva ese valor, la API lo rechaza por tener más de 2 decimales.
  const payload = construirPayloadComprobante(
    docBase(
      [
        { id: 'a', nombre: 'A', cantidad: 1, precioVenta: 0.1, subtotal: 0.1, tipoAfectacion: '20' },
        { id: 'b', nombre: 'B', cantidad: 1, precioVenta: 0.2, subtotal: 0.2, tipoAfectacion: '20' },
      ],
      0,
      0.3,
    ),
    CONFIG,
  )
  assert.equal(payload.totales.op_exoneradas, 0.3)
  assert.equal(payload.totales.total, 0.3)
  assert.equal(String(payload.totales.total), '0.3')
})
