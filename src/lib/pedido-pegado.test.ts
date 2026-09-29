/**
 * **El lector del pedido pegado** (`lib/pedido-pegado.ts`).
 *
 * ⚠️ **Los mensajes de estos tests NO se escriben a mano**: se generan con `armarPedido()` +
 * `textoPedido()`, que son las funciones que producen el mensaje real del link. Escribir el formato a
 * mano dejaría el test verde justo cuando el formato cambia —el lector y el generador tienen que
 * moverse juntos—.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { itemsDelPegado, leerPedidoPegado, montoPegado, type ProductoParaPegado } from './pedido-pegado.ts'
import { armarPedido, catalogoPublico, textoPedido } from './pedido-publico.ts'

const PRODUCTOS: ProductoParaPegado[] = [
  {
    id: 'p1',
    nombre: 'GALLETA SODA',
    precioVenta: 1.5,
    stock: 10,
    categoria: 'DULCES',
    unidadBase: 'Unidad',
    tipoAfectacion: '20',
  },
  {
    id: 'p2',
    nombre: 'Coca Cola 1LT',
    precioVenta: 5,
    stock: 3,
    categoria: 'BEBIDAS',
    aliasVoz: 'gaseosa',
    tipoAfectacion: '20',
  },
]

const CATALOGO = catalogoPublico(PRODUCTOS, {
  publicado: '2026-09-26T12:00:00.000Z',
  negocio: 'JORFEL',
  whatsapp: '51951178055',
})

/** El mensaje tal como lo manda el link (con el código y los datos del cliente que se le pasen). */
function mensajeDe(
  lineas: { id: string; cantidad: number }[],
  datos: { nombre?: string; telefono?: string; entrega?: 'recojo' | 'delivery'; direccion?: string; nota?: string; codigo?: string } = {},
) {
  const r = armarPedido(CATALOGO, lineas, {
    nombre: datos.nombre ?? 'Rosa Quispe',
    telefono: datos.telefono ?? '999888777',
    entrega: datos.entrega ?? 'recojo',
    ...(datos.direccion ? { direccion: datos.direccion } : {}),
    ...(datos.nota ? { nota: datos.nota } : {}),
    codigo: datos.codigo ?? 'P-8F3K2',
  })
  assert.equal(r.ok, true, 'el mensaje de prueba tiene que armarse bien')
  if (!('pedido' in r)) throw new Error('el mensaje de prueba tiene que armarse bien')
  return textoPedido(r.pedido, CATALOGO)
}

