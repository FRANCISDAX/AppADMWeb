/**
 * Tests de `limpiarUndefined` / `rutaConUndefined` (`lib/limpio.ts`).
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 *
 * El caso que los origina: **enviar una venta a caja fallaba siempre** con
 * *"Function transaction.set() called with invalid data. Unsupported field value: undefined"*
 * porque el payload llevaba `descuentoGlobalTipo: undefined` y `envio: undefined`. TypeScript no
 * dijo nada (el campo era opcional) y el error aparecía recién al escribir en Firestore.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { limpiarUndefined, mensajeDeDatoInvalido, rutaConUndefined } from './limpio.ts'

describe('limpiarUndefined — el caso que rompía la venta', () => {
  it('quita las propiedades undefined del payload', () => {
    const payload = {
      total: 58,
      descuento_global_tipo: undefined,
      descuento_global_valor: undefined,
      envio: undefined,
      cajero: '',
    }
    assert.deepEqual(limpiarUndefined(payload), { total: 58, cajero: '' })
  })

  it('lo hace en profundidad (el undefined puede estar anidado)', () => {
    const payload = { venta: { total: 10, envio: undefined, items: [{ id: 'a', kit: undefined }] } }
    assert.deepEqual(limpiarUndefined(payload), { venta: { total: 10, items: [{ id: 'a' }] } })
  })

  it('no muta el objeto original', () => {
    const original: Record<string, unknown> = { a: 1, b: undefined }
    limpiarUndefined(original)
    assert.ok('b' in original, 'el original conserva su propiedad')
  })
})

describe('limpiarUndefined — lo que NO se toca', () => {
  it('respeta null, false, 0 y cadena vacía (son valores con significado)', () => {
    const payload = { a: null, b: false, c: 0, d: '', e: 'texto' }
    assert.deepEqual(limpiarUndefined(payload), { a: null, b: false, c: 0, d: '', e: 'texto' })
  })

  it('respeta Date y las instancias de clase (Timestamp, centinelas de Firestore)', () => {
    class Centinela {
      campo: string
      constructor(campo: string) { this.campo = campo }
    }
    const fecha = new Date('2026-09-17T12:00:00Z')
    const centinela = new Centinela('stock')
    const salida = limpiarUndefined({ fecha, centinela, b: 1 }) as { fecha: Date; centinela: Centinela; b: number }
    assert.equal(salida.fecha, fecha, 'mantiene la MISMA instancia de Date')
    assert.equal(salida.centinela, centinela, 'no convierte el centinela en objeto plano')
  })

  it('un objeto anidado con prototipo propio no se aplana', () => {
    const conPrototipo = Object.create({ heredado: true }) as Record<string, unknown>
    conPrototipo.propio = 1
    const salida = limpiarUndefined({ x: conPrototipo }) as { x: Record<string, unknown> }
    assert.equal(salida.x, conPrototipo)
  })

  it('los undefined dentro de un array se descartan (Firestore también los rechaza)', () => {
    assert.deepEqual(limpiarUndefined({ pagos: [undefined, { monto: 5 }, undefined] }), { pagos: [{ monto: 5 }] })
  })

  it('valores primitivos y arrays simples vuelven igual', () => {
    assert.equal(limpiarUndefined('hola'), 'hola')
    assert.equal(limpiarUndefined(0), 0)
    assert.equal(limpiarUndefined(null), null)
    assert.deepEqual(limpiarUndefined([1, 2, 3]), [1, 2, 3])
  })

  it('un objeto vacío o solo con undefined queda vacío', () => {
    assert.deepEqual(limpiarUndefined({ a: undefined }), {})
  })
})

describe('rutaConUndefined — para diagnosticar', () => {
  it('encuentra la ruta exacta del undefined', () => {
    assert.equal(rutaConUndefined({ venta: { total: 1, envio: undefined } }), 'venta.envio')
    assert.equal(rutaConUndefined({ a: [{ b: undefined }] }), 'a[0].b')
    assert.equal(rutaConUndefined({ a: 1 }), '')
  })

  it('detecta el undefined suelto dentro de un array', () => {
    assert.equal(rutaConUndefined({ pagos: [{ monto: 1 }, undefined] }), 'pagos[1]')
  })

  it('un payload limpio devuelve cadena vacía', () => {
    assert.equal(rutaConUndefined({ venta: { total: 1, envio: null, items: [] } }), '')
  })
})

// 📌 Caso real (28/09/2026): al registrar una compra en Gastos/Egresos, el proveedor escrito a mano
// no estaba cargado en la colección ⇒ `proveedorId: undefined` ⇒ Firestore rechazaba la escritura con
// el mensaje críptico. Esto lo traduce a algo que el que está cargando el dato pueda entender.
describe('mensajeDeDatoInvalido — el error críptico, traducido', () => {
  it('nombra el campo que quedó sin completar', () => {
    const real =
      'Function Transaction.set() called with invalid data. Unsupported field value: undefined (found in field proveedorId in document tblEgresos/abc123)'
    const texto = mensajeDeDatoInvalido(real)
    assert.match(String(texto), /proveedorId/)
    assert.match(String(texto), /no se guardó nada/)
  })

  it('igual avisa aunque el mensaje no diga el campo', () => {
    const texto = mensajeDeDatoInvalido('Unsupported field value: undefined')
    assert.match(String(texto), /Faltó completar un dato/)
    assert.doesNotMatch(String(texto), /\(/)
  })

  it('con otro error devuelve null (el llamador muestra el original)', () => {
    assert.equal(mensajeDeDatoInvalido('Missing or insufficient permissions.'), null)
    assert.equal(mensajeDeDatoInvalido(''), null)
    assert.equal(mensajeDeDatoInvalido(undefined), null)
  })
})
