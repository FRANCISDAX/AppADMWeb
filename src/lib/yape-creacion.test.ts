/**
 * 🔒 GUARDA: **la app solo puede crear un aviso de Yape marcado como PRUEBA**.
 *
 * 📌 **Por qué existe** (22/09/2026): el diseño de los avisos de Yape se apoya en una frase —*los
 * avisos los crea el puente, la app solo los lee y avanza su estado*— porque un aviso significa
 * «el negocio recibió plata». Si alguien agrega mañana un camino que cree un aviso desde la app
 * (un botón «registrar yapeo», un import, un script), ese significado se rompe **en silencio** y
 * el cruce del cierre deja de ser una prueba de nada.
 *
 * La única excepción es el **aviso de prueba** de `Configuración → Yape`, que existe para poder
 * comprobar el circuito completo sin que alguien yapee de verdad y para la puesta en marcha del
 * puente: va con `origen: 'prueba'` (marcado en el PDV y en el cierre) y se puede borrar.
 *
 * Mismo criterio que las otras guardas del repo (`comprobante-comun.test.ts`,
 * `sesion-offline.test.ts`, `configuracion-guardado.test.ts`): el comportamiento se fija leyendo
 * el código fuente, para que no dependa de la memoria de nadie.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const raizSrc = join(aqui, '..')
const servicio = readFileSync(join(raizSrc, 'services', 'yape.ts'), 'utf8')

/** Todos los archivos de `src/` (para buscar quién escribe en la colección). */
function archivos(dir: string, acc: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) archivos(ruta, acc)
    else if (/\.tsx?$/.test(nombre) && !/\.test\.ts$/.test(nombre)) acc.push(ruta)
  }
  return acc
}

describe('GUARDA: los avisos de Yape los crea el puente, no la app', () => {
  test('el único alta de un aviso es la del aviso de prueba', () => {
    const altas = [...servicio.matchAll(/addDoc\(\s*collection\(db,\s*COL\.PAGOS_YAPE\)/g)]
    assert.equal(
      altas.length,
      1,
      'Tiene que haber UN solo lugar donde la app crea un aviso (el de prueba). Si aparece otro, un aviso pasaría a significar «alguien apretó un botón» en vez de «el negocio recibió plata».',
    )
  })

  test('ese alta va marcada con origen de prueba', () => {
    const desde = servicio.indexOf('export async function crearAvisoDePrueba')
    assert.notEqual(desde, -1, 'No se encontró `crearAvisoDePrueba`: si se renombró, actualizar esta guarda')
    const bloque = servicio.slice(desde, desde + 1800)
    assert.match(
      bloque,
      /origen:\s*ORIGEN_PRUEBA/,
      'El aviso creado desde la app TIENE que quedar marcado como prueba: sin la marca se confundiría con un pago real en el PDV y en el cruce del cierre.',
    )
    assert.match(
      bloque,
      /estado:\s*'disponible'/,
      'Un aviso de prueba nace disponible (como uno del puente): no se puede crear ya usado.',
    )
  })

  test('ningún otro archivo de src/ escribe en la colección de avisos', () => {
    const culpables = archivos(raizSrc)
      .filter((ruta) => !ruta.endsWith(join('services', 'yape.ts')))
      .filter((ruta) => /(addDoc|setDoc|runTransaction)\s*\(/.test(readFileSync(ruta, 'utf8')) && /PAGOS_YAPE/.test(readFileSync(ruta, 'utf8')))
    assert.deepEqual(
      culpables,
      [],
      `Solo \`services/yape.ts\` puede tocar \`tblPagosYape\`: también lo hacen ${culpables.join(', ')}`,
    )
  })

  test('borrar solo borra los de prueba', () => {
    const desde = servicio.indexOf('export async function borrarAvisosDePrueba')
    assert.notEqual(desde, -1, 'No se encontró `borrarAvisosDePrueba`')
    const bloque = servicio.slice(desde, desde + 900)
    assert.match(
      bloque,
      /where\('origen',\s*'==',\s*ORIGEN_PRUEBA\)/,
      'El borrado tiene que filtrar por origen de prueba: un aviso real es el respaldo de por qué una venta se cobró por Yape y no se borra nunca.',
    )
  })
})
