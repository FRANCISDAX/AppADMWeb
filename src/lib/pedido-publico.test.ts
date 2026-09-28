/**
 * Tests del **pedido por link** — `lib/pedido-publico.ts`.
 *
 * 🔑 **Lo que fijan** (es la parte que no se puede equivocar, porque el link lo usa gente de afuera):
 *
 * - **El precio sale del catálogo publicado, nunca del navegador.** El cliente solo puede mandar cantidades;
 *   el total se recalcula acá. Si un precio no está en el catálogo, ese ítem no se pide.
 * - **El catálogo no ofrece lo que no se puede vender**: inactivos, sin nombre y sin precio quedan afuera.
 * - **Un pedido es un mensaje, no una venta**: no toca stock ni comprobantes; el texto lleva la fecha de los
 *   precios para que nadie discuta un precio viejo.
 * - Los datos del cliente se validan con mensajes que se entienden (nombre, teléfono, dirección si es envío).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_UNIDADES_POR_ITEM,
  armarPedido,
  buscarEnCatalogo,
  catalogoPublico,
  codigoPedidoPublico,
  enlaceWhatsApp,
  fechaPublicacion,
  precioDeItem,
  textoPedido,
  totalPedido,
  type CatalogoPublico,
} from './pedido-publico.ts'

const PUBLICADO = '2026-09-26T12:00:00.000Z'

/** Productos como los tiene el negocio (con datos que NO tienen que salir en el catálogo público). */
const PRODUCTOS = [
  { id: 'p1', nombre: 'GALLETA SODA', codigo: '7751', categoria: 'GALLETAS', precioVenta: 1.5, stock: 20, activo: true, costoPromedio: 0.9, proveedorNombre: 'GOLOSINAS IRIS' },
  { id: 'p2', nombre: 'Gaseosa 500ml', codigo: '7752', categoria: 'BEBIDAS', precioVenta: 2.5, stock: 0, activo: true, costoPromedio: 1.7 },
  { id: 'p3', nombre: 'Chocolate', codigo: '7753', categoria: 'GOLOSINAS', precioVenta: 3, stock: 4, activo: true },
  { id: 'p4', nombre: 'Producto desactivado', precioVenta: 9, stock: 5, activo: false },
  { id: 'p5', nombre: 'Sin precio', precioVenta: 0, stock: 5, activo: true },
  { id: 'p6', nombre: '', precioVenta: 4, stock: 5, activo: true },
]

const catalogo: CatalogoPublico = catalogoPublico(PRODUCTOS, {
  publicado: PUBLICADO,
  negocio: 'JorFel',
  whatsapp: '51987654321',
})

const datos = { nombre: 'Rosa Quispe', telefono: '999 888 777', entrega: 'recojo' as const, codigo: 'P-8F3K2' }

