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

import { avisoOtraCaja, clienteDelPedido, codigoDePedido, comprobanteDePedido, esPedido, estadoPedido, huellaPedido, nombreCaja, pedidoDuplicado, pedidoParaCarrito, pedidoPendienteCoincidente, pedidosVisiblesPara, repartirPedidos, resumenPedidos, textoItemsPedido, VENTANA_DUPLICADO_MINUTOS } from './pedidos.ts'

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

// ─── Pedidos duplicados (caso real del 18/09/2026) ───────────────────────────────────────────
// El vendedor enviaba la misma venta dos veces y el cajero quedaba con un pedido colgado.

const items = [
  { id: 'huevo', cantidad: 2, precioVenta: 0.6 },
  { id: 'galleta', cantidad: 2, precioVenta: 0.5 },
]

const pedido = (extra: Record<string, unknown> = {}) => ({
  id: '2026-9_PED-000123',
  serieNumero: 'PED-000123',
  vendedorId: 'vendedor-1',
  estado: 'pendiente',
  fecha: '2026-09-18T15:00:00.000Z',
  huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }),
  venta: { items, total: 2 },
  ...extra,
})

describe('huellaPedido', () => {
  it('es igual para la misma venta, sin importar el orden de las líneas', () => {
    const directa = huellaPedido({ vendedorId: 'v1', items, total: 2 })
    const invertida = huellaPedido({ vendedorId: 'v1', items: [...items].reverse(), total: 2 })
    assert.equal(directa, invertida)
  })

  it('cambia si cambia el vendedor, el total, una cantidad o un precio', () => {
    const base = huellaPedido({ vendedorId: 'v1', items, total: 2 })
    assert.notEqual(base, huellaPedido({ vendedorId: 'v2', items, total: 2 }))
    assert.notEqual(base, huellaPedido({ vendedorId: 'v1', items, total: 3 }))
    assert.notEqual(base, huellaPedido({ vendedorId: 'v1', items: [{ ...items[0], cantidad: 3 }, items[1]], total: 2 }))
    assert.notEqual(base, huellaPedido({ vendedorId: 'v1', items: [{ ...items[0], precioVenta: 0.7 }, items[1]], total: 2 }))
  })

  it('no se rompe con items vacíos o con basura', () => {
    assert.equal(huellaPedido({ vendedorId: 'v1', items: [], total: 0 }), 'v1|0')
    assert.equal(huellaPedido({}), '|', 'sin datos no inventa un total: queda vacío')
    assert.equal(huellaPedido({ items: [null, {}, 'x'] as never, total: 0 }), '|0')
  })
})

describe('pedidoDuplicado', () => {
  const ahora = new Date('2026-09-18T15:05:00.000Z')   // 5 minutos después del pedido

  it('detecta el reenvío de la misma venta dentro de la ventana', () => {
    const encontrado = pedidoDuplicado([pedido()], {
      vendedorId: 'vendedor-1',
      huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }),
      ahora,
    })
    assert.equal(encontrado?.serieNumero, 'PED-000123')
  })

  it('no lo detecta si pasó la ventana: el mismo cliente puede volver a comprar lo mismo', () => {
    const tarde = new Date(Date.parse('2026-09-18T15:00:00.000Z') + (VENTANA_DUPLICADO_MINUTOS + 1) * 60000)
    assert.equal(
      pedidoDuplicado([pedido()], { vendedorId: 'vendedor-1', huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }), ahora: tarde }),
      null,
    )
  })

  it('no lo detecta si el pedido es de otro vendedor', () => {
    assert.equal(
      pedidoDuplicado([pedido()], { vendedorId: 'vendedor-2', huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }), ahora }),
      null,
    )
  })

  it('no lo detecta si el pedido ya no está pendiente (cobrado o eliminado)', () => {
    for (const estado of ['pagado', 'cancelado', 'anulada']) {
      assert.equal(
        pedidoDuplicado([pedido({ estado })], { vendedorId: 'vendedor-1', huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }), ahora }),
        null,
      )
    }
  })

  it('detecta también los pedidos viejos, que no tienen huella guardada', () => {
    const viejo = pedido({ huella: undefined })
    assert.equal(
      pedidoDuplicado([viejo], { vendedorId: 'vendedor-1', huella: huellaPedido({ vendedorId: 'vendedor-1', items, total: 2 }), ahora })?.serieNumero,
      'PED-000123',
    )
  })

  it('con una venta distinta no avisa nada', () => {
    assert.equal(
      pedidoDuplicado([pedido()], { vendedorId: 'vendedor-1', huella: huellaPedido({ vendedorId: 'vendedor-1', items: [{ id: 'pan', cantidad: 1, precioVenta: 3 }], total: 3 }), ahora }),
      null,
    )
  })
})

// ─── Listado de pedidos: estado y visibilidad ────────────────────────────────────────────────

