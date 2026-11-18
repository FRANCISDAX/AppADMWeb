/**
 * 🔑 **Los medios de un egreso** (`lib/egresos-medios.ts`): de dónde sale la plata.
 *
 * 📌 Lo que fija este archivo, en palabras del usuario (03/11/2026): *«algunos egresos no se van a tomar de
 * caja directamente, de pronto pago el dueño con su sueldo, y cuando se pague con caja se va a descontar de
 * caja, solo cuando suceda»*. Si la regla se rompe acá, se rompe el arqueo: un gasto que NO salió del cajón
 * descontado del efectivo inventa un faltante.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MEDIOS_EGRESO, entraAlTurno, esProvision, etiquetaDeMedio, infoDeMedio, tocaLaCaja } from './egresos-medios.ts'

describe('qué medio toca la caja', () => {
  test('SOLO la caja resta del efectivo', () => {
    assert.equal(tocaLaCaja('caja'), true)
    for (const otro of ['transferencia', 'otro', 'provision', 'dueno']) {
      assert.equal(tocaLaCaja(otro), false, `${otro} NO puede tocar el cajón`)
    }
  })

  test('provisión y pago del dueño NO entran al turno (no salió plata ese día)', () => {
    assert.equal(entraAlTurno('provision'), false)
    assert.equal(entraAlTurno('dueno'), false)
    // Los pagos reales sí: son gastos del turno.
    for (const medio of ['caja', 'transferencia', 'otro']) assert.equal(entraAlTurno(medio), true, medio)
  })

  test('solo la provisión está "sin pagar"', () => {
    assert.equal(esProvision('provision'), true)
    for (const m of ['caja', 'transferencia', 'dueno', 'otro']) assert.equal(esProvision(m), false, m)
  })
})

describe('ante la duda, el cajón no se toca', () => {
  test('un medio desconocido o vacío no toca la caja ni el turno', () => {
    // Mismo criterio que `bolsilloDe()`: si el dato no se entiende, nunca cae a efectivo.
    for (const raro of ['', null, undefined, 'lo-que-sea', 'CAJA_FALSA']) {
      assert.equal(tocaLaCaja(raro), false, String(raro))
      assert.equal(entraAlTurno(raro), false, String(raro))
    }
  })

  test('pero "CAJA" en mayúsculas sí es caja (el dato viene de un formulario)', () => {
    assert.equal(tocaLaCaja('CAJA'), true)
  })
})

describe('la etiqueta que se muestra', () => {
  test('cada medio tiene su nombre legible', () => {
    for (const m of MEDIOS_EGRESO) {
      assert.ok(m.label.length > 3, m.id)
      assert.ok(m.ayuda.length > 10, `${m.id} necesita explicar qué implica`)
      assert.equal(etiquetaDeMedio(m.id), m.label)
    }
    assert.equal(MEDIOS_EGRESO.length, 5, 'caja, transferencia, dueño, provisión, otro')
    assert.equal(infoDeMedio('provision').esProvision, true)
  })
})

describe('🛡️ el arqueo no se toca con una provisión ni con un pago del dueño (guarda del cableado)', () => {
  const servicio = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'services', 'egresos.ts'), 'utf8')
  const pantalla = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'pages', 'Egresos.tsx'), 'utf8')

  test('el alta en turno rechaza los medios que no son pago', () => {
    assert.match(servicio, /if \(!entraAlTurno\(egreso\.tipoPago\)\)/, 'tiene que cortar antes de tocar el turno')
  })

  test('totalGastosEfectivo se suma SOLO con tocaLaCaja (el resto no descuenta el cajón)', () => {
    // Alta en el turno: la suma al cajón pasa por la regla.
    assert.match(
      servicio,
      /const gastosEfectivo = \(turnoData\.totalGastosEfectivo \|\| 0\) \+ \(tocaLaCaja\(egreso\.tipoPago\) \? egreso\.monto : 0\)/
    )
    // Pago de una provisión: idem.
    const desdePago = servicio.slice(servicio.indexOf('export async function pagarProvisionDeEgreso'))
    assert.match(desdePago, /\.\.\.\(tocaLaCaja\(medio\) \? \{ totalGastosEfectivo:/)
    // Y que nadie vuelva a comparar el string a mano para decidir si descuenta el cajón.
    assert.doesNotMatch(servicio, /totalGastosEfectivo:[^\n]*tipoPago === 'caja'/)
  })

  test('la pantalla manda al turno solo lo que es pago del día', () => {
    assert.match(pantalla, /entraAlTurno\(formTipo\) && turnoId/)
  })

  test('el pago de una provisión valida el saldo antes de descontar', () => {
    const desdePago = servicio.slice(servicio.indexOf('export async function pagarProvisionDeEgreso'))
    assert.match(desdePago, /efectivoEsperadoDe\(/)
    assert.match(desdePago, /Saldo insuficiente/)
    // Y el mismo documento cambia de estado (no se duplica el gasto).
    assert.match(desdePago, /tx\.update\(egresoRef, cambios\)/)
  })
})
