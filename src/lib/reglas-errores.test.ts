/**
 * 🔑 **GUARDA: si la pantalla ofrece borrar, la regla tiene que dejar borrar — y si no deja, hay que decirlo.**
 *
 * 📌 **El bug que motiva este test** (03/11/2026): Auditoría → Errores tiene el botón **«Limpiar +30 días»**
 * y `firestore.rules` decía `allow update, delete: if false` en `tblErrores`. El `batch.commit()` fallaba con
 * `permission-denied`, el servicio lo atrapaba con un `console.error` y **devolvía 0**: en pantalla se leía
 * *«No había errores con más de 30 días»*. O sea: un botón que **nunca pudo funcionar**, mintiendo, y una
 * colección de diagnóstico que **crecía para siempre**.
 *
 * Lo que fija este archivo, leyendo el código fuente (mismo criterio que `sesion-offline.test.ts` con
 * `App.tsx`, porque no hay emulador en el medio):
 *
 * 1. La regla de `tblErrores` permite **borrar a quien tiene auditoría** (la retención) y **no permite editar**
 *    (un error registrado es una prueba: no se reescribe).
 * 2. La forma es la MISMA que la de `tblAuditLog`, que ya tenía su retención resuelta.
 * 3. El servicio **no se traga el error**: devuelve el motivo, y la pantalla lo muestra.
 *
 * ⚠️ **Al agregar una colección con limpieza o borrado, esto se rompe a propósito**: la regla y el botón
 * tienen que contradecirse lo menos posible.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const reglas = readFileSync(join(aqui, '..', '..', 'firestore.rules'), 'utf8')
const servicio = readFileSync(join(aqui, '..', 'services', 'errores.ts'), 'utf8')
const panel = readFileSync(join(aqui, '..', 'components', 'auditoria', 'ErroresPanel.tsx'), 'utf8')

/** El bloque `match /coleccion/{id} { … }`, tal cual está escrito en las reglas. */
function bloqueDe(nombre: string): string {
  const desde = reglas.indexOf(`match /${nombre}/`)
  assert.ok(desde > -1, `firestore.rules no tiene un bloque para ${nombre}`)
  const hasta = reglas.indexOf('\n    }', desde)
  assert.ok(hasta > desde, `el bloque de ${nombre} no cierra como se espera`)
  return reglas.slice(desde, hasta)
}

/** El bloque sin comentarios: los comentarios NOMBRAN la forma vieja para explicarla. */
function sinComentarios(texto: string): string {
  return texto
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join('\n')
}

/** Los `allow …` del bloque, con los comentarios del final de línea afuera. */
function permisos(bloque: string): string[] {
  return [...bloque.matchAll(/allow\s+([a-z,\s]+):\s*if\s+([^;\n]+)/g)].map((m) => `${m[1].replace(/\s+/g, ' ').trim()}: ${m[2].trim()}`)
}

describe('tblErrores: la regla tiene que acompañar al botón', () => {
  const bloque = bloqueDe('tblErrores')
  const lista = permisos(bloque)

  test('deja borrar a quien tiene auditoría (esa es la retención)', () => {
    // Sin esta línea, «Limpiar +30 días» es un botón decorativo que además miente.
    assert.ok(
      lista.some((p) => p.startsWith('delete:') && p.includes('auditoria()')),
      'falta `allow delete: if auditoria()` en tblErrores'
    )
  })

  test('NO se puede editar: un error registrado es una prueba', () => {
    assert.ok(lista.some((p) => p === 'update: false'), 'tiene que quedar `allow update: if false`')
  })

  test('cualquier pantalla firmada puede reportar un error', () => {
    assert.ok(lista.some((p) => p.startsWith('create:') && p.includes('firmado()')))
  })

  test('leer los errores pide el permiso de auditoría', () => {
    assert.ok(lista.some((p) => p.startsWith('read:') && p.includes('auditoria()')))
  })

  test('no vuelve la forma que rompía el botón (`update, delete: if false`)', () => {
    assert.doesNotMatch(sinComentarios(bloque), /allow\s+update,\s*delete:\s*if\s+false/)
    // Y borrar no puede quedar cerrado de ninguna otra forma.
    assert.doesNotMatch(sinComentarios(bloque), /allow\s+delete:\s*if\s+false/)
  })

  test('usa la misma forma que tblAuditLog, que ya tenía su retención', () => {
    const bitacora = permisos(bloqueDe('tblAuditLog'))
    const borrar = (ps: string[]) => ps.find((p) => p.startsWith('delete:'))
    assert.equal(borrar(lista), borrar(bitacora), 'las dos colecciones de diagnóstico se limpian con el mismo criterio')
  })
})

describe('limpiarErrores: un borrado imposible no puede parecer «no había nada»', () => {
  test('el servicio devuelve el motivo, no solo el número', () => {
    assert.match(servicio, /ResultadoLimpieza/, 'tiene que exportar el tipo del resultado')
    assert.match(servicio, /borrados: number; error: string \| null/, 'el resultado lleva `error`')
    // El `catch` no puede volver a devolver un número pelado.
    const desdeCatch = servicio.slice(servicio.lastIndexOf('} catch (e) {'))
    assert.match(desdeCatch, /return \{ borrados, error: motivo \}/, 'el catch tiene que devolver el motivo')
  })

  test('traduce el permission-denied a algo accionable (no a un texto técnico)', () => {
    assert.match(servicio, /permission-denied/)
    assert.match(servicio, /permiso de auditoría/)
  })

  test('la pantalla muestra el error en vez de decir que no había nada', () => {
    assert.match(panel, /if \(error\) toast\(error/, 'ErroresPanel tiene que avisar del fallo')
  })
})