describe('esPedido y estadoPedido', () => {
  it('reconoce un pedido pendiente', () => {
    const pendiente = { tipoDoc: 'PENDIENTE', estado: 'pendiente', serieNumero: 'PED-000123' }
    assert.equal(esPedido(pendiente), true)
    assert.equal(estadoPedido(pendiente), 'pendiente')
    assert.equal(codigoDePedido(pendiente), 'PED-000123')
    assert.equal(comprobanteDePedido(pendiente), '', 'todavía no hay comprobante')
  })

  it('reconoce un pedido cobrado porque conserva el código del pedido', () => {
    // Así lo escribe `cobrarVentaPendiente`: el comprobante reemplaza al tipo y al serieNumero,
    // pero el código PED queda en el campo `pedido`.
    const cobrado = { tipoDoc: 'BOLETA', estado: 'pagado', serieNumero: 'B001-000061', pedido: 'PED-000123' }
    assert.equal(esPedido(cobrado), true)
    assert.equal(estadoPedido(cobrado), 'cobrado')
    assert.equal(codigoDePedido(cobrado), 'PED-000123')
    assert.equal(comprobanteDePedido(cobrado), 'B001-000061')
  })

  it('reconoce un pedido eliminado y guarda su motivo', () => {
    const cancelado = { tipoDoc: 'PENDIENTE', estado: 'cancelado', serieNumero: 'PED-000124', motivoCancelacion: 'El cliente se arrepintió' }
    assert.equal(esPedido(cancelado), true)
    assert.equal(estadoPedido(cancelado), 'eliminado')
    assert.equal(codigoDePedido(cancelado), 'PED-000124')
    assert.equal(comprobanteDePedido(cancelado), '', 'un pedido eliminado no tiene comprobante')
  })

  it('una venta directa del cajero NO es un pedido', () => {
    const venta = { tipoDoc: 'BOLETA', estado: 'pagado', serieNumero: 'B001-000062' }
    assert.equal(esPedido(venta), false)
  })

  it('una venta directa anulada tampoco se cuela como pedido eliminado', () => {
    assert.equal(esPedido({ tipoDoc: 'BOLETA', estado: 'anulada', serieNumero: 'B001-000063' }), false)
  })

  it('un estado desconocido se muestra como pendiente (ante la duda, mostrar)', () => {
    assert.equal(estadoPedido({ tipoDoc: 'PENDIENTE' }), 'pendiente')
    assert.equal(estadoPedido(null), 'pendiente')
  })
})

describe('pedidosVisiblesPara', () => {
  const lista = [
    { id: 'a', vendedorId: 'v1', cajeroId: 'c1' },
    { id: 'b', vendedorId: 'v2', cajeroId: 'c1' },
    { id: 'c', vendedorId: 'v2', cajeroId: 'c2' },
  ]

  it('un supervisor (verTodo) ve todos', () => {
    assert.equal(pedidosVisiblesPara(lista, { uid: 'admin', verTodo: true }).length, 3)
  })

  it('el vendedor ve solo los que él armó', () => {
    assert.deepEqual(pedidosVisiblesPara(lista, { uid: 'v1' }).map((p) => p.id), ['a'])
    assert.deepEqual(pedidosVisiblesPara(lista, { uid: 'v2' }).map((p) => p.id), ['b', 'c'])
  })

  it('el cajero ve los que él cobró, además de los que haya armado', () => {
    assert.deepEqual(pedidosVisiblesPara(lista, { uid: 'c1' }).map((p) => p.id), ['a', 'b'])
  })

  it('sin identificador no ve nada, y una lista vacía o nula no rompe', () => {
    assert.deepEqual(pedidosVisiblesPara(lista, {}), [])
    assert.deepEqual(pedidosVisiblesPara(null, { uid: 'v1' }), [])
    assert.deepEqual(pedidosVisiblesPara(lista, { uid: null, verTodo: true }).length, 3)
  })
})

describe('resumenPedidos', () => {
  it('cuenta por estado', () => {
    const resumen = resumenPedidos([
      { tipoDoc: 'PENDIENTE', estado: 'pendiente' },
      { tipoDoc: 'PENDIENTE', estado: 'pendiente' },
      { tipoDoc: 'BOLETA', estado: 'pagado', pedido: 'PED-1' },
      { tipoDoc: 'PENDIENTE', estado: 'cancelado' },
    ])
    assert.deepEqual(resumen, { pendiente: 2, cobrado: 1, eliminado: 1 })
    assert.deepEqual(resumenPedidos(null), { pendiente: 0, cobrado: 0, eliminado: 0 })
  })
})

// ─── Control espejo: la venta directa del cajero contra los pedidos pendientes ────────────────
// Caso real (21/09/2026): PED-000007 quedó pendiente mientras el cajero emitía NV01-000180 con el
// mismo producto y el mismo total, 79 segundos después.

