/**
 * 🛡️ **Test-guarda: los egresos no pueden volver a fallar por un `undefined`.**
 *
 * 📌 **Caso real (28/09/2026)**: en **Gastos/Egresos**, registrar una compra (bolsas) fallaba con
 * *«Function transaction.set() called with invalid data. Unsupported field value: undefined (found in
 * field proveedorId…)»*. El que cargaba el gasto escribió el proveedor a mano, ese proveedor **no
 * estaba en la colección** y la pantalla mandaba `proveedorId: undefined` (igual que el RUC, el nombre
 * y el comprobante cuando quedan vacíos). Firestore **no ignora** `undefined`: rechaza la escritura
 * entera ⇒ **no se guardaba nada** y el turno tampoco sumaba el gasto (era la misma transacción).
 *
 * ⚠️ **El arreglo va en el borde de escritura** (`limpiarUndefined`, la regla de `lib/limpio.ts`), no
 * solo en la pantalla: la pantalla puede cambiar, el servicio no. Este test lee el archivo y falla si
 * alguien escribe un payload crudo con datos del formulario.
 *
 * ⚠️ Es un test que **lee el código fuente** (no ejecuta Firestore): es la única forma de fijar una
 * regla del borde de escritura sin montar un emulador en `npm test`. El comportamiento real medido
 * está en el arnés `run-egreso.mjs` (emulador + navegador).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aca = dirname(fileURLToPath(import.meta.url))
const servicio = readFileSync(join(aca, '..', 'services', 'egresos.ts'), 'utf8')

describe('services/egresos.ts — todo payload pasa por limpiarUndefined', () => {
  it('importa el helper', () => {
    assert.match(servicio, /import \{[^}]*limpiarUndefined[^}]*\} from '@\/lib\/limpio'/)
  })

  it('al crear (sin turno): el `addDoc` limpia el payload', () => {
    // El egreso viene del formulario: RUC, nombre del proveedor, `proveedorId` y comprobante son
    // opcionales y llegan vacíos.
    assert.match(servicio, /addDoc\(\s*collection\(db, COL\.EGRESOS\),\s*limpiarUndefined\(/)
  })

  it('al crear dentro del turno: se limpia ANTES de escribirlo y el turno recibe el objeto limpio', () => {
    assert.match(servicio, /const egresoLimpio = limpiarUndefined\(\{/)
    assert.match(servicio, /tx\.set\(egresoRef, egresoLimpio\)/)
    // `gastosDelTurno` es un array: un `undefined` adentro también hace fallar la transacción.
    assert.match(servicio, /const nuevosGastos = \[\.\.\.\(turnoData\.gastosDelTurno \|\| \[\]\), egresoLimpio\]/)
  })

  it('al editar: el `updateDoc` limpia lo que llega parcial del formulario', () => {
    assert.match(servicio, /updateDoc\(doc\(db, COL\.EGRESOS, egresoId\), limpiarUndefined\(rest\)\)/)
  })

  it('no vuelve el payload crudo (el bug del 28/09/2026)', () => {
    assert.doesNotMatch(servicio, /tx\.set\(egresoRef, egresoDoc\)/)
    assert.doesNotMatch(servicio, /tx\.set\(egresoRef, \{\s*\.\.\.egreso/)
  })

  it('y el error críptico se traduce para el que está cargando el dato', () => {
    assert.match(servicio, /mensajeDeDatoInvalido\(err\.message\)/)
  })
})
