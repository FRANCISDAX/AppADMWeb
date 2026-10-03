/**
 * **La exportación de datos** (`lib/exportacion.ts`).
 *
 * ⚠️ Lo que estos tests protegen es que un dato **no se pierda ni se deforme** al sacarlo del sistema:
 * que las fechas y los tipos de Firestore se vuelvan legibles, que la planilla no se vuelva inusable por
 * una foto, que el CSV se abra bien en Excel, y que la lista de colecciones no se quede corta.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  COLECCIONES_EXPORTABLES,
  aCSV,
  columnasDe,
  esFoto,
  filasDe,
  legible,
  nombreDeArchivoExportacion,
  nombreDeHoja,
  resumenDeHojas,
} from './exportacion.ts'

/** Un Timestamp como el que devuelve Firestore (tiene `toDate()`, como el real). */
const ts = (iso: string) => ({ seconds: Math.floor(new Date(iso).getTime() / 1000), toDate: () => new Date(iso) })

describe('exportacion — la lista de colecciones', () => {
  it('tiene las 26 colecciones reales del negocio, sin repetir', () => {
    assert.equal(COLECCIONES_EXPORTABLES.length, 26)
    assert.equal(new Set(COLECCIONES_EXPORTABLES).size, 26)
  })

  it('incluye las que no están en `COL` y se olvidarían fácil', () => {
    // La app móvil usa `Proveedor` SIN el prefijo `tbl`, y los XML de SUNAT y la constancia de los
    // Términos son colecciones que no están en `constants/colecciones.ts`.
    for (const c of ['Proveedor', 'sunat_archivos', 'tblAceptaciones', 'tblPublico', 'tblAuditLog']) {
      assert.ok(COLECCIONES_EXPORTABLES.includes(c), `falta ${c} en la exportación`)
    }
  })

  it('no exporta las colecciones de prueba del emulador', () => {
    assert.equal(COLECCIONES_EXPORTABLES.filter((c) => c.endsWith('_test')).length, 0)
  })
})

describe('exportacion — volver legible un dato', () => {
  it('las fechas salen en ISO, no como objeto raro', () => {
    assert.equal(legible(ts('2026-10-02T04:30:12.127Z')), '2026-10-02T04:30:12.127Z')
  })

  it('los geopuntos salen como `lat,lng`', () => {
    assert.equal(legible({ latitude: -5.19, longitude: -80.63 }), '-5.19,-80.63')
  })

  it('las referencias salen como su ruta', () => {
    assert.equal(legible({ path: 'tblProductos/0326', id: '0326', type: 'document' }), 'tblProductos/0326')
  })

  it('entiende también las marcas del respaldo (`{__tipo:…}`)', () => {
    assert.equal(legible({ __tipo: 'timestamp', valor: '2026-10-02T00:00:00.000Z' }), '2026-10-02T00:00:00.000Z')
    assert.equal(legible({ __tipo: 'geopoint', lat: 1, lng: 2 }), '1,2')
    assert.equal(legible({ __tipo: 'referencia', ruta: 'tblCajas/c1' }), 'tblCajas/c1')
  })

  it('los anidados y las listas se recorren enteros', () => {
    const doc = { venta: { total: 12.5, fecha: ts('2026-10-01T10:00:00.000Z') }, items: [{ n: 'pan', q: 2 }] }
    assert.deepEqual(legible(doc), {
      venta: { total: 12.5, fecha: '2026-10-01T10:00:00.000Z' },
      items: [{ n: 'pan', q: 2 }],
    })
  })

  it('los números quedan números (para que Excel pueda sumarlos)', () => {
    const r = legible({ total: 12.5 }) as Record<string, unknown>
    assert.equal(typeof r.total, 'number')
  })
})

describe('exportacion — la planilla no se vuelve inusable', () => {
  const foto = 'data:image/jpeg;base64,' + 'A'.repeat(5000)
  const xml = '<?xml version="1.0"?>' + 'x'.repeat(9000)

  it('detecta una foto por su contenido, no por el nombre del campo', () => {
    assert.equal(esFoto(foto), true)
    assert.equal(esFoto('WAFER NIK'), false)
  })

  it('en la planilla, la foto se cambia por una nota que dice cuánto pesa', () => {
    const r = legible({ imagen: foto }, { paraPlanilla: true }) as Record<string, string>
    assert.match(r.imagen, /foto omitida en imagen/)
    assert.ok(!r.imagen.includes('AAAA'))
  })

  it('🔑 en los DATOS la foto va completa (es la copia fiel)', () => {
    const r = legible({ imagen: foto }, { paraPlanilla: false }) as Record<string, string>
    assert.equal(r.imagen, foto)
  })

  it('un texto enorme (un XML de SUNAT) se recorta en la planilla y avisa', () => {
    const r = legible({ contenido: xml }, { paraPlanilla: true }) as Record<string, string>
    assert.match(r.contenido, /texto de \d+ KB omitido en la planilla/)
    assert.ok(r.contenido.length < 300)
  })

  it('con `conFotos` no se omite nada (es una decisión del usuario)', () => {
    const r = legible({ imagen: foto, contenido: xml }, { paraPlanilla: true, conFotos: true }) as Record<string, string>
    assert.equal(r.imagen, foto)
    assert.equal(r.contenido, xml)
  })
})

