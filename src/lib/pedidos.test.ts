/**
 * Tests del reparto de pedidos por caja (`lib/pedidos.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 *
 * Casos reales que originan estas reglas (17/09/2026): el pedido `PED-000001` quedó invisible
 * porque el vendedor tenía `caja_principal` y el cajero **ninguna**; y con dos cajas, si una se
 * cae con pedidos abiertos, esos pedidos tienen que poder verse y cobrarse desde la otra.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { avisoOtraCaja, clienteDelPedido, nombreCaja, pedidoParaCarrito, repartirPedidos } from './pedidos.ts'

const p = (id: string, cajaId?: string) => ({ id, cajaId })

describe('repartirPedidos — usuario SIN caja asignada', () => {
  it('ve todos los pedidos (no se esconde ninguno)', () => {
    const r = repartirPedidos([p('a', 'caja_01'), p('b', 'caja_02'), p('c', '')], undefined)
    assert.equal(r.mios.length, 3)
    assert.deepEqual(r.otrasCajas, [])
  })

  it('sin lista no rompe', () => {
    assert.deepEqual(repartirPedidos(null, undefined), { mios: [], otrasCajas: [] })
    assert.deepEqual(repartirPedidos([], 'caja_01'), { mios: [], otrasCajas: [] })
  })
})

describe('repartirPedidos — usuario CON caja', () => {
  it('ve los de su caja y los que no tienen caja', () => {
    const r = repartirPedidos([p('a', 'caja_01'), p('b', ''), p('c', undefined), p('d', 'caja_02')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['a', 'b', 'c'])
    assert.deepEqual(r.otrasCajas.map((x) => x.id), ['d'])
  })

  it('los de otra caja NO desaparecen: se separan para poder rescatarlos', () => {
    const r = repartirPedidos([p('a', 'caja_02'), p('b', 'caja_02')], 'caja_01')
    assert.deepEqual(r.mios, [])
    assert.equal(r.otrasCajas.length, 2)
  })

  it('⚠️ regresión: un pedido de un vendedor SIN caja lo ve el cajero que SÍ tiene caja', () => {
    // Era el segundo agujero: el pedido nacía con cajaId '' y el cajero con caja no lo veía.
    const r = repartirPedidos([p('PED-000001', '')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['PED-000001'])
  })

  it('los espacios no cambian la caja', () => {
    const r = repartirPedidos([p('a', ' caja_01 ')], 'caja_01')
    assert.deepEqual(r.mios.map((x) => x.id), ['a'])
  })
})

describe('nombreCaja / avisoOtraCaja', () => {
  it('el nombre se lee sin guiones bajos', () => {
    assert.equal(nombreCaja('caja_02'), 'caja 02')
    assert.equal(nombreCaja(''), 'sin caja')
  })

  it('el aviso dice de qué caja es y con qué serie se emite', () => {
    const aviso = avisoOtraCaja('caja_02', 'caja_01')
    assert.match(aviso, /caja 02/)
    assert.match(aviso, /caja 01/)
    assert.match(aviso, /serie de tu/)
  })
})

describe('pedidoParaCarrito — el carrito cobra lo COTIZADO, no lo recalculado', () => {
  const doc = {
    id: '2026-9_PED-000001',
    serieNumero: 'PED-000001',
    vendedorNombre: 'JOHAN REYNA',
    cajaId: 'caja_principal',
    venta: {
      // ⚠️ El total cotizado NO coincide con la suma de las líneas (el vendedor aplicó una promo):
      // el carrito tiene que cobrar 58, no 62.
      total: 58,
      cliente_dni: '12345678',
      cliente_nombre: 'Juan Pérez',
      items: [
        { nombre: 'Pañales', quantity: 2, precioVenta: 25 },
        { nombre: 'Toallitas', quantity: 1, precioVenta: 12 },
      ],
    },
  }

  it('usa el total guardado y no la suma de las líneas', () => {
    const p = pedidoParaCarrito(doc)
    assert.equal(p.total, 58)
    assert.equal(p.items.reduce((s, it) => s + it.precio * it.cantidad, 0), 62)
  })

  it('trae código, vendedor, caja, cliente e items', () => {
    const p = pedidoParaCarrito(doc)
    assert.equal(p.codigo, 'PED-000001')
    assert.equal(p.vendedor, 'JOHAN REYNA')
    assert.equal(p.cajaId, 'caja_principal')
    assert.equal(p.items.length, 2)
    assert.deepEqual(p.items[0], { nombre: 'Pañales', cantidad: 2, precio: 25 })
  })

  it('aguanta documentos incompletos o raros sin romper', () => {
    assert.deepEqual(pedidoParaCarrito(null).items, [])
    assert.equal(pedidoParaCarrito({}).total, 0)
    const raro = pedidoParaCarrito({ venta: { total: '58', items: [null, { nombre: 5, quantity: 'x' }] } })
    assert.equal(raro.total, 0, 'un total que no es número no se inventa')
    assert.deepEqual(raro.items, [
      { nombre: 'Producto', cantidad: 0, precio: 0 },
      { nombre: 'Producto', cantidad: 0, precio: 0 },
    ])
  })

  it('sin serieNumero el código cae al id del documento', () => {
    assert.equal(pedidoParaCarrito({ id: '2026-9_PED-000009' }).codigo, '2026-9_PED-000009')
  })

  // 🔑 El cajero tiene que VER que el pedido trae descuento: el `total` ya viene neto y las
  // líneas muestran el precio de lista, así que sin este dato el carrito no podía explicar la
  // diferencia (bug real: 2 huevos a 0.60 con promo a 0.50 → total 2.00 con líneas por 2.20).
  it('trae el descuento del pedido (camelCase y el nombre viejo snake_case)', () => {
    assert.equal(pedidoParaCarrito({ venta: { total: 2, descuentoTotal: 0.2 } }).descuento, 0.2)
    assert.equal(pedidoParaCarrito({ venta: { total: 2, descuento_total: 0.2 } }).descuento, 0.2)
  })

  it('sin descuento devuelve 0, y un descuento basura no se inventa', () => {
    assert.equal(pedidoParaCarrito({ venta: { total: 2 } }).descuento, 0)
    assert.equal(pedidoParaCarrito({ venta: { descuentoTotal: 'x' } }).descuento, 0)
    assert.equal(pedidoParaCarrito(null).descuento, 0)
  })
})

describe('clienteDelPedido', () => {
  it('arma nombre + documento con su rótulo', () => {
    const p = pedidoParaCarrito({ venta: { cliente_nombre: 'Juan Pérez', cliente_dni: '12345678' } })
    assert.equal(clienteDelPedido(p), 'Juan Pérez · DNI 12345678')
  })

  it('con 11 dígitos el rótulo es RUC', () => {
    const p = pedidoParaCarrito({ venta: { cliente_dni: '20123456789' } })
    assert.equal(clienteDelPedido(p), 'RUC 20123456789')
  })

  it('sin cliente devuelve cadena vacía (no imprime un renglón vacío)', () => {
    assert.equal(clienteDelPedido(pedidoParaCarrito({})), '')
  })
})
