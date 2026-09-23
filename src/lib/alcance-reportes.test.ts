/**
 * 🔒 GUARDA: **en Facturación tiene que verse DE QUIÉN son los documentos de la lista.**
 *
 * 📌 **Por qué existe** (23/09/2026): el usuario reportó que en *Facturación → Notas de Venta* «solo
 * aparecían las ventas desde el 6 a la fecha» y que las de los primeros días del mes no estaban. No
 * faltaba ninguna: **sin el permiso `verTodo` la consulta filtra `usuarioId == tu uid`** (cada uno ve
 * sus propios documentos), y los primeros días había vendido el usuario admin mientras que a partir
 * del 6 vendió el cajero — con el que se estaba mirando. La pantalla no lo decía en ninguna parte, así
 * que el síntoma se leía como «se perdieron ventas».
 *
 * 🔑 **La regla que queda fijada**: el alcance por usuario **se mantiene** (decisión del usuario, es
 * una función, no un defecto) y **la pantalla tiene que decir a quién corresponde lo que muestra**,
 * igual que la pestaña Pedidos (`Todos los pedidos del mes` / `Tus pedidos del mes`). Si alguien saca
 * el rótulo, vuelve la confusión; si alguien saca el filtro, cambia el alcance de lo que ve un cajero
 * (eso es una decisión de permisos, no un detalle de UI).
 *
 * Es el mismo criterio que las otras guardas del repo: se lee el código fuente para que el
 * comportamiento no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const reportes = readFileSync(join(aqui, '..', 'pages', 'Reportes.tsx'), 'utf8')

describe('GUARDA: Facturación dice de quién son los documentos que muestra', () => {
  test('el alcance sigue acotado al usuario cuando no tiene `verTodo`', () => {
    assert.match(reportes, /const miUid = verTodo \? '' : \(user\?\.uid \|\| ''\)/, 'El alcance por usuario (quien no tiene verTodo ve lo suyo) es una decisión: si se cambia, es un cambio de permisos y hay que hablarlo.')
    assert.match(reportes, /where\('usuarioId', '==', miUid\)/, 'La consulta tiene que seguir filtrando por usuarioId.')
  })

  test('las dos listas aclaran si son «todas» o «tus» documentos del mes', () => {
    // Notas de Venta.
    assert.match(reportes, /verTodo \? 'Todas las notas de venta del mes' : 'Tus notas de venta del mes'/, 'La pestaña Notas de Venta tiene que decir de quién son los documentos (fue el reclamo del 23/09/2026).')
    // Registro SUNAT.
    assert.match(reportes, /verTodo \? 'Todos los documentos del mes' : 'Tus documentos del mes'/, 'El Registro SUNAT está acotado igual: también tiene que decirlo.')
  })

  test('el número de la cabecera no mezcla el total del mes con un importe que es de la página', () => {
    // `X doc · esta página S/ Y`: antes decía `X doc · S/ Y` y el importe parecía ser el del mes.
    const cabeceras = [...reportes.matchAll(/\{(\w+Pag)\.total\} doc · esta página/g)].map((m) => m[1])
    assert.ok(cabeceras.includes('nvPag') && cabeceras.includes('sunatPag'), 'Las dos cabeceras tienen que aclarar que el importe es de la página que se está viendo.')
  })
})
