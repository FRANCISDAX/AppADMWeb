/**
 * 🔒 GUARDA: **el historial de Yape (`Reportes → Yape`) lee por RANGO DE FECHAS y filtra en memoria.**
 *
 * 📌 **Por qué existe este test** (22/09/2026): los avisos de Yape se veían **solo el día que
 * llegaban** (el panel del PDV lee los del día) y los confirmados de un turno **solo al cerrarlo**.
 * Al día siguiente, un yapeo era invisible desde la app, aunque el documento siga en `tblPagosYape`
 * para siempre. Se agregó el historial: una pantalla que lee un rango y muestra quién usó cada
 * aviso, en qué comprobante y cuáles quedaron sin usar.
 *
 * 🔑 **La decisión que se fija acá es la del índice**: filtrar por estado **en la consulta** exige un
 * índice compuesto (`estado` + rango de `fecha`) declarado en `firestore.indexes.json` **y
 * desplegado**; si falta, la consulta no falla en el desarrollo, falla en producción
 * (*«The query requires an index»*, el mismo síntoma que ya costó el bloque ·5 del historial).
 * Por eso: **una sola consulta por `fecha`** (un campo ⇒ sin índice compuesto) y el filtro de
 * situación/buscador en memoria (`filtrarAvisosYape`, puro y testeado).
 *
 * Es el mismo criterio que las otras guardas (`configuracion-en-vivo.test.ts`,
 * `comprobante-comun.test.ts`, `sesion-offline.test.ts`): el comportamiento se fija leyendo el
 * código fuente, para que no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const servicio = readFileSync(join(aqui, '..', 'services', 'yape.ts'), 'utf8')
const pantalla = readFileSync(join(aqui, '..', 'components', 'ReporteAvisosYape.tsx'), 'utf8')

/** El cuerpo de `obtenerAvisosYapeDelRango`, que es donde vive la consulta del historial. */
const consultaDelHistorial = (): string => {
  const desde = servicio.indexOf('export async function obtenerAvisosYapeDelRango')
  assert.ok(desde > 0, 'No existe obtenerAvisosYapeDelRango: el historial se quedo sin lectura.')
  const hasta = servicio.indexOf('// ─── El aviso de PRUEBA', desde)
  return servicio.slice(desde, hasta > desde ? hasta : undefined)
}

describe('GUARDA: el historial de Yape se lee por rango y sin índice compuesto', () => {
  test('la consulta del historial filtra SOLO por fecha (un campo ⇒ sin índice compuesto)', () => {
    const cuerpo = consultaDelHistorial()
    assert.match(cuerpo, /where\('fecha', '>=', desde\)/, 'El historial tiene que acotar el rango por fecha.')
    assert.match(cuerpo, /where\('fecha', '<=', hasta\)/, 'Sin cota superior, el rango se come dias que no se pidieron.')
    assert.match(cuerpo, /orderBy\('fecha', 'desc'\)/, 'Los avisos se leen del mas nuevo al mas viejo.')
  })

  test('nadie metió una igualdad en la consulta del historial (eso pide un índice compuesto)', () => {
    assert.doesNotMatch(
      cuerpoSinComentarios(),
      /where\('(?!fecha)/,
      'Aparecio un where de igualdad (por ejemplo estado) en la consulta del historial: eso exige un indice compuesto declarado en firestore.indexes.json Y desplegado, y sin el la consulta falla recien en produccion.'
    )
  })

  test('el tope de la lectura se informa (no se esconde que puede haber más avisos)', () => {
    assert.match(servicio, /const LIMITE_AVISOS_HISTORIAL = \d+/, 'Falta el tope de la lectura del historial.')
    assert.match(consultaDelHistorial(), /tope: snap\.size >= LIMITE_AVISOS_HISTORIAL/, 'El historial tiene que decir cuando llego al tope: si no, parece que esos avisos no existen.')
    assert.match(pantalla, /tope &&/, 'La pantalla tiene que mostrar el aviso de tope alcanzado.')
  })

  test('un error de lectura NO se muestra como «no hay avisos»', () => {
    assert.match(
      consultaDelHistorial(),
      /error\?: string/,
      'La lectura tiene que devolver el error: un rango vacio y una lectura que fallo no son lo mismo, y el reporte no puede mentir.'
    )
    assert.match(pantalla, /setError\(r\.error \?\? ''\)/, 'La pantalla tiene que guardar el error que devuelve el servicio.')
  })

  test('la pantalla no habla con Firestore: el filtro y la planilla salen de lib/', () => {
    assert.doesNotMatch(
      pantalla,
      /from 'firebase\/firestore'/,
      'Una pantalla no consulta Firestore: las lecturas van en services/ y las reglas en lib/ (capas).'
    )
    for (const helper of ['filtrarAvisosYape', 'conteoAvisosYape', 'resumenHistorialYape', 'filasDeAvisosYape']) {
      assert.match(pantalla, new RegExp(helper), `La pantalla dejo de usar ${helper}: la regla tiene que vivir en lib/, no reescrita en el componente.`)
    }
  })
})

/**
 * El cuerpo de la consulta sin sus comentarios: los comentarios de esa función **nombran** el
 * `where('estado', ...)` que está prohibido, y sin sacarlos el test se acusaría a sí mismo.
 */
function cuerpoSinComentarios(): string {
  return consultaDelHistorial()
    .split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'))
    .join('\n')
}
