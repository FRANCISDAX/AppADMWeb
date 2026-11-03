/**
 * Las dos lecturas del **Estado del sistema** (Auditoría): el **último movimiento** de la caja y la
 * **prueba de vida de la API** de SUNAT.
 *
 * ⚠️ **No se escribe nada**: esta pantalla no crea colecciones, no guarda la prueba de la API y no
 * toca el historial. Se apoya en documentos que ya existen (`tblDocumentos`) y en un `GET` a la API.
 *
 * 🔑 **La prueba de la API no emite nada**: el camino es un `GET` a `/v1/dni` **sin el número**, así que
 * la API contesta **422** (le falta el parámetro) antes de consultar a apis.net.pe. ⚠️ No se usa
 * `GET /`: API Gateway contesta *403 Missing Authentication Token* —esa ruta no existe— y esa respuesta
 * ni siquiera trae las cabeceras de CORS, así que el navegador la vería como «no responde».
 */
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'

import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import {
  etiquetaDeDocumento,
  PING_CODIGO_ESPERADO,
  PING_RUTA,
  PING_TIMEOUT_MS,
  type PingApi,
  type UltimoMovimiento,
} from '@/lib/servicios'
import { baseDeLaApi } from '@/lib/sunat'

/**
 * **El último movimiento registrado** — una sola lectura (`orderBy('fecha')` + `limit(1)`, un campo,
 * sin índice compuesto). `fecha` es un ISO en `tblDocumentos`, así que ordena bien como texto.
 *
 * Si la consulta falla (sin permiso, sin red) devuelve `null`: la tarjeta dirá «sin datos», que es la
 * verdad, en vez de inventar una caída.
 */
export async function ultimoMovimiento(): Promise<UltimoMovimiento | null> {
  try {
    const snap = await getDocs(query(collection(db, COL.DOCUMENTOS), orderBy('fecha', 'desc'), limit(1)))
    const doc = snap.docs[0]
    if (!doc) return null
    const datos = doc.data()
    return { fecha: String(datos?.fecha ?? ''), etiqueta: etiquetaDeDocumento(datos) }
  } catch (e) {
    console.warn('⚠️ No se pudo leer el último movimiento para el estado del sistema:', e)
    return null
  }
}

/** La URL que se prueba: la base configurada (sin la ruta de emisión) + la ruta de vida. */
export function urlDePrueba(base: string): string {
  return `${baseDeLaApi(base)}${PING_RUTA}`
}

/**
 * **Prueba que la API contesta**, midiendo cuánto tardó. Nunca lanza: devuelve el resultado, porque un
 * error de red **es** el resultado que interesa (`error` + `codigo: null`).
 */
export async function probarApiSunat(base: string): Promise<PingApi> {
  const url = urlDePrueba(base)
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), PING_TIMEOUT_MS)
  const arranque = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', signal: control.signal, cache: 'no-store' })
    const latenciaMs = Date.now() - arranque
    return {
      ok: res.status === PING_CODIGO_ESPERADO,
      latenciaMs,
      codigo: res.status,
      error: null,
      cuando: Date.now(),
    }
  } catch (e) {
    const error = e as { name?: string; message?: string }
    console.warn('⚠️ La prueba de la API SUNAT falló:', url, error?.message ?? e)
    return {
      ok: false,
      latenciaMs: Date.now() - arranque,
      codigo: null,
      error:
        error?.name === 'AbortError'
          ? `No contestó en ${Math.round(PING_TIMEOUT_MS / 1000)} s`
          : 'No se pudo conectar (sin internet, URL equivocada o el origen no está permitido)',
      cuando: Date.now(),
    }
  } finally {
    clearTimeout(reloj)
  }
}
