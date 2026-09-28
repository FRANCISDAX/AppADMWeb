/**
 * Tests del **link de pedidos y su publicación** — `lib/link-pedidos.ts`.
 *
 * 🔑 Lo que fijan (es lo que hace que el link no quede viejo y que el negocio lo encuentre sin ayuda):
 *
 * - **El link es UNO solo y sale de una sola constante**: si algún día hay dominio propio, se cambia acá.
 * - **El catálogo viaja como texto JSON**: se empaqueta y se desempaqueta sin perder nada, y una respuesta rota
 *   (documento vacío, texto que no es JSON, catálogo sin ítems) devuelve `null` en vez de romper el link.
 * - **Cuándo republicar**: la primera vez sí; después, solo pasado el intervalo (una venta no dispara una
 *   escritura por venta).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  COLECCION_PUBLICO,
  DOC_CATALOGO,
  INTERVALO_PUBLICACION_MS,
  ORIGEN_APP,
  RUTA_PEDIDO,
  debePublicar,
  desempaquetarCatalogo,
  empaquetarCatalogo,
  haceCuanto,
  linkPedido,
  mensajeParaCompartir,
  urlCatalogoPublico,
  urlCompartirWhatsApp,
  whatsappDeNegocio,
} from './link-pedidos.ts'
import { catalogoPublico } from './pedido-publico.ts'

const catalogo = catalogoPublico([{ id: 'p1', nombre: 'GALLETA SODA', precioVenta: 1.5, stock: 20, activo: true }], {
  publicado: '2026-09-28T22:00:00.000Z',
  negocio: 'JorFel',
  whatsapp: '51951178055',
})

describe('el link y el mensaje para compartir', () => {
  it('el link es el dominio del app + /pedido (y no se duplican las barras)', () => {
    assert.equal(linkPedido(), `${ORIGEN_APP}${RUTA_PEDIDO}`)
    assert.equal(linkPedido('https://midominio.pe/'), 'https://midominio.pe/pedido')
  })

  it('el mensaje para WhatsApp lleva el link y, si hay, el nombre del negocio', () => {
    const m = mensajeParaCompartir(linkPedido(), 'JorFel')
    assert.match(m, /^\*JorFel\* — pide aquí 👉 https:\/\//)
    assert.match(mensajeParaCompartir(linkPedido()), /^Pide aquí 👉 /)
    assert.match(urlCompartirWhatsApp(m), /^https:\/\/wa\.me\/\?text=/)
    assert.match(decodeURIComponent(urlCompartirWhatsApp(m)), /pide aquí/)
  })

  it('el WhatsApp del negocio se normaliza con código de país (un móvil peruano de 9 dígitos es 51…)', () => {
    assert.equal(whatsappDeNegocio('951178055'), '51951178055')
    assert.equal(whatsappDeNegocio('951 178 055'), '51951178055')
    assert.equal(whatsappDeNegocio('+51 951 178 055'), '51951178055', 'si ya trae código, se respeta')
    assert.equal(whatsappDeNegocio(''), '')
    assert.equal(whatsappDeNegocio(undefined), '')
  })
})

describe('empaquetar y desempaquetar el catálogo (lo que lee el link)', () => {
  it('el catálogo va y vuelve sin perder nada', () => {
    const { datos } = empaquetarCatalogo(catalogo)
    assert.equal(typeof datos, 'string', 'viaja como texto: una sola lectura para el link')
    const vuelta = desempaquetarCatalogo({ fields: { datos: { stringValue: datos } } })
    assert.deepEqual(vuelta, catalogo)
  })

  it('⚠️ una respuesta rota devuelve `null` (el link usa el archivo de respaldo, no se rompe)', () => {
    assert.equal(desempaquetarCatalogo(null), null)
    assert.equal(desempaquetarCatalogo({}), null)
    assert.equal(desempaquetarCatalogo({ fields: {} }), null)
    assert.equal(desempaquetarCatalogo({ fields: { datos: { stringValue: '' } } }), null)
    assert.equal(desempaquetarCatalogo({ fields: { datos: { stringValue: 'no es json' } } }), null)
    assert.equal(desempaquetarCatalogo({ fields: { datos: { stringValue: '{"items":[]}' } } }), null, 'catálogo vacío: mejor la foto')
    assert.equal(desempaquetarCatalogo({ fields: { datos: { integerValue: '3' } } }), null, 'otro tipo de dato')
  })

  it('la URL REST apunta al documento del catálogo y sin credenciales devuelve vacío', () => {
    const url = urlCatalogoPublico({ projectId: 'appadm-b359e', apiKey: 'AIzaClave' })
    assert.match(url, new RegExp(`projects/appadm-b359e/databases/\\(default\\)/documents/${COLECCION_PUBLICO}/${DOC_CATALOGO}`))
    assert.match(url, /key=AIzaClave$/)
    assert.equal(urlCatalogoPublico({ projectId: '', apiKey: 'x' }), '')
    assert.equal(urlCatalogoPublico({ apiKey: 'x' }), '')
  })

  it('con el emulador la URL va al emulador y sin clave (para medir sin tocar producción)', () => {
    const url = urlCatalogoPublico({ projectId: 'demo-appadm', emulador: 'http://localhost:8080' })
    assert.match(url, /^http:\/\/localhost:8080\/v1\/projects\/demo-appadm\/databases\/\(default\)\/documents\//)
    assert.doesNotMatch(url, /key=/)
    assert.doesNotMatch(url, /googleapis/)
  })
})

describe('cuándo republicar (que el link no quede viejo sin escribir de más)', () => {
  it('la primera vez se publica siempre', () => {
    assert.equal(debePublicar(0, 1_000_000), true)
  })

  it('después, solo pasado el intervalo', () => {
    const t = 1_000_000
    assert.equal(debePublicar(t, t + 1000), false, 'una venta no dispara una escritura por venta')
    assert.equal(debePublicar(t, t + INTERVALO_PUBLICACION_MS - 1), false)
    assert.equal(debePublicar(t, t + INTERVALO_PUBLICACION_MS), true)
    assert.equal(debePublicar(t, t + 60_000, 60_000), true, 'el intervalo es configurable')
  })

  it('el «hace cuánto» se lee como lo dice una persona', () => {
    const t = 1_700_000_000_000
    assert.equal(haceCuanto(0, t), 'todavía no se publicó')
    assert.equal(haceCuanto(t, t + 30_000), 'hace 30 s')
    assert.equal(haceCuanto(t, t + 3 * 60_000), 'hace 3 min')
    assert.equal(haceCuanto(t, t + 2 * 3_600_000), 'hace 2 h')
    assert.equal(haceCuanto(t, t + 26 * 3_600_000), 'hace 1 día')
    assert.equal(haceCuanto(t, t + 4 * 24 * 3_600_000), 'hace 4 días')
  })
})
