import { addDoc, collection, deleteDoc, getDocs, limit as fsLimit, orderBy, query } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { auth, db } from '@/lib/firebase'
import { crearGuardiaErrores, esRuido, normalizarError, type ErrorApp } from '@/lib/errores'

/**
 * Registro de errores de la app web (`tblErrores`).
 *
 * Antes los errores solo iban a `console.error`: en producción —sobre todo desde
 * el celular— nadie los veía. Ahora se guardan acá y se revisan en
 * **Auditoría → Errores**.
 *
 * Reglas:
 * - **Nunca lanza**: un fallo al registrar errores no puede romper una venta ni
 *   dejar la pantalla en blanco (por eso todo va envuelto y se avisa por consola).
 * - **No inunda**: la guardia de `lib/errores.ts` limita por ventana y descarta
 *   repetidos (si algo falla en bucle, se registra una vez).
 * - **Firestore aquí, no en los componentes**: la UI solo llama a `registrarError`.
 */

/** Máximo de errores que se traen para ver en Auditoría. */
export const MAX_ERRORES_UI = 100

/** Error repetido u ola de errores: no se registra de nuevo. */
const permitido = crearGuardiaErrores()

export type { ErrorApp }

/**
 * Guarda un error. Se puede llamar sin `await`: nunca lanza.
 * El `contexto` sigue la convención de `lib/errores.ts` (`pantalla:pdv`, …).
 */
export async function registrarError(error: unknown, contexto: string, detalle?: Record<string, unknown>): Promise<void> {
  const { mensaje, stack } = normalizarError(error)
  try {
    if (esRuido(mensaje)) return
    if (!permitido(`${contexto}|${mensaje}`)) {
      console.warn(`⚠️ Ya registrado (se omite): [${contexto}] ${mensaje}`)
      return
    }
    console.error(`❌ [${contexto}]`, error)

    const user = auth.currentUser
    const doc: Omit<ErrorApp, 'id'> = {
      mensaje: mensaje.slice(0, 1000),
      contexto,
      fecha: new Date().toISOString(),
      usuario: user?.displayName || user?.email || 'Sin sesión',
      usuarioId: user?.uid ?? null,
      ruta: typeof window !== 'undefined' ? window.location.href.slice(0, 300) : '',
      dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
      ...(stack ? { stack: stack.slice(0, 3000) } : {}),
      ...(detalle ? { detalle } : {}),
    }
    await addDoc(collection(db, COL.ERRORES), doc)
  } catch (e) {
    console.warn('⚠️ No se pudo registrar el error:', e)
  }
}

/** Últimos errores registrados, del más nuevo al más viejo. */
export async function obtenerErrores(max: number = MAX_ERRORES_UI): Promise<ErrorApp[]> {
  try {
    const snap = await getDocs(query(collection(db, COL.ERRORES), orderBy('fecha', 'desc'), fsLimit(max)))
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ErrorApp, 'id'>) }))
  } catch (e) {
    console.error('❌ obtenerErrores:', e)
    return []
  }
}

/** Borra los errores con más de `dias` días. Devuelve cuántos borró. */
export async function limpiarErrores(dias = 30): Promise<number> {
  try {
    const corte = new Date()
    corte.setDate(corte.getDate() - dias)
    const limite = corte.toISOString()
    const snap = await getDocs(collection(db, COL.ERRORES))
    let borrados = 0
    for (const d of snap.docs) {
      const fecha = String((d.data() as { fecha?: string }).fecha || '')
      if (fecha && fecha < limite) {
        await deleteDoc(d.ref)
        borrados++
      }
    }
    return borrados
  } catch (e) {
    console.error('❌ limpiarErrores:', e)
    return 0
  }
}
