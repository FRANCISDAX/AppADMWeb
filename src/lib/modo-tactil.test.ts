/**
 * 🔑 **Modo táctil**: la regla que decide si se agranda la letra y las áreas de toque.
 *
 * 📌 **Por qué existe** (pantalla táctil, 03/11/2026): el app está dibujado para un mouse. En un monitor
 * táctil de 15" la letra de 10-11 px no se lee y los botones de 28-32 px no se aciertan, así que el modo
 * táctil agranda **solo esas dos cosas**. Acá se fija el comportamiento que importa:
 *
 * - **Un equipo con mouse no cambia nada** (si el modo grande se activara solo ahí, sería una regresión).
 * - **Una pantalla táctil nueva ya arranca cómoda**: nadie tiene que descubrir el botón para trabajar.
 * - **La decisión de una persona gana sobre la detección** — y se acuerda en el equipo, no en el negocio.
 *
 * Y una guarda sobre `index.css`: **ninguna regla del modo táctil puede aplicar fuera de la clase**, porque
 * si se escapa, la UI de escritorio cambia sin que nadie lo haya pedido.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  CLAVE_MODO_TACTIL,
  CLASE_MODO_TACTIL,
  CUALQUIER_PUNTERO_QUERY,
  PUNTERO_PRINCIPAL_QUERY,
  debeAvisarModoTactil,
  etiquetaModoTactil,
  hayPantallaTactil,
  leerPreferencia,
  modoTactilActivo,
  preferenciaAlTocar,
  textoAvisoModoTactil,
  textoModoTactil,
} from './modo-tactil.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(aqui, '..', 'index.css'), 'utf8')
const main = readFileSync(join(aqui, '..', 'main.tsx'), 'utf8')
const hook = readFileSync(join(aqui, '..', 'hooks', 'use-modo-tactil.ts'), 'utf8')

describe('la preferencia guardada en el equipo', () => {
  test('lo elegido se respeta', () => {
    assert.equal(leerPreferencia('si'), 'si')
    assert.equal(leerPreferencia('no'), 'no')
  })

  test('sin preferencia (o con basura en el almacén) decide el tipo de puntero', () => {
    assert.equal(leerPreferencia(null), 'auto')
    assert.equal(leerPreferencia(undefined), 'auto')
    assert.equal(leerPreferencia(''), 'auto')
    assert.equal(leerPreferencia('true'), 'auto')
    // Una versión futura que guarde otra cosa no deja al app sin saber qué hacer.
    assert.equal(leerPreferencia('modo-tactil'), 'auto')
  })
})

describe('cómo se entera de que la pantalla es táctil', () => {
  test('una u otra señal alcanza, y hacen falta las dos consultas', () => {
    // Celular, tablet o POS sin mouse: el puntero principal ya es un dedo.
    assert.equal(hayPantallaTactil(true, true), true)
    // 🔑 El caso que motiva la segunda consulta: monitor táctil de PC con mouse conectado. El principal es
    // `fine`, pero `any-pointer` dice que el equipo tiene entrada táctil — sin esto, la caja táctil quedaba
    // sin el modo justo cuando lo necesita.
    assert.equal(hayPantallaTactil(false, true), true)
    // Equipo táctil cuyo sistema reporta solo la principal (raro, pero posible).
    assert.equal(hayPantallaTactil(true, false), true)
    // PC común con mouse: no hay ninguna señal táctil.
    assert.equal(hayPantallaTactil(false, false), false)
    // Las consultas son las del navegador: cambiar la cadena cambia lo que se pregunta.
    assert.equal(PUNTERO_PRINCIPAL_QUERY, '(pointer: coarse)')
    assert.equal(CUALQUIER_PUNTERO_QUERY, '(any-pointer: coarse)')
    // Y el hook tiene que preguntar **las dos**: si alguien deja solo la principal, la caja con mouse
    // vuelve a quedar sin el modo y no habría ningún error a la vista.
    assert.match(hook, /PUNTERO_PRINCIPAL_QUERY/)
    assert.match(hook, /CUALQUIER_PUNTERO_QUERY/)
  })
})

describe('cuándo se activa', () => {
  test('en automático: la pantalla táctil sí, el mouse no', () => {
    // El caso que motiva la función: una caja con pantalla táctil abre el app y ya se ve grande.
    assert.equal(modoTactilActivo('auto', true), true)
    // La PC de administración con mouse no se toca.
    assert.equal(modoTactilActivo('auto', false), false)
  })

  test('lo que eligió una persona le gana a la detección, en los dos sentidos', () => {
    // Apagado a mano en una pantalla táctil (le molesta el modo grande): queda apagado al reabrir.
    assert.equal(modoTactilActivo('no', true), false)
    // Encendido a mano en un equipo con mouse (pantalla chica, vista cansada): queda encendido.
    assert.equal(modoTactilActivo('si', false), true)
  })
})

describe('el aviso de la primera vez', () => {
  test('avisa solo si el modo se encendió SOLO y todavía no se avisó', () => {
    // El caso real: nadie eligió nada, el equipo es táctil, nunca se le dijo nada a la persona.
    assert.equal(debeAvisarModoTactil('auto', true, false), true)
    // Ya se avisó: no vuelve en cada ingreso (un cartel que reaparece es ruido).
    assert.equal(debeAvisarModoTactil('auto', true, true), false)
    // El modo está apagado: no hay nada que explicar.
    assert.equal(debeAvisarModoTactil('auto', false, false), false)
    // Lo encendió la persona: ya lo sabe, no se le explica su propia decisión.
    assert.equal(debeAvisarModoTactil('si', true, false), false)
    assert.equal(debeAvisarModoTactil('no', false, false), false)
  })

  test('el aviso dice qué detectó, qué cambió y con qué botón se apaga', () => {
    const texto = textoAvisoModoTactil()
    assert.match(texto, /pantalla táctil/)
    assert.match(texto, /Táctil/, 'tiene que nombrar el botón que lo cambia')
  })
})

describe('el botón', () => {
  test('guardar es lo contrario de lo que se está viendo', () => {
    // Está encendido y se toca → se guarda «no». Está apagado y se toca → se guarda «si».
    assert.equal(preferenciaAlTocar(true), 'no')
    assert.equal(preferenciaAlTocar(false), 'si')
    // El primer toque hace explícita la preferencia: desde ahí la detección no vuelve a opinar.
    assert.equal(leerPreferencia(preferenciaAlTocar(true)), 'no')
    assert.equal(leerPreferencia(preferenciaAlTocar(false)), 'si')
  })

  test('el texto dice el estado y qué hace el toque (en táctil no hay `title` que valga)', () => {
    assert.match(textoModoTactil(true), /activado/)
    assert.match(textoModoTactil(true), /desactivarlo/)
    assert.match(textoModoTactil(false), /desactivado/)
    assert.match(textoModoTactil(false), /agrandar/)
    // La etiqueta corta muestra el estado con una marca, no solo con color.
    assert.match(etiquetaModoTactil(true), /✓/)
    assert.doesNotMatch(etiquetaModoTactil(false), /✓/)
  })

  test('la clave y la clase son el contrato con el almacén y con el CSS', () => {
    assert.equal(CLAVE_MODO_TACTIL, 'appadm-modo-tactil')
    assert.equal(CLASE_MODO_TACTIL, 'modo-tactil')
    // El CSS de abajo cuelga de esta clase: si cambia una, la otra deja de aplicar en silencio.
    assert.ok(css.includes(`.${CLASE_MODO_TACTIL} `), 'index.css tiene que colgar de la clase')
  })
})

describe('dónde se aplica', () => {
  test('antes del primer pintado, al entrar al app (el login también sale grande)', () => {
    // No en un efecto de React: si no, el login aparece chico y salta de tamaño al entrar.
    assert.match(main, /if \(!esPedidoPublico\) leerYAplicarModoTactil\(\)/)
  })

  test('la vidriera pública queda afuera (es la cara del negocio, no una pantalla de caja)', () => {
    // El link `/pedido` lo abre un cliente en su celular y tiene su propia maqueta apretada (tarjetas con
    // botones de 32 px): agrandarle todo rompería el diseño que el usuario aprobó. Por eso **no puede haber
    // una llamada suelta**: la única invocación va detrás de la condición de ruta.
    const sueltas = main.split('\n').filter((l) => /^\s*leerYAplicarModoTactil\(\)/.test(l))
    assert.deepEqual(sueltas, [], 'la llamada en `main.tsx` tiene que estar conditional a la ruta')
  })
})

describe('guarda: el modo táctil no puede tocar la UI normal', () => {
  const bloque = (() => {
    const desde = css.indexOf('===== MODO TÁCTIL (inicio)')
    const hasta = css.indexOf('===== MODO TÁCTIL (fin)')
    assert.ok(desde > -1 && hasta > desde, 'index.css tiene que tener el bloque del modo táctil')
    // Desde el `/*` que abre la cabecera del bloque, y sin comentarios: solo quedan selectores y reglas.
    const crudo = css.slice(css.lastIndexOf('/*', desde), hasta)
    return crudo.replace(/\/\*[\s\S]*?\*\//g, '')
  })()

  test('cada regla del bloque está acotada a `.modo-tactil`', () => {
    const selectores = [...bloque.matchAll(/([^{}]+)\{/g)].flatMap((m) =>
      m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
    assert.ok(selectores.length > 0, 'el bloque tiene que tener reglas')
    const sueltos = selectores.filter((s) => !s.startsWith(`.${CLASE_MODO_TACTIL}`))
    assert.deepEqual(
      sueltos,
      [],
      'una regla sin la clase cambiaría el app con mouse: el modo táctil es opt-in por equipo'
    )
  })

  test('agranda la letra chica y las áreas de toque de 44 px', () => {
    // La letra: los dos tamaños escritos a mano y los dos utilitarios que se usan en todas las pantallas.
    for (const clase of ['text-\\[10px\\]', 'text-\\[11px\\]', 'text-xs', 'text-sm']) {
      assert.ok(bloque.includes(`.${CLASE_MODO_TACTIL} .${clase}`), `falta agrandar ${clase}`)
    }
    // El área de toque mínima recomendada.
    assert.ok(bloque.includes('min-height: 2.75rem'), 'toda área de toque tiene que llegar a 44 px')
    // El asa de arrastre del Dashboard no se puede quedar sin `touch-action` (el gesto se lo lleva el scroll).
    assert.ok(bloque.includes('touch-action: none'))
    // Los campos a 16 px, que es lo que evita el zoom automático de iOS/iPadOS al enfocar.
    assert.ok(bloque.includes('font-size: 1rem'), 'los campos tienen que quedar en 16 px')
  })
})
