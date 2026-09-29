/**
 * **Los Términos y Condiciones y su registro de aceptación** (`lib/terminos.ts`).
 *
 * ⚠️ Lo que estos tests fijan es lo que hace que una aceptación **valga** como prueba: que la versión y
 * la fecha estén declaradas, que el **id** sea estable (una aceptación por usuario y versión, no dos),
 * que haya **huella** del texto y que el texto sea el mismo que se aceptó.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CLAUSULAS_TERMINOS,
  COLECCION_ACEPTACIONES,
  FECHA_TERMINOS,
  NOTA_TERMINOS,
  VERSION_TERMINOS,
  huellaTerminos,
  idAceptacion,
  textoPlanoTerminos,
} from './terminos.ts'

const aca = dirname(fileURLToPath(import.meta.url))

describe('terminos — el texto que se acepta', () => {
  it('declara versión y fecha (sin eso no se sabe QUÉ se aceptó)', () => {
    assert.match(VERSION_TERMINOS, /^\d+\.\d+$/)
    assert.match(FECHA_TERMINOS, /^\d{2}\/\d{2}\/\d{4}$/)
  })

  it('tiene las 10 cláusulas del documento legal, numeradas y sin huecos', () => {
    assert.equal(CLAUSULAS_TERMINOS.length, 10)
    assert.deepEqual(
      CLAUSULAS_TERMINOS.map((c) => c.n),
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    )
    for (const c of CLAUSULAS_TERMINOS) {
      assert.ok(c.titulo.length > 3, `la cláusula ${c.n} tiene título`)
      assert.ok(c.texto.length > 40, `la cláusula ${c.n} tiene texto de verdad`)
    }
  })

  it('la cláusula 7 dice lo que tiene que decir (es la que protege al proveedor)', () => {
    const siete = CLAUSULAS_TERMINOS.find((c) => c.n === '7')
    assert.ok(siete, 'existe la cláusula 7')
    assert.match(siete.texto, /tal cual/i)
    assert.match(siete.texto, /referenciales/i)
    assert.match(siete.texto, /no reemplazan la contabilidad/i)
    assert.match(siete.texto, /se limita a las contraprestaciones pagadas/i)
  })

  it('la nota aclara que el documento completo es el que se entrega', () => {
    assert.match(NOTA_TERMINOS, new RegExp(VERSION_TERMINOS.replace('.', '\\.')))
    assert.match(NOTA_TERMINOS, /documento completo/i)
  })
})

describe('terminos — la huella del texto', () => {
  it('es estable (el mismo texto da la misma huella)', () => {
    assert.equal(huellaTerminos(), huellaTerminos())
    assert.match(huellaTerminos(), /^[0-9a-f]{8}$/)
  })

  it('cambia si cambia el texto (sirve para detectar que se editó sin subir la versión)', () => {
    const original = huellaTerminos()
    const cambiado = huellaTerminos([{ n: '1', titulo: 'Objeto y licencia', texto: 'otra cosa' }])
    assert.notEqual(cambiado, original)
  })

  it('la huella que se registra es la del texto que se muestra', () => {
    // El texto en plano tiene que contener TODAS las cláusulas: es lo que se copia o se imprime.
    const plano = textoPlanoTerminos()
    for (const c of CLAUSULAS_TERMINOS) {
      assert.ok(plano.includes(`${c.n}. ${c.titulo}`), `el texto en plano no tiene la cláusula ${c.n}`)
    }
    assert.match(plano, /versión 1\.0/)
  })
})

describe('terminos — el id de la aceptación', () => {
  it('es determinista: aceptar dos veces no crea dos registros', () => {
    assert.equal(idAceptacion('abc123'), idAceptacion('abc123'))
  })

  it('lleva la versión: una versión nueva pide una aceptación nueva', () => {
    assert.notEqual(idAceptacion('abc123', '1.0'), idAceptacion('abc123', '2.0'))
    assert.match(idAceptacion('abc123'), /^terminos_1\.0_abc123$/)
  })

  it('no se rompe con un uid vacío o con espacios', () => {
    assert.equal(idAceptacion(''), 'terminos_1.0_')
    assert.equal(idAceptacion('  abc  '), 'terminos_1.0_abc')
  })

  it('deja el uid al final, para poder buscarlo', () => {
    assert.ok(idAceptacion('uid-largo-123').endsWith('uid-largo-123'))
  })
})

/**
 * 🛡️ **Test-guarda del cableado**: que la constancia se **escriba** en la colección correcta, con el uid
 * de quien acepta y **sin poder tocarla después**, y que exista la regla que lo permite. Se lee el fuente
 * porque el riesgo no es el cálculo (está arriba, probado) sino que la pantalla o la regla se desconecten.
 */
describe('🛡️ la aceptación llega de la pantalla a la base', () => {
  const componente = readFileSync(join(aca, '..', 'components', 'AceptacionTerminos.tsx'), 'utf8')
  const reglas = readFileSync(join(aca, '..', '..', 'firestore.rules'), 'utf8')

  it('la pantalla usa la colección, el id y la huella de este módulo', () => {
    assert.match(componente, /COLECCION_ACEPTACIONES/)
    assert.match(componente, /idAceptacion\(/)
    assert.match(componente, /huellaTerminos\(/)
  })

  it('registra quién aceptó (uid, correo, rol) y cuándo, con la hora del SERVIDOR', () => {
    assert.match(componente, /uid: user\?\.uid \|\| ''/)
    assert.match(componente, /email: user\?\.email \|\| ''/)
    assert.match(componente, /rol,/)
    assert.match(componente, /aceptadoEn: serverTimestamp\(\)/)
    assert.match(componente, /version: VERSION_TERMINOS/)
  })

  it('la base solo acepta crear (no se puede reescribir ni borrar la constancia)', () => {
    assert.match(reglas, new RegExp(`match /${COLECCION_ACEPTACIONES}/`))
    const bloque = reglas.slice(reglas.indexOf(`match /${COLECCION_ACEPTACIONES}/`))
    const cuerpo = bloque.slice(0, bloque.indexOf('\n    }'))
    assert.match(cuerpo, /allow create:/)
    assert.match(cuerpo, /request\.resource\.data\.get\('uid', ''\) == uid\(\)/)
    assert.match(cuerpo, /allow update, delete: if false/)
  })

  it('solo el ADMIN ve la pantalla (el contrato lo acepta el negocio, no cada empleado)', () => {
    // El rol se resuelve UNA vez y la pantalla no se dibuja para nadie más: los demás roles siguen
    // trabajando sin que nada les bloquee una venta.
    assert.match(componente, /const esAdmin = rol === 'ADMIN'/)
    assert.match(componente, /if \(!esAdmin \|\| !falta\) return null/)
  })
})
