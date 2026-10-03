/**
 * **Exportación de datos del negocio** — la **regla única** de cómo un dato guardado se convierte en
 * algo legible (para una planilla o para un sistema).
 *
 * 🔑 **Por qué existe**: hay **dos puertas** para sacar los datos y las dos tienen que decir lo mismo:
 *   1. **Dentro del app** (`components/ExportarDatos.tsx` + `services/exportacion.ts`): el ADMIN o el
 *      GERENTE aprietan un botón y bajan **un Excel con una hoja por colección** y el JSON completo.
 *      Es la puerta que ve el cliente (self-service) y la que hace creíble la promesa del contrato.
 *   2. **El script de respaldos** (`C:\Users\aaval\appadm-backup\exportar.mjs`): exporta **un respaldo
 *      de una fecha pasada**, sin llaves y sin navegador — sirve para auditar («¿cómo estaba el stock
 *      el 30/09?») o para entregar los datos cuando el cliente **ya no tiene acceso** al app.
 *   ⇒ Este módulo es **puro** (sin Firebase ni React) y **el script lo importa tal cual**: si la regla
 *   cambia, cambia para los dos y no pueden contradecirse.
 *
 * ⚠️ **Sin ningún `import` a propósito**: así el script del respaldo lo puede importar directo desde
 * `exportar.mjs` (Node ejecuta TypeScript), y no se puede desincronizar del app.
 *
 * ⚠️ **Dos formatos, dos criterios**:
 *   · **Planilla** (`paraPlanilla: true`): es para **mirar en Excel** ⇒ las fotos en base64 y los textos
 *     enormes (los XML de SUNAT) se cambian por una **nota** que dice cuánto se omitió. 📌 Sin esto,
 *     `tblProductos` daba 8 MB y `sunat_archivos` 17 MB: planillas que no se abren.
 *   · **Datos** (`paraPlanilla: false`): es la **copia fiel** para un sistema ⇒ va **todo**.
 */
export type DocumentoExportable = { id: string; datos: Record<string, unknown> }
export type HojaExportable = { coleccion: string; documentos: DocumentoExportable[] }
export type OpcionesExportacion = { conFotos?: boolean; paraPlanilla?: boolean }

/** A partir de acá un texto se considera «archivo adentro» (un XML de SUNAT, un logo en base64). */
export const LARGO_MAX_EN_PLANILLA = 4000

/**
 * 🔑 **Las colecciones que se exportan.** Son las que existen de verdad en la base del negocio
 * (verificado contra el manifiesto de un respaldo real: **26**). ⚠️ Al agregar una colección nueva al
 * app hay que sumarla acá, o **no se exporta** (queda afuera en silencio, que es la peor forma de
 * perder un dato). Las `*_test` del emulador **no** van: no son datos del negocio.
 */
export const COLECCIONES_EXPORTABLES: string[] = [
  'Proveedor', // ⚠️ la única sin el prefijo `tbl` (la usa la app móvil)
  'sunat_archivos', // los XML y CDR de SUNAT, guardados como binario
  'tblAceptaciones',
  'tblAlertasVistas',
  'tblAuditLog',
  'tblCajas',
  'tblCategorias',
  'tblCierresCaja',
  'tblClientes',
  'tblConfiguracion',
  'tblContadores',
  'tblDisplaySessions',
  'tblDocumentos',
  'tblEgresos',
  'tblErrores',
  'tblHistorialPrecios',
  'tblMovimientos',
  'tblPagosYape',
  'tblProductos',
  'tblPromocionesVolumen',
  'tblProveedores',
  'tblPublico',
  'tblPuenteYape',
  'tblTurnos',
  'tblUsuarios',
  'tblVoiceIntents',
]

/** El nombre corto de una colección (para el nombre del archivo o de una hoja). */
export function nombreDeHoja(coleccion: string): string {
  // ⚠️ Excel limita el nombre de una hoja a 31 caracteres y prohíbe `[]:*?/\`
  return String(coleccion).replace(/[[\]:*?/\\]/g, '-').slice(0, 31)
}

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

/**
 * Los **bytes** (los XML de SUNAT) vienen de tres formas según quién lea: `Buffer` (Node), `Uint8Array`
 * (navegador moderno) o el `Bytes` del SDK de Firestore en la web (que trae `toUint8Array()`).
 */
function bytesDe(v: unknown): Uint8Array | null {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return new Uint8Array(v as Buffer)
  if (v instanceof Uint8Array) return v
  const b = v as { toUint8Array?: () => Uint8Array }
  if (b && typeof b.toUint8Array === 'function') return b.toUint8Array()
  return null
}

/** ¿Es una foto guardada en base64? (se busca por contenido, no por el nombre del campo). */
export const esFoto = (v: string) => v.startsWith('data:image/')

/**
 * Un texto que no es XML se muestra recortado; un archivo de texto se muestra **entero** si es corto o
 * recortado con aviso si es largo. El binario que no es texto se describe por tamaño.
 */
