/**
 * 🔒 GUARDA: **la sesión no se cierra por inactividad cuando no hay conexión**.
 *
 * 📌 **Por qué existe este test** (decisión del usuario, 21/09/2026): el cierre por inactividad de
 * `App.tsx` corría **siempre**, incluso con el internet del local caído. Como el login de Firebase
 * **necesita red**, ese logout destruía la única sesión que existía y el local quedaba afuera
 * —sin poder volver a entrar— hasta que volviera la conexión: un corte de 20 minutos se convertía
 * en "cerrado hasta que vuelva el internet".
 *
 * Es el mismo criterio que la guarda de la ticketera (`comprobante-comun.test.ts`): el
 * comportamiento se fija leyendo el código fuente, para que no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const app = readFileSync(join(aqui, '..', 'App.tsx'), 'utf8')

/** El bloque del efecto de cierre por inactividad, **incluyendo su línea de dependencias**. */
function bloqueInactividad(): string {
  const desde = app.indexOf('Cierre de sesión por inactividad')
  assert.notEqual(desde, -1, 'No se encontró el bloque de cierre por inactividad en App.tsx')
  const fin = app.indexOf('}, [user, logout', desde)
  assert.notEqual(fin, -1, 'No se encontraron las dependencias del efecto de inactividad')
  // Se incluye la línea de dependencias completa (hasta el cierre del paréntesis del efecto).
  return app.slice(desde, fin + '}, [user, logout, online])'.length)
}

describe('GUARDA: cierre de sesión por inactividad y falta de conexión', () => {
  test('el temporizador NO programa el logout cuando no hay conexión', () => {
    const bloque = bloqueInactividad()
    assert.match(
      bloque,
      /if \(!online\) \{/,
      'El cierre por inactividad perdio la guarda de conexion: sin internet, cerrar la sesion deja al local sin poder volver a entrar (el login necesita red).'
    )
    assert.match(
      bloque,
      /timer = null/,
      'La guarda de conexion debe cancelar el temporizador pendiente, no solo evitar programar uno nuevo.'
    )
  })

  test('el estado de conexión está en las dependencias del efecto', () => {
    const bloque = bloqueInactividad()
    assert.match(
      bloque,
      /\}, \[user, logout, online\]\)/,
      'Falta `online` en las dependencias: sin eso, el temporizador seguiria corriendo durante un corte y al volver la conexion no se rearmaria.'
    )
  })

  test('el aviso de "sin conexión" le dice al usuario que su sesión no se cierra', () => {
    assert.match(
      app,
      /no se cerrará por inactividad mientras estés sin conexión/,
      'El aviso de sin conexion debe aclarar que la sesion no se cierra por inactividad.'
    )
  })
})
