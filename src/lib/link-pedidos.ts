/**
 * **El link de pedidos y su catálogo público** — módulo puro.
 *
 * 🔑 **Qué resuelve**: que el catálogo que ve el cliente **no quede viejo**. La primera versión publicaba un
 * archivo (`public/catalogo.json`) que había que regenerar a mano en cada deploy; ahora el app **publica el
 * catálogo en Firestore** (`tblPublico/catalogo`) cada vez que cambia el stock o la config —como mucho una vez
 * cada `INTERVALO_PUBLICACION_MS`— y el link lo lee **en vivo** desde ahí. El archivo queda como **respaldo**
 * (si el link no puede leer la base, muestra la última foto que se desplegó).
 *
 * ⚠️ **Una sola fuente para el link**: el dominio, la ruta, el nombre del documento y el texto que se comparte
 * viven acá. Si algún día hay dominio propio, se cambia `ORIGEN_APP` y nada más.
 *
 * ⚠️ **El documento guarda el catálogo como TEXTO JSON** (campo `datos`), no como campos de Firestore: así el
 * link lo lee con **una sola petición REST** y no hay que escribir a mano un decodificador de tipos de
 * Firestore (que es justo donde se cuelan los errores).
 *
 * Módulo puro (sin Firebase ni React): se prueba con el runner nativo de Node (`npm test`).
 */

import type { CatalogoPublico } from './pedido-publico.ts'

/** El dominio del app (Firebase Hosting). Si algún día hay dominio propio, se cambia SOLO acá. */
export const ORIGEN_APP = 'https://appadm-b359e.web.app'

/** La ruta pública del link de pedidos. */
export const RUTA_PEDIDO = '/pedido'

/** Dónde vive el catálogo publicado (una colección aparte, con permiso de **solo lectura** para el link). */
export const COLECCION_PUBLICO = 'tblPublico'
export const DOC_CATALOGO = 'catalogo'

/**
 * Cada cuánto se **como mucho** se republica el catálogo. Con esto, un día de ventas mantiene el link al día sin
 * escribir la base en cada venta (una venta cambia el stock, pero no hace falta que el link lo sepa al segundo:
 * el pedido igual lo confirma el negocio).
 */
export const INTERVALO_PUBLICACION_MS = 5 * 60 * 1000

/** El link que se comparte con los clientes. */
export function linkPedido(origen: string = ORIGEN_APP): string {
  const base = String(origen || ORIGEN_APP).replace(/\/+$/, '')
  return `${base}${RUTA_PEDIDO}`
}

/**
 * **El WhatsApp del negocio, listo para `wa.me`**: solo dígitos y con código de país. Un móvil peruano de 9
 * dígitos (empieza con `9`) es `51…`; si ya viene con código, se respeta. Es la misma regla que usa el
 * publicador del catálogo, para que el link y el mensaje de compartir no puedan discrepar.
 */
export function whatsappDeNegocio(telefono?: string): string {
  const d = String(telefono ?? '').replace(/\D/g, '')
  if (!d) return ''
  if (d.length === 9 && d.startsWith('9')) return `51${d}`
  return d
}

/** El texto listo para pegar en el estado de WhatsApp (o donde sea). */
export function mensajeParaCompartir(link: string = linkPedido(), negocio?: string): string {
  const quien = String(negocio ?? '').trim()
  const encabezado = quien ? `*${quien}* — pide aquí` : 'Pide aquí'
  return `${encabezado} 👉 ${link}`
}

/** El enlace de WhatsApp para compartir ese texto (sin número: abre el selector de contacto). */
export function urlCompartirWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(String(texto ?? ''))}`
}

/**
 * **Cuándo republicar**: la primera vez siempre, después solo si pasó el intervalo. `ultima` en `0` significa
 * «nunca se publicó».
 */
export function debePublicar(ultimaMs: number, ahoraMs: number, intervaloMs: number = INTERVALO_PUBLICACION_MS): boolean {
  const ultima = Number(ultimaMs) || 0
  if (ultima <= 0) return true
  const intervalo = Number(intervaloMs) > 0 ? Number(intervaloMs) : INTERVALO_PUBLICACION_MS
  return Number(ahoraMs) - ultima >= intervalo
}

/** Lo que se guarda en Firestore: el catálogo **como texto** (una sola lectura para el link). */
export type CatalogoEmpaquetado = { datos: string }

export function empaquetarCatalogo(catalogo: CatalogoPublico): CatalogoEmpaquetado {
  return { datos: JSON.stringify(catalogo) }
}

/**
 * **La lectura del link**, a partir de la respuesta REST de Firestore
 * (`fields.datos.stringValue`). Devuelve `null` —nunca basura— si el documento no está, si el texto no es JSON o
 * si el catálogo viene **vacío**: en ese caso el link usa el archivo de respaldo.
 */
export function desempaquetarCatalogo(respuesta: unknown): CatalogoPublico | null {
  const datos = (respuesta as { fields?: { datos?: { stringValue?: string } } })?.fields?.datos?.stringValue
  if (typeof datos !== 'string' || !datos.trim()) return null
  try {
    const c = JSON.parse(datos) as CatalogoPublico
    if (!c || !Array.isArray(c.items) || c.items.length === 0) return null
    return c
  } catch {
    return null
  }
}

/**
 * La URL REST del catálogo publicado (la que baja el link, **sin sesión**: la regla de esa colección permite
 * leerla). Se arma acá, en un módulo puro, para poder probarla.
 *
 * `emulador` (opcional) apunta al **emulador local** cuando se mide sin tocar producción: ahí no hace falta la
 * clave y la ruta es la del emulador. Es el mismo criterio que usa `lib/firebase.ts` para conectarse al
 * emulador en desarrollo.
 */
export function urlCatalogoPublico({
  projectId,
  apiKey,
  emulador,
}: {
  projectId?: string
  apiKey?: string
  emulador?: string
}): string {
  const p = String(projectId ?? '').trim()
  if (!p) return ''
  const ruta = `projects/${encodeURIComponent(p)}/databases/(default)/documents/${COLECCION_PUBLICO}/${DOC_CATALOGO}`
  const base = String(emulador ?? '').replace(/\/+$/, '')
  if (base) return `${base}/v1/${ruta}`
  const k = String(apiKey ?? '').trim()
  if (!k) return ''
  return `https://firestore.googleapis.com/v1/${ruta}?key=${encodeURIComponent(k)}`
}

/** `hace 3 min`, `hace 2 h`, `hace 4 días` — para que el negocio vea que la publicación está viva. */
export function haceCuanto(desdeMs: number, ahoraMs: number): string {
  const desde = Number(desdeMs) || 0
  if (desde <= 0) return 'todavía no se publicó'
  const seg = Math.max(0, Math.round((Number(ahoraMs) - desde) / 1000))
  if (seg < 60) return `hace ${seg} s`
  const min = Math.floor(seg / 60)
  if (min < 60) return `hace ${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return dias === 1 ? 'hace 1 día' : `hace ${dias} días`
}
