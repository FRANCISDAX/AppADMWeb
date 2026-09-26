/**
 * Tests de los reintentos por contención (`lib/reintentos.ts`).
 *
 * 🔑 **Lo que protegen**, que es lo que decide si el cajero cobra o ve un error:
 *
 * - **Qué se reintenta y qué no**: `ABORTED: Transaction lock timeout` (dos cajas con el mismo
 *   producto) sí; un error de negocio (*Stock insuficiente*), un permiso denegado o la **falta de un
 *   índice** (`failed-precondition`, el bloque ·5) **no** — reintentarlos solo hace esperar al cajero
 *   para el mismo resultado y tapa el problema real.
 * - **La espera crece y tiene temblor**: si las tres cajas reintentan al mismo tiempo, vuelven a
 *   chocar; el temblor las despega. Y nunca espera más que el tope.
 * - **Al agotar los intentos, se lanza el ÚLTIMO error** (no uno inventado) para que el envoltorio
 *   decida qué mostrar.
 * - **El mensaje del usuario** dice qué hacer y **no promete** que la venta se registró.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import {
  CODIGOS_TRANSITORIOS,
  ESPERA_BASE_MS,
  ESPERA_MAXIMA_MS,
  codigoDeError,
  conReintentos,
  esErrorTransitorio,
  esperaDeReintento,
  mensajeSistemaOcupado,
  textoDeError,
} from './reintentos.ts'

/** Un error como los que tira el SDK de Firestore. */
const errorFirestore = (code: string, message = '') => Object.assign(new Error(message || code), { code })

describe('qué error es transitorio (vale reintentar)', () => {
  it('la contención de dos cajas es transitoria', () => {
    assert.equal(esErrorTransitorio(errorFirestore('aborted', 'Transaction lock timeout')), true)
    assert.equal(esErrorTransitorio(errorFirestore('unavailable', 'unavailable')), true)
    assert.equal(esErrorTransitorio(errorFirestore('deadline-exceeded', 'deadline exceeded')), true)
    assert.equal(esErrorTransitorio(errorFirestore('resource-exhausted', 'quota')), true)
  })

  it('el código llega como venga (mayúsculas, con espacios, o en `name`)', () => {
    assert.equal(esErrorTransitorio({ code: 'ABORTED' }), true)
    assert.equal(esErrorTransitorio({ code: ' aborted ' }), true)
    assert.equal(esErrorTransitorio(Object.assign(new Error('x'), { name: 'Aborted' })), true)
  })

  it('si no hay código, el texto del SDK alcanza para reconocerlo', () => {
    assert.equal(esErrorTransitorio(new Error('ABORTED: Transaction lock timeout')), true)
    assert.equal(esErrorTransitorio(new Error('Failed to fetch')), true)
    assert.equal(esErrorTransitorio('the transaction has too many pending writes'), true)
  })

  it('un error de NEGOCIO no se reintenta (reintentar solo hace esperar para lo mismo)', () => {
    assert.equal(esErrorTransitorio(new Error('Stock insuficiente de Arroz 1kg')), false)
    assert.equal(esErrorTransitorio(errorFirestore('permission-denied')), false)
    assert.equal(esErrorTransitorio(errorFirestore('not-found')), false)
    assert.equal(esErrorTransitorio(errorFirestore('already-exists')), false)
  })

  it('la falta de un ÍNDICE no se reintenta: es un problema de configuración, no de suerte', () => {
    // `failed-precondition` es el código de «The query requires an index» (bloque ·5 del historial).
    assert.equal(esErrorTransitorio(errorFirestore('failed-precondition', 'The query requires an index')), false)
    assert.equal(
      esErrorTransitorio(errorFirestore('failed-precondition', 'The query requires an index. You can create it here: https://…')),
      false,
    )
  })

  it('pero el MISMO código sirve para un choque de versiones, y ESO sí se reintenta', () => {
    // 📌 Lo destapó la prueba de contención real: con mucha concurrencia el SDK se rinde con
    // `failed-precondition: the stored version … does not match the required base version`. Antes se
    // trataba como definitivo y el cajero veía ese texto en inglés.
    const choque = errorFirestore(
      'failed-precondition',
      '9 FAILED_PRECONDITION: the stored version (1790446492619959) does not match the required base version (1790446488618483)',
    )
    assert.equal(esErrorTransitorio(choque), true)
    assert.equal(esErrorTransitorio(new Error('stored version does not match the required base version')), true)
  })

  it('no se cae con cualquier cosa que le pasen', () => {
    assert.equal(esErrorTransitorio(null), false)
    assert.equal(esErrorTransitorio(undefined), false)
    assert.equal(esErrorTransitorio(''), false)
    assert.equal(esErrorTransitorio({}), false)
    assert.equal(esErrorTransitorio(42), false)
  })

  it('lee el código y el texto sin inventar', () => {
    assert.equal(codigoDeError(errorFirestore('ABORTED')), 'aborted')
    // Sin `code`, se usa el `name`: un `Error` común da `'error'` (que **no** es transitorio, y por eso
    // queda el respaldo por texto); un error con `name: 'Aborted'` sí se reconoce.
    assert.equal(codigoDeError(new Error('sin código')), 'error')
    assert.equal(esErrorTransitorio(new Error('sin código')), false)
    assert.equal(codigoDeError(null), '')
    assert.equal(textoDeError({ message: 'hola' }), 'hola')
    assert.equal(textoDeError({ error: 'hola' }), 'hola')
    assert.equal(textoDeError(null), '')
    assert.equal(CODIGOS_TRANSITORIOS.includes('aborted'), true)
  })
})

