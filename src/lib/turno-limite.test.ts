/**
 * **El aviso de turno con demasiadas ventas** (`lib/turno-limite.ts`).
 *
 * ⚠️ Lo que estos tests protegen es que el aviso **aparezca antes de que sea tarde**: el turno guarda el
 * detalle completo de cada venta y **no puede pasar de 1 MiB**, así que al acercarse al techo **falla el
 * cobro**. El aviso tiene que ser claro sobre qué hacer (cerrar el turno y abrir otro), no solo sobre el
 * problema.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  BYTES_POR_VENTA,
  LIMITE_DOCUMENTO,
  VENTAS_AVISO,
  VENTAS_CERRAR,
  VENTAS_URGENTE,
  limiteDeTurno,
} from './turno-limite.ts'

describe('turno-limite — cuándo avisar', () => {
  it('los umbrales de fábrica son los aprobados: 400 avisa, 500 cierra y 800 es urgente', () => {
    assert.equal(VENTAS_AVISO, 400)
    assert.equal(VENTAS_CERRAR, 500)
    assert.equal(VENTAS_URGENTE, 800)
  })

  it('un turno normal no dice nada', () => {
    for (const n of [0, 1, 12, 399]) {
      const r = limiteDeTurno(n)
      assert.equal(r.nivel, 'ok', `${n} ventas no debería avisar`)
      assert.equal(r.titulo, '')
      assert.equal(r.detalle, '')
      assert.equal(r.cerrarAhora, false)
    }
  })

  it('🔑 a las 400 avisa que a las 500 hay que cerrarlo (y todavía no pide cerrar)', () => {
    const r = limiteDeTurno(400)
    assert.equal(r.nivel, 'aviso')
    assert.equal(r.cerrarAhora, false, 'a las 400 todavía no es obligatorio')
    assert.match(r.titulo, /400 ventas/)
    assert.match(r.detalle, /500 ventas/, 'el aviso tiene que decir CUÁNDO cerrar')
    assert.match(r.detalle, /cerrarlo y abrir otro/i)
  })

  it('🔑 a las 500 pide cerrar el turno ya', () => {
    const r = limiteDeTurno(500)
    assert.equal(r.nivel, 'cerrar')
    assert.equal(r.cerrarAhora, true)
    assert.match(r.titulo, /cerralo/i)
    assert.match(r.detalle, /Cerrá el turno/i)
  })

  it('🔑 a las 800 grita: cerca del límite no se puede cobrar', () => {
    const r = limiteDeTurno(800)
    assert.equal(r.nivel, 'urgente')
    assert.equal(r.cerrarAhora, true)
    assert.match(r.titulo, /ahora/i)
    assert.match(r.detalle, /no vas a poder cobrar/i)
  })

  it('entre los umbrales el nivel no baja (400 ≠ 499 ≠ 500)', () => {
    assert.equal(limiteDeTurno(499).nivel, 'aviso')
    assert.equal(limiteDeTurno(501).nivel, 'cerrar')
    assert.equal(limiteDeTurno(799).nivel, 'cerrar')
    assert.equal(limiteDeTurno(801).nivel, 'urgente')
  })

  it('el turno más grande que hubo en producción (12 ventas) está lejísimos del aviso', () => {
    // 📌 Medido el 04/10/2026: el turno más grande tiene 12 ventas y pesa 6,6 KB (0,6 % del límite).
    const r = limiteDeTurno(12)
    assert.equal(r.nivel, 'ok')
    assert.ok(r.kb < 20, `12 ventas deberían estimar pocos KB (dio ${r.kb})`)
  })

  it('estima el tamaño del documento con el peso medido por venta', () => {
    const r = limiteDeTurno(500)
    // 500 × 1.036 bytes = 518.000 B ≈ 506 KB
    assert.equal(r.kb, Math.round((500 * BYTES_POR_VENTA) / 1024))
    assert.ok(r.pct > 45 && r.pct < 55, `500 ventas deberían rondar la mitad del límite (dio ${r.pct} %)`)
  })

  it('⚠️ el techo medido (~1.000 ventas) cae dentro del nivel urgente', () => {
    const techo = Math.floor(LIMITE_DOCUMENTO / BYTES_POR_VENTA)
    assert.ok(techo > 900 && techo < 1100, `el techo medido dio ${techo} ventas`)
    assert.equal(limiteDeTurno(techo).nivel, 'urgente', 'llegar al techo tiene que estar en urgente')
  })

  it('no se rompe con datos que no son números', () => {
    for (const v of [null, undefined, NaN, -5]) {
      assert.equal(limiteDeTurno(v as number).nivel, 'ok')
      assert.equal(limiteDeTurno(v as number).ventas, 0)
    }
  })

  it('los umbrales se pueden ajustar sin tocar la regla', () => {
    const r = limiteDeTurno(30, { aviso: 20, cerrar: 40, urgente: 60 })
    assert.equal(r.nivel, 'aviso')
    assert.match(r.detalle, /40 ventas/)
  })
})

/**
 * 🛡️ **Test-guarda**: el aviso tiene que salir de **una sola regla**. El bug que lo motiva es que el
 * detalle del turno se guarda completo y no puede pasar de 1 MiB: si cada pantalla escribiera su propio
 * «500», un cambio de umbral dejaría una de las dos avisando tarde (o nunca).
 */
describe('🛡️ el aviso del turno es una sola regla', () => {
  const regla = readFileSync(new URL('./turno-limite.ts', import.meta.url), 'utf8')
  const aviso = readFileSync(new URL('../components/AvisoLimiteTurno.tsx', import.meta.url), 'utf8')
  const turnos = readFileSync(new URL('../pages/Turnos.tsx', import.meta.url), 'utf8')
  const pdv = readFileSync(new URL('../pages/Pdv.tsx', import.meta.url), 'utf8')

  it('la regla trae el límite medido y los umbrales en un solo lugar', () => {
    assert.match(regla, /LIMITE_DOCUMENTO = 1024 \* 1024/)
    assert.match(regla, /BYTES_POR_VENTA = 1036/, 'el peso por venta es el medido, no un número inventado')
  })

  it('el aviso es un componente que usa la regla', () => {
    assert.match(aviso, /limiteDeTurno\(/)
    // ⚠️ No se busca el número «500» a secas: las clases de Tailwind traen números (`amber-500`).
    assert.ok(!/>=?\s*(400|500|800)\b/.test(aviso), 'el componente no puede tener su propio umbral')
    assert.match(aviso, /limite\.titulo/, 'el texto sale de la regla, no del componente')
    assert.match(aviso, /limite\.detalle/)
  })

  it('las dos pantallas lo montan y no calculan umbrales por su cuenta', () => {
    assert.match(turnos, /AvisoLimiteTurno/)
    assert.match(pdv, /AvisoLimiteTurno/)
    for (const [nombre, src] of [['Turnos.tsx', turnos], ['Pdv.tsx', pdv]] as const) {
      assert.ok(!/limiteDeTurno\(/.test(src), `${nombre} no debería llamar a la regla: la usa el componente`)
      assert.ok(!/>= *500/.test(src), `${nombre} no puede tener su propio umbral de 500`)
      assert.ok(!/ventasDelTurno.*length *> *[0-9]/.test(src), `${nombre} no puede comparar el largo a mano`)
    }
  })
})
