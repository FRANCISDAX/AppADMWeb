/**
 * 🔒 GUARDA: **la configuración de la empresa se lee EN VIVO** (`onSnapshot`), no una sola vez.
 *
 * 📌 **Por qué existe este test** (22/09/2026): `useConfiguracion` hacía **un `getDoc` al montar**,
 * así que cualquier pantalla ya abierta seguía con los valores viejos hasta recargar. El caso real:
 * el admin cambió la **vigencia de un aviso de Yape** de 10 a 5 minutos, mandó el aviso de prueba y
 * el PDV —abierto desde antes— seguía diciendo *«vence en 10 min»*: el panel usaba su copia.
 *
 * Acá se fijan las tres cosas que no se pueden perder sin que el defecto vuelva:
 * (a) la config llega por listener, (b) nadie reintroduce la lectura única, y
 * (c) **lo que se está editando manda**: el listener no pisa el formulario con cambios sin guardar.
 *
 * Es el mismo criterio que las guardas de la ticketera y de la sesión offline: el comportamiento
 * se fija leyendo el código fuente, para que no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const hook = readFileSync(join(aqui, '..', 'hooks', 'use-configuracion.ts'), 'utf8')

describe('GUARDA: la configuración llega en vivo', () => {
  test('la config se escucha con onSnapshot', () => {
    assert.match(
      hook,
      /onSnapshot\(/,
      'La config volvio a leerse una sola vez: una pantalla abierta se queda con los valores viejos (el PDV mostraba 10 min de vigencia cuando ya eran 5).'
    )
  })

  test('nadie volvió a la lectura única de la config', () => {
    assert.doesNotMatch(
      hook,
      /getDoc\(/,
      'Aparecio un getDoc en useConfiguracion: la lectura al montar es justo el defecto que este hook ya no puede tener.'
    )
  })

  test('el listener se da de baja al desmontar', () => {
    assert.match(
      hook,
      /const soltar = onSnapshot\(/,
      'El listener tiene que guardarse en una variable para poder soltarlo.'
    )
    assert.match(
      hook,
      /return soltar/,
      'Sin devolver el unsubscribe, cada pantalla que se abre deja un listener colgado.'
    )
  })

  test('lo que se está editando manda: el snapshot no pisa el formulario', () => {
    assert.match(
      hook,
      /if \(!editando\.current && snap\.exists\(\)\)/,
      'El snapshot debe respetar la edicion local: si no, un cambio que llega de otro dispositivo borra lo que la persona esta escribiendo.'
    )
    assert.match(
      hook,
      /editando\.current = true/,
      'setConfig tiene que marcar que hay cambios sin guardar.'
    )
    assert.match(
      hook,
      /editando\.current = false/,
      'Al guardar bien, la edicion termina: si no, la pantalla deja de seguir la config para siempre.'
    )
  })

  test('la API del hook no cambió (12 pantallas dependen de ella)', () => {
    assert.match(
      hook,
      /return \{ config, setConfig, loading, saving, guardar \}/,
      'Cambio la forma del hook: las pantallas que lo usan esperan config, setConfig, loading, saving y guardar.'
    )
  })
})