describe('la espera entre reintentos', () => {
  it('crece al doble y se corta en el tope', () => {
    const sinTemblor = { aleatorio: () => 1 } // factor 1: el valor ideal, para poder afirmar el número
    assert.equal(esperaDeReintento(1, sinTemblor), ESPERA_BASE_MS)
    assert.equal(esperaDeReintento(2, sinTemblor), ESPERA_BASE_MS * 2)
    assert.equal(esperaDeReintento(3, sinTemblor), ESPERA_BASE_MS * 4)
    assert.equal(esperaDeReintento(10, sinTemblor), ESPERA_MAXIMA_MS, 'no espera más que el tope')
  })

  it('el temblor despega a las cajas (nunca menos de la mitad, nunca más del total)', () => {
    assert.equal(esperaDeReintento(1, { aleatorio: () => 0 }), ESPERA_BASE_MS / 2)
    assert.equal(esperaDeReintento(1, { aleatorio: () => 1 }), ESPERA_BASE_MS)
    for (let i = 0; i < 50; i++) {
      const ms = esperaDeReintento(2)
      assert.ok(ms >= ESPERA_BASE_MS && ms <= ESPERA_BASE_MS * 2, `fuera de rango: ${ms}`)
    }
  })

  it('un intento inválido no rompe la cuenta', () => {
    assert.equal(esperaDeReintento(0, { aleatorio: () => 1 }), ESPERA_BASE_MS)
    assert.equal(esperaDeReintento(Number.NaN, { aleatorio: () => 1 }), ESPERA_BASE_MS)
  })
})

