/**
 * **Los archivos de SUNAT (XML y CDR)** (`lib/archivos-sunat.ts`).
 *
 * ⚠️ Acá lo que importa es que **el archivo que baja el usuario sea el correcto y con el nombre correcto**:
 * un nombre mal armado, o un base64 decodificado como latin-1, mandan al contador un archivo que SUNAT (o
 * Excel) no puede leer — y eso se descubre tarde.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CODIGOS_SUNAT,
  archivosDeDocumento,
  codigoTipoSunat,
  decodificarBase64,
  descripcionArchivo,
  nombreArchivoSunat,
  pareceXml,
} from './archivos-sunat.ts'

const aca = dirname(fileURLToPath(import.meta.url))
const b64 = (texto: string) => Buffer.from(texto, 'utf8').toString('base64')

describe('archivos de SUNAT — el nombre del archivo', () => {
  it('se arma como lo nombra SUNAT (RUC-tipo-serie-correlativo)', () => {
    const datos = { ruc: '10609441025', codigo: '03', serie: 'B001', numero: 76 }
    assert.equal(nombreArchivoSunat(datos, 'xml'), '10609441025-03-B001-00000076.xml')
    assert.equal(nombreArchivoSunat(datos, 'cdr'), '10609441025-03-B001-00000076.cdr.xml')
  })

  it('el correlativo va con 8 dígitos', () => {
    assert.match(nombreArchivoSunat({ ruc: '1', codigo: '01', serie: 'F001', numero: 1 }, 'xml'), /-00000001\.xml$/)
    assert.match(nombreArchivoSunat({ ruc: '1', codigo: '01', serie: 'F001', numero: 12345 }, 'xml'), /-00012345\.xml$/)
  })

  it('el nombre que arma coincide con el que guarda el backend en `sunat_archivos`', () => {
    // Estos ids son REALES (medidos en la copia del 03/10/2026): si el nombre cambia, el archivo baja con
    // otro nombre que el que el contador (y el propio backend) espera.
    const reales = [
      '10609441025-01-F001-00000001.xml',
      '10609441025-01-F001-00000001.cdr.xml',
      '10609441025-03-B001-00000013.cdr.xml',
    ]
    assert.equal(nombreArchivoSunat({ ruc: '10609441025', codigo: '01', serie: 'F001', numero: 1 }, 'xml'), reales[0])
    assert.equal(nombreArchivoSunat({ ruc: '10609441025', codigo: '01', serie: 'F001', numero: 1 }, 'cdr'), reales[1])
    assert.equal(nombreArchivoSunat({ ruc: '10609441025', codigo: '03', serie: 'B001', numero: 13 }, 'cdr'), reales[2])
  })

  it('sin datos no inventa un nombre con `undefined`', () => {
    const n = nombreArchivoSunat({}, 'xml')
    assert.ok(!n.includes('undefined'), `el nombre salió con «undefined»: ${n}`)
    assert.match(n, /\.xml$/)
  })
})

describe('archivos de SUNAT — el código del comprobante', () => {
  it('sale del tipo del documento', () => {
    assert.equal(codigoTipoSunat('FACTURA'), '01')
    assert.equal(codigoTipoSunat('BOLETA'), '03')
    assert.equal(codigoTipoSunat('NC'), '07')
    assert.equal(codigoTipoSunat('ND'), '08')
  })

  it('si no hay tipo, sale de la letra de la serie (el respaldo del sistema)', () => {
    assert.equal(codigoTipoSunat(undefined, 'F001'), '01')
    assert.equal(codigoTipoSunat('', 'B001'), '03')
  })

  it('una nota de venta no tiene código de SUNAT', () => {
    assert.equal(codigoTipoSunat('NV', 'NV01'), '')
  })

  it('los códigos son los de SUNAT', () => {
    assert.deepEqual(CODIGOS_SUNAT, { FACTURA: '01', BOLETA: '03', NC: '07', ND: '08' })
  })
})

describe('archivos de SUNAT — decodificar el contenido', () => {
  it('devuelve el XML tal cual', () => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Invoice><ID>B001-76</ID></Invoice>'
    assert.equal(decodificarBase64(b64(xml)), xml)
  })

  it('🔑 respeta los acentos y la Ñ (no decodifica como latin-1)', () => {
    const xml = '<?xml version="1.0"?><Name>INCA KOLA PIRAÑITA · GASEOSA</Name>'
    const salida = decodificarBase64(b64(xml))
    assert.equal(salida, xml)
    assert.ok(salida.includes('PIRAÑITA'), 'la Ñ se perdió al decodificar')
  })

  it('un base64 vacío no rompe', () => {
    assert.equal(decodificarBase64(''), '')
    assert.equal(decodificarBase64(undefined as unknown as string), '')
  })

  it('reconoce lo que es XML y lo que no', () => {
    assert.equal(pareceXml('<?xml version="1.0"?>'), true)
    assert.equal(pareceXml('  \n<Invoice>'), true)
    assert.equal(pareceXml('PDF-1.4'), false)
    assert.equal(pareceXml(''), false)
  })
})

describe('archivos de SUNAT — qué se puede bajar de un comprobante', () => {
  const aceptado = {
    tipoDoc: 'BOLETA',
    serie: 'B001',
    numero: 76,
    ruc: '10609441025',
    sunat: { serie: 'B001', numero: 76, estado: 'aceptado', xml: b64('<?xml version="1.0"?><Invoice/>'), cdr: b64('<?xml version="1.0"?><ar:ApplicationResponse/>') },
  }

  it('con XML y CDR devuelve los dos, con su nombre y su clase', () => {
    const a = archivosDeDocumento(aceptado)
    assert.equal(a.length, 2)
    assert.deepEqual(a.map((x) => x.clase), ['xml', 'cdr'])
    assert.deepEqual(a.map((x) => x.nombre), ['10609441025-03-B001-00000076.xml', '10609441025-03-B001-00000076.cdr.xml'])
    assert.ok(a[0].contenido.startsWith('<?xml'))
    assert.ok(a[1].contenido.includes('ApplicationResponse'))
  })

  it('si todavía no hay CDR (no aceptado) devuelve solo el XML', () => {
    const a = archivosDeDocumento({ ...aceptado, sunat: { ...aceptado.sunat, cdr: undefined } })
    assert.deepEqual(a.map((x) => x.clase), ['xml'])
  })

  it('un comprobante sin bloque `sunat` (una nota de venta, un pedido) no ofrece nada', () => {
    assert.deepEqual(archivosDeDocumento({ tipoDoc: 'NV', serie: 'NV01', numero: 5 }), [])
    assert.deepEqual(archivosDeDocumento({ tipoDoc: 'BOLETA', sunat: null }), [])
  })

  it('un CDR en `null` (el envío no lo trajo) no se ofrece como archivo vacío', () => {
    const a = archivosDeDocumento({ ...aceptado, sunat: { ...aceptado.sunat, cdr: null } })
    assert.deepEqual(a.map((x) => x.clase), ['xml'])
  })

  it('la descripción dice qué es y cuánto pesa (para que el usuario sepa qué baja)', () => {
    const a = archivosDeDocumento(aceptado)
    assert.match(descripcionArchivo(a[0]), /XML · comprobante/)
    assert.match(descripcionArchivo(a[1]), /CDR · constancia/)
    for (const x of a) assert.match(descripcionArchivo(x), /\d+ KB/)
  })
})

/**
 * 🛡️ **Test-guarda**: el permiso tiene que ser **asignable**. Si la clave no está en un grupo de la
 * pantalla de Usuarios, el checkbox no aparece y el dueño no puede prenderlo ni apagarlo — que es
 * exactamente lo que se pidió («un permiso aparte, asignable»).
 */
