/**
 * El latido del puente de Yape: cuándo el PDV tiene que decir *«el puente está vivo»* y cuándo
 * *«el puente no da señales»*.
 *
 * 📌 **Por qué importa** (22/09/2026): el panel vacío significa «no yapeó nadie» **solo si el
 * puente está vivo**. Con el puente caído, el panel también está vacío pero **la plata entró**, y
 * sin esta regla eso se descubría recién al cerrar el turno (o cuando el cliente volvía a reclamar).
 */
import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  LATIDO_MINUTOS,
  PUENTE_CAIDO_MINUTOS,
  PUENTE_DEMORADO_MINUTOS,
  estadoDelPuente,
  minutosSinSenal,
  recomendacionDelPuente,
  textoDelPuente,
  textoUltimoAviso,
  type LatidoPuenteYape,
} from './puente.ts'

const AHORA = Date.parse('2026-09-22T22:10:00.000Z')
const MIN = 60000

/** Latido base: el celular dio señales hace un minuto. Cada test cambia solo lo que le importa. */
const latido = (extra: Partial<LatidoPuenteYape> = {}): LatidoPuenteYape => ({
  ultimoLatido: AHORA - MIN,
  dispositivo: 'Xiaomi Redmi Note 12',
  android: '13',
  version: 3,
  ...extra,
})

test('un puente que late está activo; dos ciclos sin señales ya son «demorado»', () => {
  assert.equal(estadoDelPuente(latido(), AHORA), 'activo')
  // El borde importa: el ciclo es de 5 min, así que 11 min todavía es normal.
  assert.equal(estadoDelPuente(latido({ ultimoLatido: AHORA - 11 * MIN }), AHORA), 'activo')
  assert.equal(estadoDelPuente(latido({ ultimoLatido: AHORA - PUENTE_DEMORADO_MINUTOS * MIN }), AHORA), 'demorado')
  assert.equal(estadoDelPuente(latido({ ultimoLatido: AHORA - 29 * MIN }), AHORA), 'demorado')
})

test('pasados 30 minutos el puente está caído: los avisos de ese rato no están llegando', () => {
  assert.equal(estadoDelPuente(latido({ ultimoLatido: AHORA - PUENTE_CAIDO_MINUTOS * MIN }), AHORA), 'caido')
  assert.equal(estadoDelPuente(latido({ ultimoLatido: AHORA - 3 * 60 * MIN }), AHORA), 'caido')
  assert.match(textoDelPuente(latido({ ultimoLatido: AHORA - 3 * 60 * MIN }), AHORA), /no están llegando/)
})

test('un puente que NUNCA escribió no es «caído»: es «sin datos» (se arregla distinto)', () => {
  // Sin datos = no se instaló bien (falta la cuenta o el permiso de notificaciones). Caído = estaba
  // andando y se murió. El arreglo no es el mismo, así que no se pueden mostrar igual.
  assert.equal(estadoDelPuente(null, AHORA), 'sin-datos')
  assert.equal(estadoDelPuente(undefined, AHORA), 'sin-datos')
  assert.equal(estadoDelPuente(latido({ ultimoLatido: 0 }), AHORA), 'sin-datos')
  assert.match(textoDelPuente(null, AHORA), /todavía no dio ninguna señal/)
  assert.match(recomendacionDelPuente(null, AHORA), /celular/)
})

test('un reloj adelantado en el celular no muestra tiempos negativos', () => {
  // Si el teléfono tiene la hora adelantada, «hace -3 min» sería absurdo: se lee como recién latió.
  const futuro = latido({ ultimoLatido: AHORA + 5 * MIN })
  assert.equal(minutosSinSenal(futuro, AHORA), 0)
  assert.equal(estadoDelPuente(futuro, AHORA), 'activo')
  assert.equal(minutosSinSenal(latido({ ultimoLatido: 0 }), AHORA), Number.POSITIVE_INFINITY)
})