describe('el catálogo público', () => {
  it('deja afuera lo que no se puede vender: inactivo, sin nombre y sin precio', () => {
    assert.deepEqual(
      catalogo.items.map((i) => i.id),
      ['p2', 'p1', 'p3'],
      'agotado entra (avisado), desactivado/sin precio/sin nombre no',
    )
  })

  it('🔑 no filtra datos internos: solo nombre, código, categoría, precio, unidad, stock e imagen', () => {
    const campos = Object.keys(catalogo.items.find((i) => i.id === 'p1')!).sort()
    assert.deepEqual(campos, ['categoria', 'codigo', 'id', 'nombre', 'precio', 'stock'])
    assert.doesNotMatch(JSON.stringify(catalogo), /costoPromedio|proveedorNombre|0\.9/, 'ni costos ni proveedores')
  })

  it('🔑 no publica las fotos en base64 (harían pesar MB el JSON) y sí una URL corta', () => {
    const c = catalogoPublico(
      [
        { id: 'a', nombre: 'Con foto base64', precioVenta: 2, stock: 1, activo: true, imagen: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ==' },
        { id: 'b', nombre: 'Con URL', precioVenta: 3, stock: 1, activo: true, imagen: 'https://ejemplo.com/foto.jpg' },
      ],
      { publicado: PUBLICADO },
    )
    assert.equal(c.items.find((i) => i.id === 'a')?.imagen, undefined, 'una foto base64 no viaja al catálogo público')
    assert.equal(c.items.find((i) => i.id === 'b')?.imagen, 'https://ejemplo.com/foto.jpg')
    assert.ok(JSON.stringify(c).length < 1000, 'el catálogo entero tiene que ser liviano')
  })

  it('🔑 el alias hace encontrable el genérico («gaseosa» no está en ningún nombre real)', () => {
    const c = catalogoPublico(
      [
        { id: 'g1', nombre: 'Coca Cola 1LT', precioVenta: 8, stock: 3, activo: true, aliasVoz: 'gaseosa' },
        { id: 'g2', nombre: 'Big Cola 350ML', precioVenta: 3, stock: 3, activo: true },
      ],
      { publicado: PUBLICADO },
    )
    assert.equal(c.items.find((i) => i.id === 'g1')?.alias, 'gaseosa')
    assert.equal(buscarEnCatalogo(c, 'gaseosa').length, 1, 'con alias, el genérico encuentra')
    assert.equal(buscarEnCatalogo(c, 'gaseosas').length, 1, 'y también en plural')
    assert.equal(buscarEnCatalogo(c, 'coca').length, 1, 'sigue encontrando por el nombre')
  })

  it('aplana el stock negativo a 0 y redondea el precio a 2 decimales', () => {
    const c = catalogoPublico(
      [{ id: 'x', nombre: 'X', precioVenta: 1.23456, stock: -7, activo: true }],
      { publicado: PUBLICADO },
    )
    assert.equal(c.items[0].stock, 0)
    assert.equal(c.items[0].precio, 1.23)
  })

  it('el buscador ignora tildes y mayúsculas, entiende el plural y encuentra por código y categoría', () => {
    assert.equal(buscarEnCatalogo(catalogo, 'galleta').length, 1)
    assert.equal(buscarEnCatalogo(catalogo, 'GALLETAS').length, 1, 'el cliente escribe en plural')
    assert.equal(buscarEnCatalogo(catalogo, 'bebidas').length, 1, 'por categoría')
    assert.equal(buscarEnCatalogo(catalogo, '7752')[0].id, 'p2', 'por código')
    assert.equal(buscarEnCatalogo(catalogo, '   ').length, 3, 'vacío = todo')
    assert.equal(buscarEnCatalogo(catalogo, 'galleta soda')[0].id, 'p1', 'dos palabras: las dos tienen que estar')
    assert.equal(buscarEnCatalogo(catalogo, 'galleta gaseosa').length, 0, 'y si una no está, no trae nada')
  })
})

describe('el total y los precios', () => {
  it('el total sale del catálogo, no de lo que mande el navegador', () => {
    const lineas = [{ id: 'p1', cantidad: 2 }, { id: 'p3', cantidad: 1 }]
    assert.equal(totalPedido(catalogo, lineas), 6) // 2×1.50 + 1×3.00
    assert.equal(precioDeItem(catalogo, 'p1'), 1.5)
    assert.equal(precioDeItem(catalogo, 'no-existe'), null)
  })

  it('una cantidad absurda se acota al tope y una inválida se ignora', () => {
    assert.equal(totalPedido(catalogo, [{ id: 'p1', cantidad: 999 }]), MAX_UNIDADES_POR_ITEM * 1.5)
    assert.equal(totalPedido(catalogo, [{ id: 'p1', cantidad: 0 }]), 0)
    assert.equal(totalPedido(catalogo, [{ id: 'p1', cantidad: -3 }]), 0)
    assert.equal(totalPedido(catalogo, [{ id: 'p1', cantidad: 2.7 }]), 3, '2 unidades, no 2.7')
  })

  it('un producto que ya no está en el catálogo no se puede pedir (y no se le inventa precio)', () => {
    const r = armarPedido(catalogo, [{ id: 'viejo', cantidad: 1 }], datos)
    assert.equal(r.ok, false)
  })
})

describe('armar el pedido', () => {
  it('arma el pedido con los precios del catálogo y calcula el total', () => {
    const r = armarPedido(catalogo, [{ id: 'p1', cantidad: 2 }, { id: 'p2', cantidad: 1 }], datos)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.equal(r.pedido.total, 5.5)
    assert.equal(r.pedido.items.length, 2)
    assert.equal(r.pedido.codigo, 'P-8F3K2')
    assert.equal(r.pedido.entrega, 'recojo')
  })

  it('marca lo que hay que confirmar por stock (agotado o más de lo publicado)', () => {
    const r = armarPedido(catalogo, [{ id: 'p2', cantidad: 1 }, { id: 'p3', cantidad: 9 }], datos)
    assert.equal(r.ok, true)
    if (!r.ok) return
    assert.deepEqual(r.pedido.aConfirmar, ['Gaseosa 500ml', 'Chocolate'])
  })

  it('pide nombre, teléfono y dirección cuando es envío', () => {
    assert.match(String((armarPedido(catalogo, [{ id: 'p1', cantidad: 1 }], { ...datos, nombre: 'Al' }) as { error: string }).error), /nombre/i)
    assert.match(String((armarPedido(catalogo, [{ id: 'p1', cantidad: 1 }], { ...datos, telefono: '123' }) as { error: string }).error), /tel[eé]fono/i)
    const sinDir = armarPedido(catalogo, [{ id: 'p1', cantidad: 1 }], { ...datos, entrega: 'delivery' })
    assert.equal(sinDir.ok, false)
    const conDir = armarPedido(catalogo, [{ id: 'p1', cantidad: 1 }], { ...datos, entrega: 'delivery', direccion: 'Av. Abtao 352' })
    assert.equal(conDir.ok, true)
  })

  it('un carrito vacío no se manda', () => {
    const r = armarPedido(catalogo, [], datos)
    assert.equal(r.ok, false)
    if (!r.ok) assert.match(r.error, /vac[íi]o/i)
  })
})

describe('el texto que le llega al negocio', () => {
  it('se lee de un vistazo y lleva la fecha de los precios', () => {
    const r = armarPedido(catalogo, [{ id: 'p1', cantidad: 2 }, { id: 'p3', cantidad: 1 }], { ...datos, nota: 'lo paso a las 6' })
    assert.equal(r.ok, true)
    if (!r.ok) return
    const texto = textoPedido(r.pedido, catalogo)
    assert.match(texto, /\*PEDIDO P-8F3K2\* · JorFel/)
    assert.match(texto, /Cliente: Rosa Quispe · 999888777/)
    assert.match(texto, /Entrega: recojo en tienda/)
    assert.match(texto, /2 × GALLETA SODA = S\/ 3\.00/)
    assert.match(texto, /\*TOTAL: S\/ 6\.00\*/)
    assert.match(texto, /Nota: lo paso a las 6/)
    assert.match(texto, /Precios del catálogo al 26\/09\/2026/)
  })

  it('el enlace de WhatsApp lleva el pedido ya escrito, y sin número del negocio no hay enlace', () => {
    const r = armarPedido(catalogo, [{ id: 'p1', cantidad: 1 }], datos)
    if (!r.ok) return
    const url = enlaceWhatsApp(r.pedido, catalogo)
    assert.match(url, /^https:\/\/wa\.me\/51987654321\?text=/)
    assert.match(decodeURIComponent(url), /PEDIDO P-8F3K2/)
    assert.equal(enlaceWhatsApp(r.pedido, { ...catalogo, whatsapp: '' }), '', 'sin número: la pantalla ofrece copiar')
  })

  it('el código del pedido es corto, estable para la misma semilla y distinto para otra', () => {
    assert.equal(codigoPedidoPublico('1758900000000'), codigoPedidoPublico('1758900000000'))
    assert.notEqual(codigoPedidoPublico('1758900000000'), codigoPedidoPublico('1758900000001'))
    assert.match(codigoPedidoPublico('1758900000000'), /^P-[0-9A-Z]{5}$/)
  })

  it('la fecha de publicación se muestra como la lee una persona', () => {
    assert.equal(fechaPublicacion(PUBLICADO), '26/09/2026')
    assert.equal(fechaPublicacion(''), '')
    assert.equal(fechaPublicacion('no es fecha'), '')
  })
})