describe('exportacion — la tabla y el CSV', () => {
  const documentos = [
    { id: 'a', datos: { nombre: 'PAN', precioVenta: 1.5 } },
    { id: 'b', datos: { nombre: 'AGUA', stock: 3, categoria: 'BEBIDAS' } },
  ]

  it('las columnas son la unión de todos los documentos, con `id` primero y ordenadas', () => {
    assert.deepEqual(columnasDe(documentos), ['id', 'categoria', 'nombre', 'precioVenta', 'stock'])
  })

  it('una fila por documento y los faltantes vacíos', () => {
    const { columnas, filas } = filasDe({ coleccion: 'tblProductos', documentos }, { paraPlanilla: true })
    assert.deepEqual(columnas, ['id', 'categoria', 'nombre', 'precioVenta', 'stock'])
    assert.deepEqual(filas[0], ['a', '', 'PAN', 1.5, ''])
    // Al documento `b` le falta `precioVenta`: esa celda va vacía y `stock` queda en su columna.
    assert.deepEqual(filas[1], ['b', 'BEBIDAS', 'AGUA', '', 3])
  })

  it('el CSV usa `;` (Excel en español) y arranca con BOM (para los acentos)', () => {
    const csv = aCSV(['nombre', 'nota'], [['AGUA', 'con; punto y "comillas"']])
    assert.ok(csv.startsWith('\uFEFF'))
    assert.match(csv, /nombre;nota/)
    assert.match(csv, /AGUA;"con; punto y ""comillas"""/)
    assert.ok(csv.includes('\r\n'))
  })

  it('un objeto anidado entra como texto compacto (no rompe la fila)', () => {
    const { filas } = filasDe({ coleccion: 'x', documentos: [{ id: '1', datos: { venta: { total: 5 } } }] }, { paraPlanilla: true })
    assert.equal(filas[0][1], '{"total":5}')
  })

  it('el resumen cuenta documentos y columnas por colección', () => {
    const r = resumenDeHojas([{ coleccion: 'tblProductos', documentos }])
    assert.deepEqual(r, [{ coleccion: 'tblProductos', documentos: 2, columnas: 5 }])
  })
})

describe('exportacion — nombres de archivo y de hoja', () => {
  it('el archivo lleva el negocio y la fecha, sin acentos ni espacios', () => {
    const n = nombreDeArchivoExportacion('Bodega Ñuñoa & Cía.', new Date('2026-10-03T15:00:00Z'), 'xlsx')
    assert.equal(n, 'bodega-nunoa-cia-datos-2026-10-03.xlsx')
  })

  it('un negocio sin nombre no rompe el archivo', () => {
    assert.equal(nombreDeArchivoExportacion('', new Date('2026-10-03T15:00:00Z'), 'json'), 'negocio-datos-2026-10-03.json')
  })

  it('el nombre de la hoja respeta el límite de Excel (31) y saca los caracteres prohibidos', () => {
    assert.equal(nombreDeHoja('tblPromocionesVolumen'), 'tblPromocionesVolumen')
    assert.equal(nombreDeHoja('a/b:c*d?e[f]g'), 'a-b-c-d-e-f-g')
    assert.equal(nombreDeHoja('x'.repeat(50)).length, 31)
  })
})

/**
 * 🛡️ **Test-guarda del cableado**: el app y el script de respaldos tienen que usar **la misma regla**.
 * Si alguien escribe una segunda versión en el script (o el script deja de importar este módulo), los
 * dos archivos podrían decir cosas distintas del mismo dato — que es exactamente el error que este
 * módulo existe para evitar.
 */
describe('🛡️ el script de respaldos usa esta misma regla', () => {
  const script = readFileSync('C:/Users/aaval/appadm-backup/exportar.mjs', 'utf8')

  it('importa el módulo del app en vez de tener su propia copia', () => {
    assert.match(script, /import\(`file:\/\/\/\$\{RUTA_APP\}\/src\/lib\/exportacion\.ts`\)/)
    assert.match(script, /const \{ COLECCIONES_EXPORTABLES, aCSV, filasDe, legible/)
  })

  it('usa sus funciones y NO reimplementa el CSV ni la tabla', () => {
    assert.match(script, /aCSV\(/)
    assert.match(script, /filasDe\(/)
    assert.match(script, /legible\(/)
    // Si alguien copiara la lógica al script, esto lo frena.
    assert.ok(!/function aCSV/.test(script), 'el script no puede definir su propio aCSV')
    assert.ok(!/function filasDe/.test(script), 'el script no puede definir su propio filasDe')
  })
})