test('cada estado dice qué hacer (un aviso rojo sin instrucción no sirve)', () => {
  const textos = [
    recomendacionDelPuente(latido(), AHORA),
    recomendacionDelPuente(latido({ ultimoLatido: AHORA - 20 * MIN }), AHORA),
    recomendacionDelPuente(latido({ ultimoLatido: AHORA - 60 * MIN }), AHORA),
    recomendacionDelPuente(null, AHORA),
  ]
  assert.equal(new Set(textos).size, 4, 'los cuatro estados tienen que decir cosas distintas')
  assert.match(textos[0], /no yapeó nadie/, 'activo: si no hay avisos, no yapeó nadie')
  assert.match(textos[2], /Revisá el celular/, 'caído: hay que ir al celular')
  assert.match(textoDelPuente(latido(), AHORA), new RegExp(`late cada ${LATIDO_MINUTOS} min|Puente activo`))
})

test('el último aviso que mandó se muestra con su «hace cuánto» cuando el puente lo informa', () => {
  const conAviso = latido({ ultimoAviso: 'S/ 10.00 · Alesska Pin*', ultimoAvisoEn: AHORA - 12 * MIN })
  assert.match(textoUltimoAviso(conAviso, AHORA), /Último aviso que mandó: S\/ 10\.00 · Alesska Pin\*/)
  assert.match(textoUltimoAviso(conAviso, AHORA), /hace 12 min/)
  // ⚠️ Los puentes viejos (1.2 y anteriores) guardaban el texto pero no cuándo: se muestra sin el
  // «hace cuánto» en vez de inventar una fecha.
  const sinFecha = latido({ ultimoAviso: 'S/ 5.00 · ALFREDO' })
  assert.equal(textoUltimoAviso(sinFecha, AHORA), 'Último aviso que mandó: S/ 5.00 · ALFREDO')
  // 🔑 El caso que más importa: **vivo pero sin mandar nada** (el defecto del bloque ·32).
  assert.match(textoUltimoAviso(latido({ avisosEnviados: 0 }), AHORA), /Todavía no mandó ningún aviso/)
  assert.match(textoUltimoAviso(latido({ avisosEnviados: 37 }), AHORA), /Mandó 37 aviso\(s\)/)
  assert.match(textoUltimoAviso(null, AHORA), /Todavía no mandó ningún aviso/)
})

// ─── Guarda: una sola implementación ────────────────────────────────────────

const aqui = dirname(fileURLToPath(import.meta.url))
const leer = (...partes: string[]) => readFileSync(join(aqui, '..', ...partes), 'utf8')

describe('GUARDA: el estado del puente se muestra igual en las dos pantallas', () => {
  test('el PDV y Configuración usan el mismo componente (no cada uno su texto)', () => {
    // Si cada pantalla se armara su propio texto, el cajero y el dueño podrían leer cosas distintas
    // del mismo latido. La regla vive en `lib/puente.ts` y la dibuja un solo componente.
    for (const archivo of ['pages/Pdv.tsx', 'pages/Configuracion.tsx']) {
      assert.match(
        leer(...archivo.split('/')),
        /<EstadoPuenteYape/,
        `${archivo} tiene que mostrar el estado del puente con el componente compartido.`,
      )
    }
  })

  test('el latido NO vive dentro del panel de avisos (que se esconde cuando no hay avisos)', () => {
    // 📌 El caso que importa es el panel **vacío**: con el puente caído, «vacío» quiere decir que la
    // plata entró y nadie se enteró. Si el latido estuviera dentro del panel, desaparecería justo ahí
    // (el panel devuelve `null` cuando no hay nada que mostrar).
    const panel = leer('components', 'PanelPagosYape.tsx')
    assert.doesNotMatch(panel, /<EstadoPuenteYape/, 'El latido va en la pantalla del PDV, no en el panel.')
    assert.match(panel, /if \(visibles\.length === 0 && resumen\.desconocidos === 0\) return null/, 'El panel se oculta cuando no hay avisos: por eso el latido no puede ir adentro.')
  })

  test('la pantalla no habla con Firestore: la lectura del latido va en services/', () => {
    assert.doesNotMatch(
      leer('components', 'EstadoPuenteYape.tsx'),
      /from 'firebase\/firestore'/,
      'Una pantalla no consulta Firestore: la lectura va en `services/puente.ts`.',
    )
    // Y el estado (activo/caído) no se recalcula en el componente: sale de la regla pura.
    assert.match(leer('components', 'EstadoPuenteYape.tsx'), /estadoDelPuente/)
  })
})
