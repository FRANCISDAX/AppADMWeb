/**
 * **Las fechas del cliente** (`lib/fechas.ts`) y el guarda del kardex.
 *
 * ⚠️ Lo que protegen estos tests: que un día elegido en el calendario sea **el día del negocio** y no un día
 * UTC desplazado. 📌 El bug del 30/10/2026: un movimiento de las 22:00 de hoy (03:00 UTC del día siguiente)
 * no salía en el kardex de hoy — había que elegir mañana.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { diaLocalISO, finDelDia, inicioDelDia, parseDiaLocal, rangoDelDia } from './fechas.ts'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('fechas — el día es LOCAL, no UTC', () => {
  it('`YYYY-MM-DD` se parsea como medianoche LOCAL (no `new Date(texto)`)', () => {
    const d = parseDiaLocal('2026-10-30')
    assert.ok(d)
    assert.equal(d.getFullYear(), 2026)
    assert.equal(d.getMonth(), 9) // octubre
    assert.equal(d.getDate(), 30)
    assert.equal(d.getHours(), 0)
    // ⚠️ La trampa: `new Date('2026-10-30')` es medianoche **UTC**; en Lima eso cae el 29 a las 19:00.
    const trampa = new Date('2026-10-30')
    assert.notEqual(trampa.getDate(), 30, 'si esto cambia, el bug ya no aplica')
  })

  it('un texto inválido devuelve null (no inventa una fecha)', () => {
    assert.equal(parseDiaLocal(''), null)
    assert.equal(parseDiaLocal(null), null)
    assert.equal(parseDiaLocal(undefined), null)
    assert.equal(parseDiaLocal('no es fecha'), null)
    assert.equal(parseDiaLocal('2026-02-31'), null) // 31 de febrero: no existe
  })

  it('los extremos del rango son locales: 00:00:00.000 y 23:59:59.999', () => {
    const d = parseDiaLocal('2026-10-30')
    assert.ok(d)
    assert.equal(inicioDelDia(d).getHours(), 0)
    assert.equal(inicioDelDia(d).getMinutes(), 0)
    assert.equal(finDelDia(d).getHours(), 23)
    assert.equal(finDelDia(d).getMinutes(), 59)
    assert.equal(finDelDia(d).getSeconds(), 59)
    assert.equal(finDelDia(d).getMilliseconds(), 999)
  })

  /** 🛡️ **El test del bug**: una venta de las 22:00 locales tiene que caer en el día de HOY. */
  it('una salida de las 22:00 de hoy entra en el rango de hoy (y no en el de mañana)', () => {
    const hoy = new Date(2026, 9, 30, 22, 0, 0) // 30/10/2026 22:00 **local**
    const sello = hoy.toISOString() // …T03:00Z del día siguiente
    const rangoHoy = rangoDelDia('2026-10-30', '2026-10-30')
    const rangoManana = rangoDelDia('2026-10-31', '2026-10-31')
    assert.ok(rangoHoy && rangoManana)
    // La comparación es lexicográfica sobre ISO: funciona porque los dos son UTC con el mismo formato.
    assert.ok(sello >= rangoHoy.desdeISO && sello <= rangoHoy.hastaISO, 'la venta de las 22:00 tiene que estar en HOY')
    assert.ok(!(sello >= rangoManana.desdeISO && sello <= rangoManana.hastaISO), 'y NO en mañana')
  })

  it('un rango con las fechas invertidas se ordena solo (nunca queda vacío)', () => {
    const r = rangoDelDia('2026-10-31', '2026-10-30')
    assert.ok(r)
    assert.ok(r.desdeISO < r.hastaISO)
    // ⚠️ Se comparan los **días locales** (el ISO de las 23:59 locales puede caer en el día siguiente UTC).
    const desde = new Date(r.desdeISO)
    const hasta = new Date(r.hastaISO)
    assert.equal(diaLocalISO(desde), '2026-10-30')
    assert.equal(diaLocalISO(hasta), '2026-10-31')
  })

  it('`diaLocalISO` devuelve el día del navegador en `YYYY-MM-DD`', () => {
    assert.equal(diaLocalISO(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
    assert.equal(diaLocalISO(new Date(2026, 11, 31, 0, 15)), '2026-12-31')
    assert.match(diaLocalISO(), /^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('🛡️ el kardex usa la regla de fechas del cliente', () => {
  it('el servicio arma el rango con `rangoDelDia` (no con `new Date(texto)` + setHours)', () => {
    const servicio = leer('../services/kardex.ts')
    assert.match(servicio, /rangoDelDia\(fechaDesde, fechaHasta\)/)
    assert.match(servicio, /const \{ desdeISO, hastaISO \} = rango/)
    assert.ok(!/setHours\(0, 0, 0, 0\)/.test(servicio), 'el kardex no puede volver a recortar el día a mano')
  })

  it('la pantalla pasa los TEXTOS del calendario, no un `new Date(...)`', () => {
    const pagina = leer('../pages/Kardex.tsx')
    assert.match(pagina, /consultarKardex\(producto, desde, hasta\)/)
    assert.ok(!/consultarKardex\(producto, new Date\(/.test(pagina), 'new Date("YYYY-MM-DD") es UTC y desplaza el día')
    assert.match(pagina, /useState\(diaLocalISO\(\)\)/)
  })
})
