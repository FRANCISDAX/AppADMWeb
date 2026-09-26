import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  IGV_RATE,
  afectacionDe,
  afectacionGuardada,
  cantidadSunat,
  descuentoDeVenta,
  esGravado,
  importeBrutoDe,
  itemsConDescuento,
  itemsParaSunat,
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

// ─── Descuento de la venta (el que declara el comprobante) ───────────────────────────────────
// Bug real (18/09/2026): un pedido guardaba el descuento solo como `descuento_total` (snake),
// así que al cobrarlo el comprobante no veía descuento: sumaba las líneas a precio de lista
// (2.20), declaraba un TOTAL de 2.00 y no imprimía ninguna fila de descuento.

test('el descuento se lee en camelCase (venta directa y pedidos nuevos)', () => {
  assert.equal(descuentoDeVenta({ descuentoTotal: 0.2 }), 0.2)
})

test('el descuento se lee también en snake_case (pedidos anteriores al 18/09/2026)', () => {
  assert.equal(descuentoDeVenta({ descuento_total: 0.2 }), 0.2)
})

test('sin descuento (o con basura) devuelve 0: el camino normal no cambia', () => {
  assert.equal(descuentoDeVenta({}), 0)
  assert.equal(descuentoDeVenta(null), 0)
  assert.equal(descuentoDeVenta(undefined), 0)
  assert.equal(descuentoDeVenta({ descuentoTotal: 0 }), 0)
  assert.equal(descuentoDeVenta({ descuentoTotal: -1 }), 0)
  assert.equal(descuentoDeVenta({ descuentoTotal: 'x' }), 0)
})

test('camelCase gana sobre snake_case si los dos vienen (nunca se suman)', () => {
  assert.equal(descuentoDeVenta({ descuentoTotal: 0.2, descuento_total: 0.5 }), 0.2)
})

test('un descuento de promoción explica la diferencia entre las líneas y el total', () => {
  // 2 huevos a 0.60 (promo: 2 o más a 0.50) + 2 galletas a 0.50 = 2.20 de lista, se cobra 2.00.
  const items = [
    { cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '20' },
    { cantidad: 2, precioVenta: 0.5, subtotal: 1.0, tipoAfectacion: '20' },
  ]
  const descuento = descuentoDeVenta({ descuento_total: 0.2 })
  assert.equal(itemsConDescuento(items, 0).reduce((s, it) => s + importeBrutoDe(it), 0), 2.2)
  assert.equal(totalDeclarado(items, descuento), 2)
})

// ─── Items para la API de SUNAT (2 decimales) ────────────────────────────────────────────────
// 📌 Bug del 18/09/2026: la API (`appadm-sunat`, Pydantic `decimal_places=2`) rechazaba el envío
// con *"decimal input should have no more that 2 decimal places"* porque el precio unitario
// efectivo viajaba con hasta 6 decimales (una línea con descuento: 1.09 / 2 = 0.545).

const dosDecimales = (n: number) => Number(n.toFixed(2)) === n

test('itemsParaSunat deja el precio unitario en 2 decimales', () => {
  const items = [
    { cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '20' },
    { cantidad: 2, precioVenta: 0.5, subtotal: 1.0, tipoAfectacion: '20' },
  ]
  // Sin esto, el reparto proporcional daba 0.545 (3 decimales) y la API rechazaba el envío.
  assert.equal(itemsConDescuento(items, 0.2)[0].precioVenta, 0.545)
  const paraSunat = itemsParaSunat(items, 0.2)
  for (const it of paraSunat) {
    assert.ok(dosDecimales(Number(it.precioVenta)), `precio unitario ${it.precioVenta}`)
    assert.ok(dosDecimales(Number(it.cantidad)), `cantidad ${it.cantidad}`)
  }
})

test('itemsParaSunat conserva el total cobrado (aunque el redondeo no dé exacto por línea)', () => {
  const items = [
    { cantidad: 2, precioVenta: 0.6, subtotal: 1.2, tipoAfectacion: '20' },
    { cantidad: 2, precioVenta: 0.5, subtotal: 1.0, tipoAfectacion: '20' },
  ]
  const paraSunat = itemsParaSunat(items, 0.2)
  const suma = paraSunat.reduce((s, it) => s + Number(it.precioVenta) * Number(it.cantidad), 0)
  assert.equal(Number(suma.toFixed(2)), 2, 'las líneas suman exactamente lo cobrado')
  assert.equal(paraSunat.reduce((s, it) => s + Number(it.subtotal), 0).toFixed(2), '2.00')
})

test('itemsParaSunat sin descuento no cambia nada', () => {
  const items = [{ cantidad: 3, precioVenta: 0.5, subtotal: 1.5, tipoAfectacion: '20' }]
  const paraSunat = itemsParaSunat(items, 0)
  assert.equal(paraSunat[0].precioVenta, 0.5)
  assert.equal(paraSunat[0].cantidad, 3)
  assert.equal(paraSunat[0].subtotal, 1.5)
})

test('itemsParaSunat avisa con una cantidad de 3 decimales: se declara con 2', () => {
  // Venta por peso (KGM): la API no acepta 3 decimales en `cantidad`.
  const paraSunat = itemsParaSunat([{ cantidad: 1.255, precioVenta: 20, subtotal: 25.1, tipoAfectacion: '20' }], 0)
  assert.equal(paraSunat[0].cantidad, 1.26)
  assert.equal(cantidadSunat(0), 1, 'una cantidad inválida se declara como 1 (nunca 0)')
  assert.equal(cantidadSunat(-2), 1)
  assert.equal(cantidadSunat(2), 2)
})

// ── afectacionGuardada: leer la afectación de un documento ya emitido ───────────────────────────────
//
// 🔑 Se usa para medir **plata de ventas pasadas** (margen de Análisis y reportes de inventario). Manda
// la afectación del ítem; si no la tiene (un pedido de antes del 18/09/2026), la del producto; y si el
// producto ya no está, **exonerado** — nunca se supone gravado, porque eso le restaría al margen un 18%
// que nadie declaró.

test('afectacionGuardada: manda la del ítem (es lo que salió en el comprobante)', () => {
  assert.equal(afectacionGuardada({ tipoAfectacion: '10' }, { tipoAfectacion: '20' }), '10')
  assert.equal(afectacionGuardada({ tipoAfectacionEfectivo: '30', tipoAfectacion: '10' }), '30')
  assert.equal(afectacionGuardada({ tipoAfectacion: '  ' }, { tipoAfectacion: '10' }), '10', 'un valor en blanco no manda')
})

test('afectacionGuardada: sin dato en el ítem usa la del producto del catálogo', () => {
  assert.equal(afectacionGuardada({ cantidad: 2 }, { tipoAfectacion: '10' }), '10')
  assert.equal(afectacionGuardada(null, { tipoAfectacion: '10' }), '10')
})

test('afectacionGuardada: sin ítem ni producto NO se supone gravado', () => {
  assert.equal(afectacionGuardada({ cantidad: 2 }), '20')
  assert.equal(afectacionGuardada({ cantidad: 2 }, null), '20')
  assert.equal(afectacionGuardada(undefined, {}), '20')
  assert.equal(afectacionGuardada({ tipoAfectacion: '10' }), '10', 'si lo trae, se respeta')
})
