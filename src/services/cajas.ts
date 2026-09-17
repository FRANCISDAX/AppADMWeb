import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

export type Caja = {
  id?: string
  nombre: string
  activo: boolean
  serieBoleta: string
  serieFactura: string
  seriePrefijo: string
  serieNC: string
  serieND: string
  serieNCB: string
  serieNDB: string
  createdAt?: string
  updatedAt?: string
}

export const CAJA_POR_DEFECTO: Caja = {
  nombre: '',
  activo: true,
  serieBoleta: '',
  serieFactura: '',
  seriePrefijo: '',
  serieNC: '',
  serieND: '',
  serieNCB: '',
  serieNDB: '',
}

export async function guardarCaja(caja: Caja): Promise<{ success: boolean; id?: string }> {
  try {
    if (!caja?.nombre?.trim()) return { success: false }
    const id = caja.id || caja.nombre.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')
    const data: Record<string, unknown> = {
      nombre: caja.nombre.trim(),
      activo: caja.activo !== false,
      serieBoleta: caja.serieBoleta || '',
      serieFactura: caja.serieFactura || '',
      seriePrefijo: caja.seriePrefijo || '',
      serieNC: caja.serieNC || '',
      serieND: caja.serieND || '',
      serieNCB: caja.serieNCB || '',
      serieNDB: caja.serieNDB || '',
      createdAt: caja.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await setDoc(doc(db, COL.CAJAS, id), data, { merge: true })
    return { success: true, id }
  } catch (e) {
    console.error('❌ Error guardando caja:', e)
    return { success: false }
  }
}

export async function eliminarCaja(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COL.CAJAS, id))
    return true
  } catch (e) {
    console.error('❌ Error eliminando caja:', e)
    return false
  }
}

export async function cargarCajas(): Promise<Caja[]> {
  try {
    const snap = await getDocs(collection(db, COL.CAJAS))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Caja))
  } catch (e) {
    console.error('❌ Error cargando cajas:', e)
    return []
  }
}
