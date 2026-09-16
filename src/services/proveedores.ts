import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { consultarDni, consultarRuc } from '@/lib/consultaSunat'

export type ContactoProveedor = {
  nombre: string
  cargo: string
  telefono: string
  email: string
}

export type Proveedor = {
  id?: string
  nombre: string
  documento: string
  tipoDocumento: 'RUC' | 'DNI'
  direccion?: string
  telefono?: string
  correo?: string
  contactos?: ContactoProveedor[]
  notas?: string
  activo?: boolean
  fechaRegistro?: string
  updatedAt?: string
  // Nivel 2
  saldoPendiente?: number
  creditoActivo?: boolean
  limiteCredito?: number
  diasCredito?: number
}

// Consulta SUNAT y devuelve proveedor con nombre + dirección.
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

// Guarda (crea o actualiza) un proveedor.
export async function guardarProveedor(p: Proveedor): Promise<{ success: boolean; id?: string }> {
  try {
    if (!p || !p.nombre?.trim()) return { success: false }
    const id = p.id || p.documento?.trim() || p.nombre.trim().toLowerCase().replace(/\s+/g, '_')
    const data: Record<string, unknown> = {
      nombre: p.nombre.trim(),
      documento: p.documento?.trim() || '',
      tipoDocumento: p.tipoDocumento || (p.documento?.trim().length === 11 ? 'RUC' : 'DNI'),
      direccion: p.direccion || '',
      telefono: p.telefono || '',
      correo: p.correo || '',
      contactos: p.contactos || [],
      notas: p.notas || '',
      activo: p.activo !== false,
      fechaRegistro: p.fechaRegistro || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await setDoc(doc(db, COL.PROVEEDOR, id), data, { merge: true })
    return { success: true, id }
  } catch (e) {
    console.error('❌ Error guardando proveedor:', e)
    return { success: false }
  }
}

// Carga todos los proveedores.
export async function cargarProveedores(): Promise<Proveedor[]> {
  try {
    const snap = await getDocs(collection(db, COL.PROVEEDOR))
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Proveedor, 'id'>) }))
  } catch (e) {
    console.error('❌ Error cargando proveedores:', e)
    return []
  }
}

// Obtiene un proveedor por ID.
export async function obtenerProveedor(id: string): Promise<Proveedor | null> {
  try {
    const snap = await getDoc(doc(db, COL.PROVEEDOR, id))
    if (!snap.exists()) return null
    return { id: snap.id, ...(snap.data() as Omit<Proveedor, 'id'>) }
  } catch (e) {
    console.error('❌ Error obteniendo proveedor:', e)
    return null
  }
}

// Elimina un proveedor.
export async function eliminarProveedor(id: string): Promise<boolean> {
  try {
    await deleteDoc(doc(db, COL.PROVEEDOR, id))
    return true
  } catch (e) {
    console.error('❌ Error eliminando proveedor:', e)
    return false
  }
}

// Busca proveedores por nombre o documento (hasta 20 resultados).
export async function buscarProveedores(q: string): Promise<Proveedor[]> {
  try {
    const t = q.trim().toLowerCase()
    if (t.length < 1) return []
    // Firestore no soporta contains — cargamos y filtramos en cliente.
    const snap = await getDocs(collection(db, COL.PROVEEDOR))
    const results: Proveedor[] = []
    for (const d of snap.docs) {
      const data = d.data() as Omit<Proveedor, 'id'>
      const nombre = (data.nombre || '').toLowerCase()
      const doc_ = (data.documento || '').toLowerCase()
      if (nombre.includes(t) || doc_.includes(t)) {
        results.push({ id: d.id, ...data })
        if (results.length >= 20) break
      }
    }
    return results
  } catch (e) {
    console.error('❌ Error buscando proveedores:', e)
    return []
  }
}

// Actualiza un proveedor.
export async function actualizarProveedor(id: string, data: Partial<Proveedor>): Promise<boolean> {
  try {
    await setDoc(doc(db, COL.PROVEEDOR, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true })
    return true
  } catch (e) {
    console.error('❌ Error actualizando proveedor:', e)
    return false
  }
}