describe('leerPedidoPegado — el mensaje real del link', () => {
  it('lee el mensaje que genera el link, línea por línea, con los precios del catálogo', () => {
    const texto = mensajeDe([
      { id: 'p1', cantidad: 2 },
      { id: 'p2', cantidad: 1 },
    ])
    const r = leerPedidoPegado(texto, PRODUCTOS)

    assert.equal(r.ok, true)
    assert.equal(r.codigo, 'P-8F3K2')
    assert.equal(r.cliente.nombre, 'Rosa Quispe')
    assert.equal(r.cliente.telefono, '999888777')
    assert.equal(r.cliente.entrega, 'recojo')
    assert.equal(r.lineas.length, 2)
    assert.deepEqual(
      r.lineas.map((l) => [l.producto?.id, l.cantidad, l.estado]),
      [
        ['p1', 2, 'ok'],
        ['p2', 1, 'ok'],
      ],
    )
    // 2 × 1.50 + 1 × 5.00: el total sale del catálogo y coincide con el del mensaje.
    assert.equal(r.total, 8)
    assert.equal(r.totalMensaje, 8)
    assert.equal(r.diferencia, 0)
    assert.deepEqual(r.avisos, [])
    assert.equal(r.citado, '26/09/2026')
  })

  it('lo lee igual si el cajero lo pega sin las negritas de WhatsApp', () => {
    const conMarcas = mensajeDe([{ id: 'p1', cantidad: 2 }])
    const sinMarcas = conMarcas.replace(/\*/g, '')
    const r = leerPedidoPegado(sinMarcas, PRODUCTOS)

    assert.equal(r.ok, true)
    assert.equal(r.codigo, 'P-8F3K2')
    assert.equal(r.lineas[0]?.producto?.id, 'p1')
  })

  it('entiende el envío a domicilio y se queda con la dirección', () => {
    const texto = mensajeDe([{ id: 'p1', cantidad: 1 }], {
      entrega: 'delivery',
      direccion: 'Av. Siempre Viva 123',
    })
    const r = leerPedidoPegado(texto, PRODUCTOS)

    assert.equal(r.cliente.entrega, 'delivery')
    assert.equal(r.cliente.direccion, 'Av. Siempre Viva 123')
  })

  it('levanta la nota y lo que el mensaje avisaba por stock', () => {
    const texto = mensajeDe(
      [
        { id: 'p1', cantidad: 2 },
        { id: 'p2', cantidad: 4 },
      ],
      { nota: 'sin bolsa' },
    )
    const r = leerPedidoPegado(texto, PRODUCTOS)

    assert.equal(r.cliente.nota, 'sin bolsa')
    assert.deepEqual(r.aConfirmarMensaje, ['Coca Cola 1LT'])
    assert.equal(r.lineas[0]?.stockInsuficiente, undefined, '2 de stock 10: alcanza, no se avisa')
    assert.equal(r.lineas[1]?.stockInsuficiente, true, '4 de stock 3: hay que confirmarlo')
  })
})

describe('leerPedidoPegado — lo que NO se puede cargar sin mirar', () => {
  it('marca el producto que ya no está en el catálogo y no deja cargar el pedido tal cual', () => {
    const texto = mensajeDe([
      { id: 'p1', cantidad: 2 },
      { id: 'p2', cantidad: 1 },
    ])
    // El negocio dio de baja la Coca Cola: el mensaje la nombra, el catálogo ya no la tiene.
    const r = leerPedidoPegado(texto, PRODUCTOS.filter((p) => p.id !== 'p2'))

    assert.equal(r.ok, false)
    assert.equal(r.lineas[1]?.estado, 'sin-producto')
    assert.match(r.avisos.join(' '), /Coca Cola 1LT/)
    // El total solo cuenta lo que se pudo resolver: 2 × 1.50.
    assert.equal(r.total, 3)
  })

  it('no carga un producto inactivo (el link solo publica lo que se puede vender)', () => {
    const texto = mensajeDe([{ id: 'p2', cantidad: 1 }])
    const r = leerPedidoPegado(texto, PRODUCTOS.map((p) => (p.id === 'p2' ? { ...p, activo: false } : p)))

    assert.equal(r.ok, false)
    assert.equal(r.lineas[0]?.estado, 'sin-producto')
  })

  it('desempata por el importe del mensaje cuando el nombre coincide con varios', () => {
    const productos: ProductoParaPegado[] = [
      { id: 'a', nombre: 'GALLETA SODA', precioVenta: 1.5, stock: 5 },
      { id: 'b', nombre: 'GALLETA SODA INTEGRAL', precioVenta: 2, stock: 5 },
    ]
    // «GALLETA» no es el nombre exacto de ninguno: los dos empatan por palabras.
    const texto = `*PEDIDO P-AAAA1*\nCliente: Rosa Quispe · 999888777\nEntrega: recojo en tienda\n2 × GALLETA = S/ 3.00\n*TOTAL: S/ 3.00*`
    const r = leerPedidoPegado(texto, productos)

    assert.equal(r.ok, true)
    assert.equal(r.lineas[0]?.producto?.id, 'a', 'el que cuadra con el importe del mensaje')
  })

  it('si el empate sigue, queda ambiguo y muestra los candidatos (no elige por el cajero)', () => {
    const productos: ProductoParaPegado[] = [
      { id: 'a', nombre: 'GALLETA SODA', precioVenta: 1.5, stock: 5 },
      { id: 'b', nombre: 'GALLETA SODA INTEGRAL', precioVenta: 2, stock: 5 },
    ]
    const texto = `*PEDIDO P-AAAA2*\nCliente: Rosa Quispe · 999888777\nEntrega: recojo en tienda\n2 × GALLETA = S/ 9.99\n*TOTAL: S/ 9.99*`
    const r = leerPedidoPegado(texto, productos)

    assert.equal(r.ok, false)
    assert.equal(r.lineas[0]?.estado, 'ambiguo')
    assert.deepEqual(r.lineas[0]?.candidatos, ['GALLETA SODA', 'GALLETA SODA INTEGRAL'])
    assert.match(r.avisos.join(' '), /coincide con más de un producto/)
  })

  it('reconoce el texto que no es un pedido del link', () => {
    const r = leerPedidoPegado('hola, ¿tenés gaseosa?', PRODUCTOS)

    assert.equal(r.ok, false)
    assert.equal(r.desconocido, true)
    assert.equal(r.lineas.length, 0)
    assert.match(r.avisos.join(' '), /No parece un pedido del link/)
  })
})

