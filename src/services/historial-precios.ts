import { collection, addDoc, query, where, orderBy, getDocs } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'

export type HistorialPrecio = {
  id?: string
  productoId: string
  productoNombre: string
  campo: 'precioCompra' | 'precioVenta'
  valorAnterior: number
  valorNuevo: number
  usuario: string
  fecha: string
}

export async function registrarCambioPrecio({
  productoId,
  productoNombre,
  campo,
  valorAnterior,
  valorNuevo,
  usuario = 'sistema',
}: Omit<HistorialPrecio, 'id' | 'fecha'>): Promise<void> {
  if (valorAnterior === valorNuevo) return
  try {
    await addDoc(collection(db, COL.HISTORIAL_PRECIOS), {
      productoId,
      productoNombre,
      campo,
      valorAnterior,
      valorNuevo,
      usuario,
      fecha: new Date().toISOString(),
      timestamp: Date.now(),
    })
  } catch (e) {
    console.error('❌ Error registrando cambio de precio:', e)
  }
}

export async function obtenerHistorialPrecios(productoId: string): Promise<HistorialPrecio[]> {
  try {
    const snap = await getDocs(
      query(collection(db, COL.HISTORIAL_PRECIOS), where('productoId', '==', productoId), orderBy('fecha', 'desc'))
    )
    const results: HistorialPrecio[] = []
    snap.forEach((d) => results.push({ id: d.id, ...d.data() as Omit<HistorialPrecio, 'id'> }))
    return results
  } catch (e) {
    console.error('❌ Error obteniendo historial de precios:', e)
    return []
  }
}
