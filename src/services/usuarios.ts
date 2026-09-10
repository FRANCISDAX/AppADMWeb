import { collection, doc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { COL } from '@/constants/colecciones'
import { auth, db } from '@/lib/firebase'
import { permisosPorRol } from '@/constants/permisos'

export type Usuario = {
  uid: string
  email?: string
  nombre?: string
  rol?: string
  activo?: boolean
  permisos?: Record<string, boolean>
  serieBoleta?: string
  serieFactura?: string
  seriePrefijo?: string
  createdAt?: any
  updatedAt?: any
}

export async function obtenerUsuarios(): Promise<Usuario[]> {
  try {
    const snap = await getDocs(collection(db, COL.USUARIO))
    return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as Omit<Usuario, 'uid'>) }))
  } catch (e) {
    console.error('❌ obtenerUsuarios:', e)
    return []
  }
}

export async function crearUsuario({ email, password, nombre, rol, permisos, serieBoleta, serieFactura, seriePrefijo }: { email: string; password: string; nombre: string; rol: string; permisos: Record<string, boolean>; serieBoleta?: string; serieFactura?: string; seriePrefijo?: string }) {
  try {
    const existente = await getDocs(query(collection(db, COL.USUARIO), where('email', '==', email)))
    if (!existente.empty) return { success: false, error: 'Ya existe un usuario con este email.' }

    const cred = await createUserWithEmailAndPassword(auth, email, password)
    const permisosFinales = Object.keys(permisos).length ? permisos : permisosPorRol(rol)
    await setDoc(doc(db, COL.USUARIO, cred.user.uid), {
      email,
      nombre: nombre || email.split('@')[0],
      rol: rol || 'CAJERO',
      activo: true,
      permisos: permisosFinales,
      serieBoleta: serieBoleta?.trim() || '',
      serieFactura: serieFactura?.trim() || '',
      seriePrefijo: seriePrefijo?.trim() || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    return { success: true, uid: cred.user.uid }
  } catch (e) {
    const code = (e as { code?: string }).code
    const msgs: Record<string, string> = {
      'auth/email-already-in-use': 'El email ya está registrado en Firebase Auth.',
      'auth/invalid-email': 'El email no es válido.',
      'auth/weak-password': 'La contraseña es demasiado débil.',
    }
    return { success: false, error: msgs[code || ''] || 'Error al crear usuario.' }
  }
}

export async function editarUsuario(uid: string, data: Partial<{ nombre: string; rol: string; permisos: Record<string, boolean>; activo: boolean; serieBoleta: string; serieFactura: string; seriePrefijo: string }>) {
  try {
    const update: Record<string, any> = { updatedAt: new Date().toISOString() }
    if (data.nombre !== undefined) update.nombre = data.nombre
    if (data.rol !== undefined) update.rol = data.rol
    if (data.permisos !== undefined) update.permisos = data.permisos
    if (data.activo !== undefined) update.activo = data.activo
    if (data.serieBoleta !== undefined) update.serieBoleta = data.serieBoleta
    if (data.serieFactura !== undefined) update.serieFactura = data.serieFactura
    if (data.seriePrefijo !== undefined) update.seriePrefijo = data.seriePrefijo
    await updateDoc(doc(db, COL.USUARIO, uid), update)
    return { success: true }
  } catch {
    return { success: false, error: 'Error al actualizar usuario.' }
  }
}

export async function activarDesactivarUsuario(uid: string, activo: boolean) {
  try {
    await updateDoc(doc(db, COL.USUARIO, uid), { activo, updatedAt: new Date().toISOString() })
    return { success: true }
  } catch {
    return { success: false, error: 'Error al cambiar estado del usuario.' }
  }
}

// Envía email de restablecimiento (cliente). NO se puede fijar clave arbitraria desde la web.
export async function resetearPassword(email: string) {
  try {
    await sendPasswordResetEmail(auth, email)
    return { success: true }
  } catch (e) {
    const code = (e as { code?: string }).code
    const msgs: Record<string, string> = {
      'auth/invalid-email': 'El email no es válido.',
      'auth/user-not-found': 'No existe un usuario activo con este email.',
    }
    return { success: false, error: msgs[code || ''] || 'No se pudo enviar el correo de restablecimiento.' }
  }
}