describe('leerPedidoPegado — los precios son del catálogo, no del mensaje', () => {
  it('si el precio cambió, arma el pedido con el de HOY y muestra la diferencia', () => {
    const texto = mensajeDe([{ id: 'p1', cantidad: 2 }], { codigo: 'P-SUBIO' })
    // El negocio subió la galleta de 1.50 a 2.00 después de publicar el catálogo.
    const subidos = PRODUCTOS.map((p) => (p.id === 'p1' ? { ...p, precioVenta: 2 } : p))
    const r = leerPedidoPegado(texto, subidos)

    assert.equal(r.ok, true)
    assert.equal(r.lineas[0]?.precio, 2, 'el precio que se cobra es el de hoy')
    assert.equal(r.totalMensaje, 3)
    assert.equal(r.total, 4)
    assert.equal(r.diferencia, 1)
    assert.equal(r.lineas[0]?.importeDistinto, true)
    assert.match(r.avisos.join(' '), /Los precios subieron/)
  })

  it('avisa cuando el mensaje se contradice (sus líneas no suman su TOTAL)', () => {
    const texto = `*PEDIDO P-AAAA3*\nCliente: Rosa Quispe · 999888777\n1 × GALLETA SODA = S/ 1.50\n*TOTAL: S/ 9.00*`
    const r = leerPedidoPegado(texto, PRODUCTOS)

    assert.equal(r.ok, true, 'el pedido se puede cargar: el aviso es para que el cajero mire')
    assert.match(r.avisos.join(' '), /El mensaje se contradice/)
  })

  it('avisa si hoy no alcanza el stock, sin bloquear (el pedido no reserva)', () => {
    const texto = mensajeDe([{ id: 'p2', cantidad: 3 }])
    const conPoco = PRODUCTOS.map((p) => (p.id === 'p2' ? { ...p, stock: 1 } : p))
    const r = leerPedidoPegado(texto, conPoco)

    assert.equal(r.ok, true)
    assert.equal(r.lineas[0]?.stockInsuficiente, true)
    assert.match(r.avisos.join(' '), /no alcanza el stock/)
  })
})

describe('montoPegado', () => {
  it('lee los montos como los escribe la app y como los puede editar una persona', () => {
    assert.equal(montoPegado('3.00'), 3)
    assert.equal(montoPegado('3,50'), 3.5)
    assert.equal(montoPegado('1,234.50'), 1234.5)
    assert.equal(montoPegado('S/ 12.90'), 12.9)
    assert.equal(montoPegado(''), 0)
  })
})

