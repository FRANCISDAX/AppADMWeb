/**
 * **Publicación del catálogo del link** (`tblPublico/catalogo`).
 *
 * 🔑 **Por qué existe**: el link lee el catálogo **en vivo** de acá, así que el stock y los precios que ve el
 * cliente son los del **último publish** y no los del último deploy. Quien publica es el app (lo llama
 * `usePublicarCatalogo()` cuando cambia el catálogo), **nunca el cliente**: el link solo lee.
 *
 * ⚠️ **La colección es aparte y de solo lectura para el link**: la regla de `tblPublico` permite `read: if true`
 * (igual que `tblDisplaySessions`, que ya existía) y `write` solo a usuarios con sesión. Nada más de la base
 * queda abierto.
 *
 * ⚠️ El catálogo se guarda **como texto JSON** en el campo `datos` (ver `lib/link-pedidos.ts`): el link lo baja
 * con una sola petición REST, sin decodificar tipos de Firestore a mano.
 */
import { doc, getDoc, setDoc } from 'firebase/firestore'

import { COLECCION_PUBLICO, DOC_CATALOGO, empaquetarCatalogo } from '@/lib/link-pedidos'
import { db } from '@/lib/firebase'
import type { CatalogoPublico } from '@/lib/pedido-publico'

/** Publica (crea o reemplaza) el catálogo que baja el link. */
export async function publicarCatalogoPublico(catalogo: CatalogoPublico): Promise<{ ok: boolean; error?: string }> {
  try {
    const { datos } = empaquetarCatalogo(catalogo)
    await setDoc(
      doc(db, COLECCION_PUBLICO, DOC_CATALOGO),
      {
        datos,
        // Datos sueltos para poder mirar el estado desde la pantalla sin bajar el catálogo entero.
        actualizado: Date.now(),
        items: catalogo.items.length,
        negocio: catalogo.negocio ?? '',
      },
      { merge: true },
    )
    return { ok: true }
  } catch (e) {
    console.error('❌ Error publicando el catálogo del link:', e)
    return { ok: false, error: 'No se pudo publicar el catálogo del link.' }
  }
}

export type EstadoCatalogoPublico = { publicado: number; items: number; negocio: string }

/** Cuándo se publicó por última vez y con cuántos productos (para que el negocio lo vea en Configuración). */
export async function estadoCatalogoPublico(): Promise<EstadoCatalogoPublico | null> {
  try {
    const snap = await getDoc(doc(db, COLECCION_PUBLICO, DOC_CATALOGO))
    if (!snap.exists()) return null
    const d = snap.data() as Record<string, unknown>
    return {
      publicado: Number(d.actualizado) || 0,
      items: Number(d.items) || 0,
      negocio: String(d.negocio ?? ''),
    }
  } catch (e) {
    console.error('❌ Error leyendo el estado del catálogo del link:', e)
    return null
  }
}
