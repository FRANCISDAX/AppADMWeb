import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { consultarDni, consultarRuc } from '@/lib/consultaSunat'

export type Proveedor = {
  id?: string
  nombre: string
  documento: string
  tipoDocumento: 'RUC' | 'DNI'
  direccion?: string
  telefono?: string
  correo?: string
  updatedAt?: string
}

// Consulta un RUC/DNI en SUNAT y devuelve un proveedor con nombre + dirección,
// o null si no se encontró (sin internet / número inválido). Port de consultarDocProveedor (RN).
export async function consultarProveedor(docu: string): Promise<Proveedor | null> {
  const id = docu.trim()
  try {
    if (id.length === 11) {
      const d = await consultarRuc(id)
      if (!d) return null
      return { nombre: (d.nombre || d.razonSocial || '').trim(), documento: id, tipoDocumento: 'RUC', direccion: (d.direccion || d.direccionCompleta || '').trim(), telefono: '', correo: '' }
    }
    if (id.length === 8) {
      const d = await consultarDni(id)
      if (!d) return null
      return { nombre: `${d.nombres || ''} ${d.apellidoPaterno || ''} ${d.apellidoMaterno || ''}`.trim(), documento: id, tipoDocumento: 'DNI', direccion: (d.direccion || '').trim(), telefono: '', correo: '' }
    }
    return null
  } catch (e) {
    console.error('❌ Error consultando proveedor desde SUNAT:', e)
    return null
  }
}

// Guarda (crea o actualiza) un proveedor en la colección `Proveedor`.
// Id = documento, o nombre normalizado si no hubo documento.
export async function guardarProveedor(p: Proveedor): Promise<{ success: boolean; id?: string }> {
  try {
    if (!p || !p.nombre?.trim()) return { success: false }
    const id = p.documento?.trim() || p.nombre.trim().toLowerCase().replace(/\s+/g, '_')
    const data = {
      nombre: p.nombre.trim(),
      documento: p.documento?.trim() || '',
      tipoDocumento: p.tipoDocumento || (p.documento?.trim().length === 11 ? 'RUC' : 'DNI'),
      direccion: p.direccion || '',
      telefono: p.telefono || '',
      correo: p.correo || '',
      updatedAt: new Date().toISOString(),
    }
    await setDoc(doc(db, COL.PROVEEDOR, id), data, { merge: true })
    return { success: true, id }
  } catch (e) {
    console.error('❌ Error guardando proveedor:', e)
    return { success: false }
  }
}

// Carga la lista de proveedores guardados (para el modo "Guardados").
export async function cargarProveedores(): Promise<Proveedor[]> {
  try {
    const snap = await getDocs(collection(db, COL.PROVEEDOR))
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Proveedor, 'id'>) }))
  } catch (e) {
    console.error('❌ Error cargando proveedores:', e)
    return []
  }
}
