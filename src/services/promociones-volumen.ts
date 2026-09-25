import { collection, doc, getDocs, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

export type PromocionVolumen = {
  id?: string
  nombre: string
  tipo: '3x2' | '2da_50' | 'lleva_paga' | 'porcentaje' | 'monto_fijo'
  valor?: number
  descuento?: number
  productoIds: string[]
  activo: boolean
  fechaInicio?: string
  fechaFin?: string
  notas?: string
  creadoEn?: string
}

/** Guarda una promoción de volumen (crear o editar). */
export async function guardarPromocionVolumen(promo: Omit<PromocionVolumen, 'id'> & { id?: string }): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    if (!promo.nombre.trim()) return { success: false, error: 'El nombre es obligatorio.' }
    if (promo.productoIds.length === 0) return { success: false, error: 'Selecciona al menos un producto.' }

    if (promo.id) {
      await updateDoc(doc(db, COL.PROMOCIONES_VOLUMEN, promo.id), promo as Record<string, unknown>)
      return { success: true, id: promo.id }
    }

    const ref = doc(collection(db, COL.PROMOCIONES_VOLUMEN))
    await setDoc(ref, { ...promo, creadoEn: new Date().toISOString() })
    return { success: true, id: ref.id }
  } catch (e) {
    console.error('❌ Error guardando promoción de volumen:', e)
    return { success: false, error: (e as Error).message }
  }
}

/** Elimina una promoción de volumen. */
export async function eliminarPromocionVolumen(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COL.PROMOCIONES_VOLUMEN, id))
    return true
  } catch (e) {
    console.error('❌ Error eliminando promoción:', e)
    return false
  }
}

/** Lista todas las promociones de volumen activas. */
export async function listarPromocionesVolumen(): Promise<PromocionVolumen[]> {
  try {
    const snap = await getDocs(collection(db, COL.PROMOCIONES_VOLUMEN))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as PromocionVolumen))
  } catch {
    return []
  }
}

/** Obtiene promociones de volumen aplicables a un conjunto de productos. */
export function promocionesAplicables(
  todas: PromocionVolumen[],
  productoIdsEnCarrito: string[],
): PromocionVolumen[] {
  const ahora = new Date()
  return todas.filter((p) => {
    if (!p.activo) return false
    if (p.fechaInicio && new Date(p.fechaInicio) > ahora) return false
    if (p.fechaFin && new Date(p.fechaFin) < ahora) return false
    return p.productoIds.some((pid) => productoIdsEnCarrito.includes(pid))
  })
}
