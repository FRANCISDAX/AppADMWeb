/**
 * **Los archivos de SUNAT de un comprobante: el XML y el CDR** (03/10/2026).
 *
 * 🔑 **De dónde salen**: el envío guarda **las dos cosas dentro del propio comprobante** —`sunat.xml` y
 * `sunat.cdr`, en **base64**— así que se pueden bajar **sin tocar ninguna regla ni el backend**: la app ya
 * lee `tblDocumentos`. Medido en producción (03/10/2026): **78 comprobantes** los tienen, y de esos, **65
 * son idénticos byte a byte** al archivo que el backend guarda en `sunat_archivos`.
 *
 * - **XML** (`sunat.xml`): el comprobante electrónico (UBL Invoice) que se declaró. Es lo que pide el
 *   contador para el registro de ventas / SIRE.
 * - **CDR** (`sunat.cdr`): la **constancia de SUNAT** (`ApplicationResponse`) con su código y descripción.
 *   Es la **prueba de que aceptó** — el mismo dato que ya se ve en pantalla como `cdrCode`/`cdrDesc`.
 *
 * ⚠️ **Todo lo de este módulo es puro** (sin Firebase ni React): decodifica texto y arma nombres.
 * ⚠️ **El nombre del archivo se arma como lo hace SUNAT** (`<RUC>-<tipo>-<serie>-<correlativo>.xml` y
 * `.cdr.xml`), igual que los de `sunat_archivos`: así lo que se baja tiene el mismo nombre que el archivo
 * original y el contador lo reconoce.
 */

export type ArchivoSunat = {
  /** El nombre del archivo, como lo nombra SUNAT (es lo que espera ver el contador y Tributos). */
  nombre: string
  /** El contenido del archivo, ya como texto XML. */
  contenido: string
  /** `xml` = el comprobante declarado · `cdr` = la constancia de SUNAT. */
  clase: 'xml' | 'cdr'
}

export type DatosUbicables = {
  /** RUC del emisor (el negocio). */
  ruc?: string
  /** Código de tipo de comprobante de SUNAT: `01` factura, `03` boleta, `07` NC, `08` ND. */
  codigo?: string
  serie?: string
  numero?: number | string
}

/** Los códigos de comprobante de SUNAT (los mismos que usa el envío). */
export const CODIGOS_SUNAT: Record<string, string> = {
  FACTURA: '01',
  BOLETA: '03',
  NC: '07',
  ND: '08',
}

/**
 * El **código de SUNAT** de un comprobante. Se usa el `tipoDoc` cuando existe; si no, la **letra de la
 * serie** (`F…` factura, `B…` boleta) — que es el respaldo que ya usa el resto del sistema.
 */
export function codigoTipoSunat(tipoDoc?: string, serie?: string): string {
  const directo = CODIGOS_SUNAT[String(tipoDoc || '').toUpperCase()]
  if (directo) return directo
  const letra = String(serie || '').trim().charAt(0).toUpperCase()
  if (letra === 'F') return '01'
  if (letra === 'B') return '03'
  return ''
}

/** El correlativo con 8 dígitos, como en el nombre del archivo (`76` → `00000076`). */
const correlativo = (numero: number | string | undefined) => String(Number(numero) || 0).padStart(8, '0')

/**
 * **El nombre del archivo**, igual que el de SUNAT:
 * `10609441025-03-B001-00000076.xml` para el comprobante y `10609441025-03-B001-00000076.cdr.xml` para la constancia.
 */
export function nombreArchivoSunat(datos: DatosUbicables, clase: 'xml' | 'cdr'): string {
  const { ruc = '', codigo = '', serie = '', numero } = datos
  const base = `${ruc}-${codigo}-${serie}-${correlativo(numero)}`
  return clase === 'cdr' ? `${base}.cdr.xml` : `${base}.xml`
}

/**
 * **Base64 → texto**, funcionando en el navegador y en Node (los tests corren en Node).
 * ⚠️ Se decodifica como **UTF-8**, no como latin-1: los XML llevan nombres con acentos y ñ
 * («PIRAÑITA»), y `atob` solo no alcanza.
 */
export function decodificarBase64(base64: string): string {
  const limpio = String(base64 || '').trim()
  if (!limpio) return ''
  if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
    const bytes = Uint8Array.from(atob(limpio), (c) => c.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  }
  return Buffer.from(limpio, 'base64').toString('utf8')
}

/**
 * Los archivos que se pueden bajar de un comprobante, con su nombre correcto.
 * Devuelve solo los que **existen**: si el comprobante no fue aceptado no hay CDR, y si es una nota de
 * venta (que no va a SUNAT) no hay ninguno.
 */
export function archivosDeDocumento(doc: {
  tipoDoc?: string
  serie?: string
  numero?: number
  sunat?: { serie?: string; numero?: number; xml?: string; cdr?: string | null } | null
  /** El RUC del negocio (de la configuración). */
  ruc?: string
}): ArchivoSunat[] {
  const s = doc.sunat
  if (!s) return []
  const serie = s.serie || doc.serie || ''
  const numero = s.numero || doc.numero || 0
  const codigo = codigoTipoSunat(doc.tipoDoc, serie)
  const datos: DatosUbicables = { ruc: doc.ruc || '', codigo, serie, numero }

  const salida: ArchivoSunat[] = []
  if (typeof s.xml === 'string' && s.xml.length > 0) {
    salida.push({ clase: 'xml', nombre: nombreArchivoSunat(datos, 'xml'), contenido: decodificarBase64(s.xml) })
  }
  if (typeof s.cdr === 'string' && s.cdr.length > 0) {
    salida.push({ clase: 'cdr', nombre: nombreArchivoSunat(datos, 'cdr'), contenido: decodificarBase64(s.cdr) })
  }
  return salida
}

/** ¿El texto decodificado es de verdad un XML? (para no bajar un archivo roto sin avisar). */
export function pareceXml(contenido: string): boolean {
  const t = String(contenido || '').trimStart()
  return t.startsWith('<?xml') || t.startsWith('<')
}

/** Una descripción corta para el botón y el aviso. */
export function descripcionArchivo(a: ArchivoSunat): string {
  const kb = Math.max(1, Math.round(a.contenido.length / 1024))
  return a.clase === 'cdr' ? `CDR · constancia de SUNAT · ${kb} KB` : `XML · comprobante declarado · ${kb} KB`
}
