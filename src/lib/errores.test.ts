import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { crearGuardiaErrores, esRuido, normalizarError, resumenError } from './errores.ts'

test('normalizarError saca mensaje y stack de un Error', () => {
  const r = normalizarError(new Error('boom'))
  assert.equal(r.mensaje, 'boom')
  assert.ok((r.stack ?? '').length > 0)
})

test('normalizarError acepta strings, objetos con message y cosas raras', () => {
  assert.equal(normalizarError('falló algo').mensaje, 'falló algo')
  assert.equal(normalizarError({ message: 'desde objeto' }).mensaje, 'desde objeto')
  assert.equal(normalizarError({ code: 42 }).mensaje, '{"code":42}')
  assert.equal(normalizarError(null).mensaje, 'null')
  assert.equal(normalizarError(undefined).mensaje, 'undefined')
})

test('normalizarError no explota con objetos circulares', () => {
  const circular: Record<string, unknown> = {}
  circular.self = circular
  assert.ok(normalizarError(circular).mensaje.length > 0)
})

test('esRuido filtra lo que no aporta y deja pasar los errores reales', () => {
  assert.equal(esRuido('ResizeObserver loop limit exceeded'), true)
  assert.equal(esRuido('Script error.'), true)
  assert.equal(esRuido('Loading chunk 7 failed.'), true)
  assert.equal(esRuido('Cannot read properties of undefined'), false)
})

test('la guardia limita por ventana de tiempo', () => {
  let t = 1_000
  const permitido = crearGuardiaErrores({ maxPorVentana: 3, ventanaMs: 10_000, ahora: () => t })
  assert.equal(permitido('a|1'), true)
  assert.equal(permitido('a|2'), true)
  assert.equal(permitido('a|3'), true)
  assert.equal(permitido('a|4'), false, 'cuarto error dentro de la ventana se descarta')
  t += 10_001
  assert.equal(permitido('a|5'), true, 'pasada la ventana vuelve a permitir')
})

test('la guardia descarta el error repetido aunque pase el tiempo', () => {
  let t = 0
  const permitido = crearGuardiaErrores({ maxPorVentana: 10, ventanaMs: 1_000, ahora: () => t })
  assert.equal(permitido('render|boom'), true)
  t += 5_000
  assert.equal(permitido('render|boom'), false, 'el mismo error no se registra dos veces')
  assert.equal(permitido('render|otro'), true, 'uno distinto sí')
})

test('resumenError arma un texto útil para copiar y pegar', () => {
  const texto = resumenError({
    mensaje: 'boom',
    contexto: 'pantalla:pdv',
    fecha: '2026-09-16T10:00:00.000Z',
    ruta: 'https://app/#/pdv',
    dispositivo: 'Chrome',
    stack: 'Error: boom\n  at x',
  })
  assert.match(texto, /pantalla:pdv/)
  assert.match(texto, /boom/)
  assert.match(texto, /https:\/\/app\/#\/pdv/)
  assert.match(texto, /at x/)
})