describe('itemsDelPegado — el formato del documento', () => {
  const pegado = () => leerPedidoPegado(mensajeDe([{ id: 'p1', cantidad: 2 }]), PRODUCTOS)

  it('arma los ítems como los arma el PDV (unidad base, afectación del producto, sin promo)', () => {
    const { items, total } = itemsDelPegado(pegado(), { afectacionPorDefecto: '10' })
    const it = items[0]

    assert.equal(items.length, 1)
    assert.equal(it?.id, 'p1')
    assert.equal(it?.cantidad, 2)
    assert.equal(it?.cantidadEnUnidadBase, 2)
    assert.equal(it?.quantity, 2)
    assert.equal(it?.precioVenta, 1.5)
    assert.equal(it?.subtotal, 3)
    assert.equal(it?.factorConversion, 1)
    assert.equal(it?.unidad, 'Unidad')
    assert.equal(it?.categoria, 'DULCES')
    // ⚠️ La afectación es la del producto ('20'), no la del negocio: si no, el comprobante
    // declararía un IGV que nadie cobró (el bug del 18/09/2026).
    assert.equal(it?.tipoAfectacion, '20')
    assert.equal(it?.usarPrecioEspecial, false)
    assert.equal(total, 3)
  })

  it('deja afuera la línea que el cajero decidió no cargar', () => {
    const dos = leerPedidoPegado(
      mensajeDe([
        { id: 'p1', cantidad: 2 },
        { id: 'p2', cantidad: 1 },
      ]),
      PRODUCTOS,
    )
    const { items, total } = itemsDelPegado(dos, { afectacionPorDefecto: '20', excluidas: [1] })

    assert.deepEqual(items.map((i) => i.id), ['p1'])
    assert.equal(total, 3)
  })

  it('el envío va como ítem manual, con la afectación del negocio, y suma al total', () => {
    const texto = mensajeDe([{ id: 'p1', cantidad: 2 }], { entrega: 'delivery', direccion: 'Av. Siempre Viva 123' })
    const conEnvio = leerPedidoPegado(texto, PRODUCTOS)
    const { items, total } = itemsDelPegado(conEnvio, {
      afectacionPorDefecto: '20',
      envio: { costo: 5 },
    })

    assert.equal(items.length, 2)
    assert.equal(items[1]?.manual, true)
    assert.equal(items[1]?.nombre, 'Envío a domicilio')
    assert.equal(items[1]?.categoria, 'VARIOS')
    assert.equal(items[1]?.tipoAfectacion, '20')
    assert.equal(total, 8)
  })

  it('sin costo de envío no agrega ninguna línea (el link no cotiza el flete)', () => {
    const { items } = itemsDelPegado(pegado(), { afectacionPorDefecto: '20', envio: { costo: 0 } })
    assert.equal(items.length, 1)
  })

  it('un kit viaja con sus componentes (el stock se descuenta por componente al cobrar)', () => {
    const productos: ProductoParaPegado[] = [
      {
        id: 'kit1',
        nombre: 'COMBO DESAYUNO',
        precioVenta: 7,
        stock: 4,
        isKit: true,
        kitItems: [
          { productoId: 'p1', cantidad: 2 },
          { productoId: 'p2', cantidad: 1 },
        ],
      },
    ]
    const catalogo = catalogoPublico(productos, { publicado: '2026-09-26T12:00:00.000Z' })
    const r = armarPedido(catalogo, [{ id: 'kit1', cantidad: 1 }], {
      nombre: 'Rosa Quispe',
      telefono: '999888777',
      entrega: 'recojo',
      codigo: 'P-KIT01',
    })
    assert.equal(r.ok, true)
    if (!('pedido' in r)) return
    const leido = leerPedidoPegado(textoPedido(r.pedido, catalogo), productos)
    const { items } = itemsDelPegado(leido, { afectacionPorDefecto: '20' })

    assert.deepEqual(items[0]?.kitItems, [
      { productoId: 'p1', cantidad: 2 },
      { productoId: 'p2', cantidad: 1 },
    ])
  })
})
