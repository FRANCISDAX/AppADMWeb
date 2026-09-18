import { doc as fsDoc, updateDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { limpiarUndefined } from '@/lib/limpio'
import { construirPayloadComprobante, construirPayloadNota, endpointSunat, puntoEmisionDe } from '@/lib/sunat'

const TIMEOUT_SUNAT = 60000

// Envía una NOTA de crédito/débito a SUNAT mediante la API configurada (producción) en
// Configuración → API SUNAT. Devuelve { success, message?, error?, yaAceptado? }.

// Parsea un CDR XML (ApplicationResponse de SUNAT) y lo normaliza a
// { success, cdr_code, cdr_desc, hash, xml_content }.
function parsearCdrXml(xml: string) {
  const ext = (patron: RegExp) => {
    const m = xml.match(patron)
    return m ? m[1].trim() : ''
  }
  const cdrCode = ext(/<cbc:ResponseCode[^>]*>([\s\S]*?)<\/cbc:ResponseCode>/)
  const cdrDesc = ext(/<cbc:Description[^>]*>([\s\S]*?)<\/cbc:Description>/)
  const hash =
    ext(/<digest:DigestValue[^>]*>([\s\S]*?)<\/digest:DigestValue>/i) ||
    ext(/<DigestValue[^>]*>([\s\S]*?)<\/DigestValue>/)
  const success = cdrCode === '0'
  return {
    success,
    cdr_code: cdrCode ? parseInt(cdrCode, 10) : undefined,
    cdr_desc: cdrDesc || (success ? 'Aceptado' : 'Rechazado'),
    hash: hash || null,
    xml_content: xml,
    cdr_content: xml,
  }
}

// Decodifica el XML firmado (base64) y extrae el DigestValue (hash del QR).
function extraerHashDelXmlBase64(base64Xml: string) {
  try {
    if (!base64Xml) return null
    const xml = atob(base64Xml)
    const m =
      xml.match(/<digest:DigestValue[^>]*>([\s\S]*?)<\/digest:DigestValue>/i) ||
      xml.match(/<DigestValue[^>]*>([\s\S]*?)<\/DigestValue>/)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

/**
 * Campos del CDR que se guardan en `doc.sunat`, **siempre definidos**.
 *
 * ⚠️ **La API no manda todos los campos en todas las respuestas** (`cdr_code`/`cdr_desc`/`hash`
 * pueden faltar) y **Firestore RECHAZA `undefined`**: el `updateDoc` fallaba con
 * *"Function updateDoc() called with invalid data. Unsupported field value: undefined"* y el
 * comprobante quedaba sin registrar **aunque SUNAT ya lo hubiera aceptado** (el aviso al usuario
 * era ese texto de Firestore, no el resultado del envío). Los que faltan van en `null`.
 */
function datosCdr(data: Record<string, any>, hashXml: string | null) {
  return {
    cdrCode: data.cdr_code ?? null,
    cdrDesc: data.cdr_desc ?? data.error ?? null,
    hash: hashXml ?? data.hash ?? null,
    xml: data.xml_content ?? null,
    cdr: data.cdr_content ?? null,
  }
}

// Envía un comprobante (boleta/factura) a SUNAT mediante la API configurada en
// Configuración → API SUNAT (producción). Devuelve { success, message?, error? }.
export async function enviarDocumentoASunat(
  doc: any,
  config: Record<string, any>
): Promise<{ success: boolean; message?: string; error?: string; yaAceptado?: boolean }> {
  const serie = doc.sunat?.serie || doc.serie || config.serieBoleta || 'B001'
  const numero = doc.sunat?.numero ?? doc.numero ?? doc.correlativo ?? null

  if (!numero) {
    return { success: false, error: 'El comprobante no tiene correlativo SUNAT asignado. Genera la boleta o factura nuevamente.' }
  }
  if (doc.sunat?.estado === 'aceptado') {
    return { success: false, error: 'Ya aceptado', yaAceptado: true }
  }

  // `actualizar` reescribe el objeto `sunat` completo: el punto de emisión se
  // conserva aquí para no perderlo en el primer envío.
  const sunatBase = { serie, numero, puntoEmision: puntoEmisionDe(doc, config) }
  const docRef = fsDoc(db, COL.DOCUMENTOS, doc.id)
  const actualizar = async (data: Record<string, any>, extra: Record<string, any> = {}) => {
    // `limpiarUndefined` es la red de seguridad obligatoria en el borde de escritura: Firestore
    // rechaza `undefined` y TypeScript no avisa (ver invariante de Firestore en AGENTS.md).
    await updateDoc(docRef, limpiarUndefined({ sunat: { ...data, ...extra, ultimoEnvio: new Date().toISOString() } }))
  }

  try {
    await actualizar({ ...sunatBase, estado: 'enviando' })

    const payload = construirPayloadComprobante(doc, config)
    const apiUrl = endpointSunat(config, 'invoices')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SUNAT)
    let res: Response
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const rawText = await res.text()
    let data: any = null
    try {
      data = JSON.parse(rawText)
    } catch {
      // La API devuelve el XML del CDR directo (ApplicationResponse SUNAT).
      data = parsearCdrXml(rawText)
    }

    if (data.success || data.cdr_code === 0) {
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const ok = { ...sunatBase, estado: 'aceptado', ...datosCdr(data, hashXml) }
      await actualizar(ok)
      return { success: true, message: `CDR: ${data.cdr_code || ''} - ${data.cdr_desc || 'OK'}` }
    } else if (data.cdr_code === 1033) {
      // 1033 = "El comprobante ya fue registrado" (duplicado): SUNAT YA lo tiene.
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const ok = { ...sunatBase, estado: 'aceptado', ...datosCdr(data, hashXml), cdrCode: 1033, cdrDesc: data.cdr_desc || 'Ya registrado en SUNAT (duplicado)', duplicado: true }
      await actualizar(ok)
      return { success: true, message: 'Ya estaba registrado en SUNAT (código 1033). Se marca como emitido.' }
    } else if (data.cdr_code !== undefined) {
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const rej = { ...sunatBase, estado: 'rechazado', ...datosCdr(data, hashXml), cdrDesc: data.cdr_desc || data.error || null }
      await actualizar(rej)
      return { success: false, error: data.cdr_desc || data.error || 'Error desconocido' }
    } else {
      const detalle = data.detail ? (Array.isArray(data.detail) ? data.detail.map((d: any) => d.msg).join('\n') : data.detail) : data.error || 'Error de validación'
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const errSt = { ...sunatBase, estado: 'error', ...datosCdr(data, hashXml), error: detalle }
      await actualizar(errSt)
      return { success: false, error: detalle }
    }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    const esAbort = err.name === 'AbortError' || /canceled|cancelled|aborted|request has been canceled/i.test(err.message || '')
    const msg = esAbort
      ? 'Tiempo de espera agotado. SUNAT no respondió a tiempo; el comprobante PUEDE haber sido aceptado. Reintenta para confirmar.'
      : err.message || 'Error de conexión'
    console.error('❌ Error al emitir a SUNAT:', { url: endpointSunat(config, 'invoices'), error: err.message, name: err.name, esAbort })
    // Guardar el estado de error **no puede tapar el error real**: si esta escritura también
    // falla, se avisa por consola y se devuelve igual el mensaje del envío.
    try {
      await actualizar({ ...sunatBase, estado: 'error', error: `${msg} (URL: ${endpointSunat(config, 'invoices')})` })
    } catch (e2) {
      console.warn('⚠️ No se pudo guardar el estado de error en el documento:', e2)
    }
    return { success: false, error: msg }
  }
}

// Envía una nota de crédito/débito a SUNAT mediante la API configurada (producción).
export async function enviarNotaASunat(
  doc: any,
  config: Record<string, any>
): Promise<{ success: boolean; message?: string; error?: string; yaAceptado?: boolean }> {
  const esCredito = doc.tipoDoc === 'NC'
  const tipo = esCredito ? '07' : '08'
  const serie = doc.sunat?.serie || doc.serie || (esCredito ? (config.serieBoletaNC || config.serieFacturaNC || 'BC01') : (config.serieBoletaND || config.serieFacturaND || 'BD01'))
  const numero = doc.sunat?.numero ?? doc.numero ?? null

  if (!numero) {
    return { success: false, error: 'La nota no tiene correlativo SUNAT asignado. Genera la nota nuevamente.' }
  }
  if (doc.sunat?.estado === 'aceptado') {
    return { success: false, error: 'Ya aceptado', yaAceptado: true }
  }

  const sunatBase = { tipo, serie, numero, puntoEmision: puntoEmisionDe(doc, config) }
  const docRef = fsDoc(db, COL.DOCUMENTOS, doc.id)
  const actualizar = async (data: Record<string, any>, extra: Record<string, any> = {}) => {
    // `limpiarUndefined` es la red de seguridad obligatoria en el borde de escritura: Firestore
    // rechaza `undefined` y TypeScript no avisa (ver invariante de Firestore en AGENTS.md).
    await updateDoc(docRef, limpiarUndefined({ sunat: { ...data, ...extra, ultimoEnvio: new Date().toISOString() } }))
  }

  try {
    await actualizar({ ...sunatBase, estado: 'enviando' })

    const payload = construirPayloadNota(doc, config)
    const apiUrl = endpointSunat(config, 'notes')

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_SUNAT)
    let res: Response
    try {
      res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeoutId)
    }

    const rawText = await res.text()
    let data: any = null
    try {
      data = JSON.parse(rawText)
    } catch {
      // La API devuelve el XML del CDR directo (ApplicationResponse SUNAT).
      data = parsearCdrXml(rawText)
    }

    if (data.success || data.cdr_code === 0) {
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const ok = { ...sunatBase, estado: 'aceptado', ...datosCdr(data, hashXml) }
      await actualizar(ok)
      return { success: true, message: `CDR: ${data.cdr_code || ''} - ${data.cdr_desc || 'OK'}` }
    } else if (data.cdr_code === 1033) {
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const ok = { ...sunatBase, estado: 'aceptado', ...datosCdr(data, hashXml), cdrCode: 1033, cdrDesc: data.cdr_desc || 'Ya registrado en SUNAT (duplicado)', duplicado: true }
      await actualizar(ok)
      return { success: true, message: 'Ya estaba registrado en SUNAT (código 1033). Se marca como emitido.' }
    } else if (data.cdr_code !== undefined) {
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const rej = { ...sunatBase, estado: 'rechazado', ...datosCdr(data, hashXml), cdrDesc: data.cdr_desc || data.error || null }
      await actualizar(rej)
      return { success: false, error: data.cdr_desc || data.error || 'Error desconocido' }
    } else {
      const detalle = data.detail ? (Array.isArray(data.detail) ? data.detail.map((d: any) => d.msg).join('\n') : data.detail) : data.error || 'Error de validación'
      const hashXml = extraerHashDelXmlBase64(data.xml_content)
      const errSt = { ...sunatBase, estado: 'error', ...datosCdr(data, hashXml), error: detalle }
      await actualizar(errSt)
      return { success: false, error: detalle }
    }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    const esAbort = err.name === 'AbortError' || /canceled|cancelled|aborted|request has been canceled/i.test(err.message || '')
    const msg = esAbort
      ? 'Tiempo de espera agotado. SUNAT no respondió a tiempo; la nota PUEDE haber sido aceptada. Reintenta para confirmar.'
      : err.message || 'Error de conexión'
    console.error('❌ Error al emitir nota a SUNAT:', { url: endpointSunat(config, 'notes'), error: err.message, name: err.name, esAbort })
    // Guardar el estado de error **no puede tapar el error real**: si esta escritura también
    // falla, se avisa por consola y se devuelve igual el mensaje del envío.
    try {
      await actualizar({ ...sunatBase, estado: 'error', error: `${msg} (URL: ${endpointSunat(config, 'notes')})` })
    } catch (e2) {
      console.warn('⚠️ No se pudo guardar el estado de error en el documento:', e2)
    }
    return { success: false, error: msg }
  }
}
