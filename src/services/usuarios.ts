import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { COL } from '@/constants/colecciones'
import { auth, db } from '@/lib/firebase'
import { permisosPorRol } from '@/constants/permisos'
import {
  CAMPOS_SERIE,
  type CampoSerie,
  type ConflictoSerie,
  type SerieEmpresa,
  type SerieOcupada,
  type SeriesUsuario,
  mensajeConflictos,
  seriesDeUsuario,
  seriesEmpresa,
  validarSeries,
} from '@/lib/series'

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

/** Series ya tomadas por los demás usuarios (se excluye el que se está editando). */
export async function obtenerSeriesOcupadas(excluirUid?: string): Promise<SerieOcupada[]> {
  try {
    const snap = await getDocs(collection(db, COL.USUARIO))
    return snap.docs.flatMap((d) =>
      seriesDeUsuario({ uid: d.id, ...(d.data() as Omit<Usuario, 'uid'>) }, excluirUid)
    )
  } catch (e) {
    console.error('❌ obtenerSeriesOcupadas:', e)
    return []
  }
}

/** Series configuradas a nivel empresa (globales + NC/ND) desde `tblConfiguracion/empresa`. */
export async function obtenerSeriesEmpresa(): Promise<SerieEmpresa[]> {
  try {
    const snap = await getDoc(doc(db, COL.CONFIGURACION, 'empresa'))
    return seriesEmpresa(snap.exists() ? (snap.data() as Record<string, unknown>) : {})
  } catch (e) {
    console.error('❌ obtenerSeriesEmpresa:', e)
    return seriesEmpresa({})
  }
}

/**
 * Valida las series de una caja contra las de los demás usuarios y las de la
 * empresa. Los conflictos `bloqueante: true` comparten contador de correlativos
 * y NO deben guardarse.
 */
export async function validarSeriesUsuario(
  series: SeriesUsuario,
  excluirUid?: string,
  campos?: readonly CampoSerie[]
): Promise<ConflictoSerie[]> {
  const [ocupadas, empresa] = await Promise.all([
    obtenerSeriesOcupadas(excluirUid),
    obtenerSeriesEmpresa(),
  ])
  return validarSeries({ series, ocupadas, empresa, campos })
}

function seriesDe(data: { serieBoleta?: string; serieFactura?: string; seriePrefijo?: string }): SeriesUsuario {
  const out: SeriesUsuario = {}
  for (const campo of CAMPOS_SERIE) out[campo] = data[campo] ?? ''
  return out
}

/** Devuelve el primer mensaje de error si hay conflictos bloqueantes, o `null`. */
async function errorSeries(series: SeriesUsuario, excluirUid?: string): Promise<string | null> {
  const conflictos = await validarSeriesUsuario(series, excluirUid)
  const bloqueantes = conflictos.filter((c) => c.bloqueante)
  if (bloqueantes.length === 0) return null
  return mensajeConflictos(bloqueantes)
}

export async function crearUsuario({ email, password, nombre, rol, permisos, serieBoleta, serieFactura, seriePrefijo }: { email: string; password: string; nombre: string; rol: string; permisos: Record<string, boolean>; serieBoleta?: string; serieFactura?: string; seriePrefijo?: string }) {
  try {
    const existente = await getDocs(query(collection(db, COL.USUARIO), where('email', '==', email)))
    if (!existente.empty) return { success: false, error: 'Ya existe un usuario con este email.' }

    const errorSerie = await errorSeries(seriesDe({ serieBoleta, serieFactura, seriePrefijo }))
    if (errorSerie) return { success: false, error: errorSerie }

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
    // Si se tocan series, se validan contra el resto de cajas antes de escribir.
    const tocaSeries = CAMPOS_SERIE.some((campo) => data[campo] !== undefined)
    if (tocaSeries) {
      const snap = await getDoc(doc(db, COL.USUARIO, uid))
      if (!snap.exists()) return { success: false, error: 'El usuario ya no existe.' }
      const actual = snap.data() as Usuario
      const errorSerie = await errorSeries(
        seriesDe({
          serieBoleta: data.serieBoleta ?? actual.serieBoleta,
          serieFactura: data.serieFactura ?? actual.serieFactura,
          seriePrefijo: data.seriePrefijo ?? actual.seriePrefijo,
        }),
        uid
      )
      if (errorSerie) return { success: false, error: errorSerie }
    }

    const update: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    if (data.nombre !== undefined) update.nombre = data.nombre
    if (data.rol !== undefined) update.rol = data.rol
    if (data.permisos !== undefined) update.permisos = data.permisos
    if (data.activo !== undefined) update.activo = data.activo
    if (data.serieBoleta !== undefined) update.serieBoleta = data.serieBoleta
    if (data.serieFactura !== undefined) update.serieFactura = data.serieFactura
    if (data.seriePrefijo !== undefined) update.seriePrefijo = data.seriePrefijo
    await updateDoc(doc(db, COL.USUARIO, uid), update)
    return { success: true }
  } catch (e) {
    console.error('❌ editarUsuario:', e)
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
