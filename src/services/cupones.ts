import { collection, doc, getDocs, setDoc, updateDoc, query, where, increment } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

export type Cupon = {
  id?: string
  codigo: string
  tipo: 'porcentaje' | 'monto'
  valor: number
  fechaInicio?: string
  fechaFin?: string
  usoMaximo?: number
  usosRealizados?: number
  activo: boolean
  notas?: string
  creadoEn?: string
  creadoPor?: string
}

/** Normaliza un código de cupón para comparación case-insensitive. */
function normCodigo(c: string): string {
  return c.trim().toUpperCase()
}

/** Valida si un cupón es usable y devuelve sus datos. */
export async function validarCupon(codigo: string): Promise<{ success: boolean; cupon?: Cupon; error?: string }> {
  const cod = normCodigo(codigo)
  if (!cod) return { success: false, error: 'Ingresa un código de cupón.' }

  try {
    const q = query(collection(db, COL.CUPONES), where('codigo', '==', cod))
    const snap = await getDocs(q)
    if (snap.empty) return { success: false, error: 'Cupón no encontrado.' }

    const docSnap = snap.docs[0]
    const data = docSnap.data() as Omit<Cupon, 'id'>
    const cupon: Cupon = { id: docSnap.id, ...data }

    if (!cupon.activo) return { success: false, error: 'Este cupón está desactivado.' }

    if (cupon.fechaInicio) {
      const inicio = new Date(cupon.fechaInicio)
      if (new Date() < inicio) return { success: false, error: 'Este cupón aún no es válido.' }
    }
    if (cupon.fechaFin) {
      const fin = new Date(cupon.fechaFin)
      fin.setHours(23, 59, 59, 999)
      if (new Date() > fin) return { success: false, error: 'Este cupón ya expiró.' }
    }

    if ((cupon.usoMaximo ?? 0) > 0 && (cupon.usosRealizados ?? 0) >= cupon.usoMaximo!) {
      return { success: false, error: 'Este cupón ya alcanzó su límite de uso.' }
    }

    return { success: true, cupon }
  } catch (e) {
    console.error('❌ Error validando cupón:', e)
    return { success: false, error: 'Error al validar el cupón.' }
  }
}

/** Registra el uso de un cupón (incrementa contador). Llamar después de confirmar la venta. */
export async function registrarUsoCupon(cuponId: string): Promise<void> {
  try {
    const ref = doc(db, COL.CUPONES, cuponId)
    await updateDoc(ref, { usosRealizados: increment(1) })
  } catch (e) {
    console.error('❌ Error registrando uso de cupón:', e)
  }
}

/** Guarda un cupón (crear o editar). */
export async function guardarCupon(cupon: Omit<Cupon, 'id'> & { id?: string }): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const cod = normCodigo(cupon.codigo)
    if (!cod) return { success: false, error: 'El código es obligatorio.' }
    if (cupon.valor <= 0) return { success: false, error: 'El valor debe ser mayor a 0.' }
    if (cupon.tipo === 'porcentaje' && cupon.valor > 100) return { success: false, error: 'El porcentaje no puede superar 100.' }

    if (cupon.id) {
      await updateDoc(doc(db, COL.CUPONES, cupon.id), { ...cupon, codigo: cod })
      return { success: true, id: cupon.id }
    }

    // Verificar que no exista otro con el mismo código
    const q = query(collection(db, COL.CUPONES), where('codigo', '==', cod))
    const snap = await getDocs(q)
    if (!snap.empty) return { success: false, error: 'Ya existe un cupón con ese código.' }

    const ref = doc(collection(db, COL.CUPONES))
    await setDoc(ref, { ...cupon, codigo: cod, usosRealizados: 0, creadoEn: new Date().toISOString() })
    return { success: true, id: ref.id }
  } catch (e) {
    console.error('❌ Error guardando cupón:', e)
    return { success: false, error: (e as Error).message }
  }
}

/** Elimina un cupón. */
export async function eliminarCupon(id: string): Promise<boolean> {
  try {
    const { deleteDoc } = await import('firebase/firestore')
    await deleteDoc(doc(db, COL.CUPONES, id))
    return true
  } catch (e) {
    console.error('❌ Error eliminando cupón:', e)
    return false
  }
}

/** Lista todos los cupones. */
export async function listarCupones(): Promise<Cupon[]> {
  try {
    const snap = await getDocs(collection(db, COL.CUPONES))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Cupon))
  } catch {
    return []
  }
}