describe('conReintentos (el bucle)', () => {
  it('devuelve el resultado del primer intento que sale bien', async () => {
    let intentos = 0
    const r = await conReintentos(async () => {
      intentos++
      return 'cobrado'
    })
    assert.equal(r, 'cobrado')
    assert.equal(intentos, 1, 'si sale bien no reintenta')
  })

  it('reintenta la contención y termina bien (el caso de las 3 cajas)', async () => {
    let intentos = 0
    const esperas: number[] = []
    const r = await conReintentos(
      async () => {
        intentos++
        if (intentos < 3) throw errorFirestore('aborted', 'Transaction lock timeout')
        return `venta-ok-en-${intentos}`
      },
      { dormir: async (ms) => void esperas.push(ms), aleatorio: () => 1 },
    )
    assert.equal(r, 'venta-ok-en-3')
    assert.equal(intentos, 3, 'el carrito se cobró en el tercer intento')
    assert.deepEqual(esperas, [ESPERA_BASE_MS, ESPERA_BASE_MS * 2], 'esperó antes de cada reintento')
  })

  it('si se agotan los intentos, lanza el ÚLTIMO error (no uno inventado)', async () => {
    let intentos = 0
    await assert.rejects(
      conReintentos(
        async () => {
          intentos++
          throw errorFirestore('aborted', `choque ${intentos}`)
        },
        { dormir: async () => {} },
      ),
      (e) => textoDeError(e) === 'choque 4' && codigoDeError(e) === 'aborted',
    )
    assert.equal(intentos, 4, '1 intento + 3 reintentos por defecto')
  })

  it('un error de negocio NO se reintenta: falla en el acto', async () => {
    let intentos = 0
    await assert.rejects(
      conReintentos(async () => {
        intentos++
        throw new Error('Stock insuficiente de Arroz 1kg')
      }),
      /Stock insuficiente/,
    )
    assert.equal(intentos, 1, 'no hace esperar al cajero para el mismo resultado')
  })

  it('se puede pedir más o menos reintentos', async () => {
    let intentos = 0
    await assert.rejects(
      conReintentos(
        async () => {
          intentos++
          throw errorFirestore('unavailable')
        },
        { reintentos: 1, dormir: async () => {} },
      ),
    )
    assert.equal(intentos, 2)
  })

  it('avisa de cada reintento (para poder dejarlo en la consola)', async () => {
    const avisos: string[] = []
    await conReintentos(
      async (intento) => {
        if (intento === 1) throw errorFirestore('aborted')
        return 'ok'
      },
      {
        dormir: async () => {},
        alReintentar: (e, intento, ms) => avisos.push(`${intento}:${codigoDeError(e)}:${ms}`),
      },
    )
    assert.equal(avisos.length, 1)
    assert.match(avisos[0], /^1:aborted:\d+$/)
  })
})

describe('el mensaje que ve el cajero', () => {
  it('dice qué hacer y por qué, sin inglés ni código crudo', () => {
    const m = mensajeSistemaOcupado('venta')
    assert.match(m, /El sistema está ocupado/)
    assert.match(m, /varias cajas/)
    assert.match(m, /Reintenta en un momento/)
    assert.doesNotMatch(m, /aborted|timeout|ABORTED/i, 'el código crudo no se le muestra al cajero')
  })

  it('NO promete que la venta se registró (la transacción no se aplicó)', () => {
    assert.match(mensajeSistemaOcupado(), /no se registró nada/)
  })
})

/**
 * 🛡️ **GUARDA: ninguna transacción se saltea el reintento.**
 *
 * La regla se rompe sola si alguien agrega un servicio nuevo y usa `runTransaction` del SDK: ese camino
 * volvería a mostrarle al cajero *«aborted: Transaction lock timeout»*. Este test lee los servicios y
 * falla si aparece — el mismo mecanismo de las otras guardas del repo (`sesion-offline`, `comprobante-comun`).
 */
describe('GUARDA: todas las transacciones pasan por el envoltorio', () => {
  const servicios = new URL('../services/', import.meta.url)

  it('ningún servicio llama a `runTransaction` directamente', () => {
    const archivos = readdirSync(servicios).filter((f) => f.endsWith('.ts') && f !== 'transacciones.ts')
    assert.ok(archivos.length > 5, `se esperaban los servicios (encontré ${archivos.length})`)
    const culpables = archivos.filter((f) => /runTransaction\(/.test(readFileSync(new URL(f, servicios), 'utf8')))
    assert.deepEqual(culpables, [], `usan runTransaction sin el reintento: ${culpables.join(', ')} (usar ejecutarTransaccion)`)
  })

  it('el envoltorio usa el SDK y traduce el error de contención', () => {
    const texto = readFileSync(new URL('transacciones.ts', servicios), 'utf8')
    assert.match(texto, /runTransaction\(db, fn\)/, 'el envoltorio es el que habla con el SDK')
    assert.match(texto, /esErrorTransitorio/, 'clasifica el error con la regla pura')
    assert.match(texto, /mensajeSistemaOcupado/, 'y lo cambia por el mensaje que entiende el cajero')
  })
})