describe('pedidoPendienteCoincidente', () => {
  // El pedido guarda la forma del DOCUMENTO (unidades base); el carrito, la del carrito.
  const pedidoReal = {
    id: '2026-9_PED-000007',
    serieNumero: 'PED-000007',
    estado: 'pendiente',
    vendedorId: 'vendedor-1',
    venta: { total: 0.5, items: [{ id: 'cigarro-hamilton', nombre: 'Cigarro Hamilton Fresh', cantidad: 1, precioVenta: 0.5 }] },
  }

  it('detecta la venta directa del mismo producto por el mismo total', () => {
    const encontrado = pedidoPendienteCoincidente([pedidoReal], {
      total: 0.5,
      items: [{ id: 'cigarro-hamilton', nombre: 'Cigarro Hamilton Fresh', quantity: 1, precioVenta: 0.5 }],
    })
    assert.equal(encontrado?.serieNumero, 'PED-000007')
  })

  it('no depende del vendedor: la venta directa la cobra el cajero, no el vendedor del pedido', () => {
    // La huella de duplicados SÍ incluye al vendedor; esta comparación no, a propósito.
    assert.notEqual(
      huellaPedido({ vendedorId: 'cajero-9', items: pedidoReal.venta.items, total: 0.5 }),
      huellaPedido({ vendedorId: 'vendedor-1', items: pedidoReal.venta.items, total: 0.5 }),
    )
    assert.equal(
      pedidoPendienteCoincidente([pedidoReal], { total: 0.5, items: pedidoReal.venta.items })?.serieNumero,
      'PED-000007',
    )
  })

  it('detecta una venta por presentación: compara productos y total, no cantidades ni precios', () => {
    const porPaquete = {
      ...pedidoReal,
      venta: { total: 6, items: [{ id: 'gaseosa', nombre: 'Gaseosa', cantidad: 6, precioVenta: 1 }] },
    }
    const carrito = { total: 6, items: [{ id: 'gaseosa', nombre: 'Gaseosa', quantity: 1, precioVenta: 6 }] }
    assert.equal(pedidoPendienteCoincidente([porPaquete], carrito)?.serieNumero, 'PED-000007')
  })

  it('no avisa si el total o los productos son distintos', () => {
    assert.equal(pedidoPendienteCoincidente([pedidoReal], { total: 3, items: pedidoReal.venta.items }), null)
    assert.equal(
      pedidoPendienteCoincidente([pedidoReal], { total: 0.5, items: [{ id: 'pan', nombre: 'Pan', quantity: 1, precioVenta: 0.5 }] }),
      null,
    )
  })

  it('solo mira los pedidos pendientes: uno cobrado o eliminado no genera el aviso', () => {
    for (const estado of ['pagado', 'cancelado']) {
      assert.equal(pedidoPendienteCoincidente([{ ...pedidoReal, estado }], { total: 0.5, items: pedidoReal.venta.items }), null)
    }
  })

  it('con la lista vacía o datos incompletos no avisa nada', () => {
    assert.equal(pedidoPendienteCoincidente([], { total: 0.5, items: pedidoReal.venta.items }), null)
    assert.equal(pedidoPendienteCoincidente([pedidoReal], { total: 0, items: [] }), null)
    assert.equal(pedidoPendienteCoincidente([pedidoReal], {}), null)
  })
})

// ─── Productos de un pedido en una línea (lo que ve el vendedor) ───────────────────────────────

describe('textoItemsPedido', () => {
  it('arma cantidad × nombre, con la forma del documento y la del carrito', () => {
    const doc = [
      { nombre: 'Huevos', cantidad: 2 },
      { nombre: 'Galletas', cantidad: 2 },
    ]
    assert.equal(textoItemsPedido(doc), '2 × Huevos, 2 × Galletas')
    assert.equal(textoItemsPedido([{ nombre: 'Pan', quantity: 3 }]), '3 × Pan')
  })

  it('resume las líneas de más para no romper la fila', () => {
    const cinco = Array.from({ length: 5 }, (_, i) => ({ nombre: `Producto ${i + 1}`, cantidad: 1 }))
    assert.equal(textoItemsPedido(cinco), '1 × Producto 1, 1 × Producto 2, 1 × Producto 3, 1 × Producto 4 … +1 más')
    assert.equal(textoItemsPedido(cinco, { max: 10 }), '1 × Producto 1, 1 × Producto 2, 1 × Producto 3, 1 × Producto 4, 1 × Producto 5')
  })

  it('aguanta pedidos sin items o con datos raros, y cae al id si no hay nombre', () => {
    assert.equal(textoItemsPedido([]), '')
    assert.equal(textoItemsPedido(null), '')
    assert.equal(textoItemsPedido([{ id: 'sku-1', cantidad: 2 }]), '2 × sku-1')
    assert.equal(textoItemsPedido([{ cantidad: 2 }]), '', 'sin nombre ni id no inventa un renglón')
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
