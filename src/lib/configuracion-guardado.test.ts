/**
 * 🔒 GUARDA: **un guardado bloqueado tiene que decir POR QUÉ en la pestaña donde estás**.
 *
 * 📌 **Por qué existe** (21/09/2026): el botón «Guardar Configuración» de `Configuracion.tsx` se
 * deshabilita cuando hay conflictos de series **bloqueantes** (`erroresSeries`), pero esos mensajes
 * se dibujaban **solo dentro de la pestaña SUNAT**. Desde **Plantillas** el admin agregaba un
 * producto de embalaje, apretaba Guardar, no pasaba nada y no había ningún motivo a la vista; al
 * recargar, los items volvían a como estaban — se veía como «no puedo agregar más productos».
 *
 * Mismo criterio que las otras guardas del repo (`comprobante-comun.test.ts`, `sesion-offline.test.ts`):
 * el comportamiento se fija leyendo el código fuente, para que no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const config = readFileSync(join(aqui, '..', 'pages', 'Configuracion.tsx'), 'utf8')

describe('GUARDA: el botón de guardar explica por qué está bloqueado', () => {
  test('el aviso de bloqueo se muestra fuera de la pestaña SUNAT', () => {
    assert.match(
      config,
      /erroresSeries\.length > 0 && tab !== 'sunat'/,
      'El motivo del bloqueo de series tiene que verse en TODAS las pestañas (menos SUNAT, donde ya está arriba): si no, desde Plantillas el guardado falla en silencio.'
    )
  })

  test('el botón de guardar sigue bloqueado por los conflictos de series', () => {
    assert.match(
      config,
      /disabled=\{saving \|\| erroresSeries\.length > 0\}/,
      'El botón debe seguir deshabilitado cuando hay conflictos bloqueantes: si se quita esa condición, se guardarían series que comparten contador de correlativos.'
    )
  })

  test('el aviso junto al botón lista los mensajes (no solo dice que hay un problema)', () => {
    const desde = config.indexOf("tab !== 'sunat'")
    assert.notEqual(desde, -1, 'No se encontró la guarda del aviso')
    const bloque = config.slice(desde, desde + 1200)
    assert.match(
      bloque,
      /erroresSeries\.map/,
      'El aviso tiene que listar los mensajes concretos (qué serie choca y con cuál), no un texto genérico.'
    )
  })
})