function textoDeBytes(bytes: Uint8Array, opciones: OpcionesExportacion, campo: string): string {
  const texto = typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('utf8') : new TextDecoder().decode(bytes)
  const esTexto = /^[\t\n\r\x20-\x7e\u00a0-\uffff]*$/.test(texto.slice(0, 400))
  if (!esTexto) return `(binario de ${kb(bytes.length)})`
  if (!opciones.paraPlanilla || opciones.conFotos || texto.length <= LARGO_MAX_EN_PLANILLA) return texto
  const recorte = texto.slice(0, 200).replace(/\s+/g, ' ').trim()
  return `${recorte}… (archivo de ${kb(bytes.length)}${campo ? ` en ${campo}` : ''} — completo en el JSON y en el respaldo)`
}

/**
 * **Deja un valor legible**: deshace los tipos de Firestore (fechas, geopuntos, referencias y bytes, que
 * llegan como instancias desde el app **o** como marcas `{__tipo:…}` desde un respaldo) y, cuando es una
 * planilla, recorta lo que la volvería inusable.
 */
export function legible(v: unknown, opciones: OpcionesExportacion = {}, campo = ''): unknown {
  if (v === null || v === undefined) return null

  if (typeof v === 'string') {
    if (opciones.paraPlanilla && !opciones.conFotos) {
      if (esFoto(v)) return `(foto omitida${campo ? ` en ${campo}` : ''}: ${kb(v.length)})`
      if (v.length > LARGO_MAX_EN_PLANILLA) {
        return `(texto de ${kb(v.length)} omitido en la planilla${campo ? `: ${campo}` : ''} — está completo en el JSON y en el respaldo)`
      }
    }
    return v
  }

  if (typeof v !== 'object') return v

  const bytes = bytesDe(v)
  if (bytes) return textoDeBytes(bytes, opciones, campo)

  if (Array.isArray(v)) return v.map((x) => legible(x, opciones, campo))

  const o = v as Record<string, unknown> & {
    toDate?: () => Date
    latitude?: number
    longitude?: number
    path?: string
    type?: string
  }

  // Marcas que deja el respaldo (`{__tipo:…}`)
  if (typeof o.__tipo === 'string') {
    if (o.__tipo === 'timestamp' && typeof o.valor === 'string') return o.valor
    if (o.__tipo === 'bytes' && typeof o.base64 === 'string') {
      const b = typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(o.base64, 'base64')) : null
      return b ? textoDeBytes(b, opciones, campo) : `(binario de ${kb(o.base64.length)})`
    }
    if (o.__tipo === 'geopoint') return `${o.lat},${o.lng}`
    if (o.__tipo === 'referencia') return String(o.ruta)
  }

  // Instancias reales de Firestore
  if (typeof o.toDate === 'function') return o.toDate().toISOString()
  if (typeof o.latitude === 'number' && typeof o.longitude === 'number') return `${o.latitude},${o.longitude}`
  if (typeof o.path === 'string' && (o.type === 'document' || 'firestore' in o)) return o.path

  const salida: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) salida[k] = legible(x, opciones, k)
  return salida
}

/** Las columnas de una colección: `id` primero y el resto ordenado (así la planilla se lee igual siempre). */
export function columnasDe(documentos: DocumentoExportable[]): string[] {
  const claves = new Set<string>()
  for (const d of documentos) {
    for (const k of Object.keys(d.datos || {})) {
      // `id` es una columna propia: no se duplica si el documento ya trae un campo `id`.
      if (k !== 'id') claves.add(k)
    }
  }
  return ['id', ...[...claves].sort()]
}

/** Los tipos que Excel no entiende como objeto: se guardan como texto compacto (y `true/false` como texto). */
function celda(v: unknown): string | number {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

/** Una colección lista para la planilla: sus columnas y una fila por documento. */
export function filasDe(
  hoja: HojaExportable,
  opciones: OpcionesExportacion,
): { columnas: string[]; filas: (string | number)[][] } {
  const columnas = columnasDe(hoja.documentos)
  const filas = hoja.documentos.map((d) => {
    const legibleDoc = legible(d.datos || {}, opciones) as Record<string, unknown>
    return columnas.map((c) => (c === 'id' ? d.id : celda(legibleDoc?.[c])))
  })
  return { columnas, filas }
}

/** CSV para Excel: separador `;` (el que usa Excel en español) y **con BOM**, para que los acentos salgan bien. */
export function aCSV(columnas: string[], filas: (string | number)[][]): string {
  const escapar = (t: string) => (/[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t)
  const lineas = [columnas.map(escapar).join(';')]
  for (const fila of filas) lineas.push(fila.map((v) => escapar(String(v ?? ''))).join(';'))
  return '\uFEFF' + lineas.join('\r\n') + '\r\n'
}

/** El nombre del archivo: legible, sin acentos ni caracteres que molesten al guardarlo. */
export function nombreDeArchivoExportacion(negocio: string, fecha: Date, extension: string): string {
  const limpio = String(negocio || 'negocio')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
  const sello = fecha.toISOString().slice(0, 10)
  return `${limpio || 'negocio'}-datos-${sello}.${extension}`
}

/** El resumen que se muestra al terminar (y que va en el índice de la entrega). */
export function resumenDeHojas(hojas: HojaExportable[]): { coleccion: string; documentos: number; columnas: number }[] {
  return hojas.map((h) => ({ coleccion: h.coleccion, documentos: h.documentos.length, columnas: columnasDe(h.documentos).length }))
}