describe('🛡️ el permiso «descargarXmlSunat» existe y se puede asignar', () => {
  const permisos = readFileSync(join(aca, '..', 'constants', 'permisos.ts'), 'utf8')

  it('está declarado como clave', () => {
    assert.match(permisos, /descargarXmlSunat: 'descargarXmlSunat'/)
  })

  it('está en un grupo de la pantalla de Usuarios (si no, no se puede asignar)', () => {
    // El bloque va del arranque de `MODULOS` hasta el export siguiente: cortar en el primer `]` no sirve
    // (cada grupo termina con `]` en su lista de permisos).
    const desde = permisos.indexOf('export const MODULOS')
    const bloque = permisos.slice(desde, permisos.indexOf('export const LABELS_PERMISOS'))
    assert.ok(bloque.length > 100, 'no se pudo leer el bloque de grupos')
    assert.match(bloque, /descargarXmlSunat/)
  })

  it('tiene su etiqueta para mostrarlo', () => {
    assert.match(permisos, /descargarXmlSunat: 'Descargar XML y CDR \(SUNAT\)'/)
  })

  it('el botón respeta el permiso (y no se muestra el archivo de otro)', () => {
    const componente = readFileSync(join(aca, '..', 'components', 'DescargarArchivosSunat.tsx'), 'utf8')
    assert.match(componente, /tienePermiso\('descargarXmlSunat'\)/)
    assert.match(componente, /archivosDeDocumento\(/)
    // ⚠️ Un XML con BOM al principio es inválido: el archivo tiene que salir sin BOM.
    assert.match(componente, /\{ bom: false \}/)
  })
})
