import { addDoc, collection, getDocs, limit as fsLimit, orderBy, query, where, writeBatch } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { auth, db } from '@/lib/firebase'
import { crearGuardiaErrores, esRuido, normalizarError, trocearLotes, type ErrorApp } from '@/lib/errores'
import { bitacora } from '@/lib/bitacora'
import { huellaDeError, textoDeBitacora } from '@/lib/observabilidad'

/**
 * Registro de errores de la app web (`tblErrores`).
 *
 * Antes los errores solo iban a `console.error`: en producción —sobre todo desde
 * el celular— nadie los veía. Ahora se guardan acá y se revisan en
 * **Auditoría → Errores** (el detalle) y **Auditoría → Observabilidad** (el panorama agrupado).
 *
 * Reglas:
 * - **Nunca lanza**: un fallo al registrar errores no puede romper una venta ni
 *   dejar la pantalla en blanco (por eso todo va envuelto y se avisa por consola).
 * - **No inunda**: la guardia de `lib/errores.ts` limita por ventana y descarta
 *   repetidos (si algo falla en bucle, se registra una vez).
 * - **Firestore aquí, no en los componentes**: la UI solo llama a `registrarError`.
 */

/** Máximo de errores que se traen para ver en Auditoría → Errores (la lista de detalle). */
export const MAX_ERRORES_UI = 100

/**
 * Tope de la ventana del panorama (`Observabilidad`). 500 documentos alcanzan de sobra para 7 días: la
 * guardia de `lib/errores.ts` registra un mismo error **una vez por minuto**, así que llegar al tope ya
 * significa que hay un problema serio (y la pantalla lo dice).
 */
export const MAX_ERRORES_PERIODO = 500

/** Máximo de operaciones por lote de Firestore. */
const TAMANO_LOTE = 500

/**
 * 🔑 **Los errores de los últimos `dias`, para el panel de Observabilidad.**
 *
 * 📌 **Por qué existe** (03/11/2026): `obtenerErrores` trae «los últimos N documentos», que es lo correcto
 * para la **lista de detalle** pero **no** para un panorama por período — y menos para dibujar una serie por
 * día. Con un contador aparte, las barras y los grupos podían no coincidir. Ahora **el panel lee esto** y de
 * acá salen los grupos **y** la serie: una sola fuente.
 *
 * ⚠️ Un solo campo con rango + `orderBy` sobre ese mismo campo ⇒ **sin índice compuesto**.
 * Devuelve además si se **truncó** en `max`, para poder decirlo en pantalla en vez de mentir con un total.
 */
export async function obtenerErroresDelPeriodo(
  dias = 7,
  max = MAX_ERRORES_PERIODO
): Promise<{ errores: ErrorApp[]; truncado: boolean }> {
  const desde = new Date()
  desde.setDate(desde.getDate() - Math.max(1, dias))
  desde.setHours(0, 0, 0, 0)
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.ERRORES),
        where('fecha', '>=', desde.toISOString()),
        orderBy('fecha', 'desc'),
        fsLimit(max)
      )
    )
    const errores = snap.docs.map((d) => ({ ...(d.data() as Omit<ErrorApp, 'id'>), id: d.id }))
    return { errores, truncado: errores.length >= max }
  } catch (e) {
    console.error('❌ No se pudieron leer los errores del período:', e)
    return { errores: [], truncado: false }
  }
}

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
    // 🔑 La bitácora se adjunta **antes** de guardar: qué estaba haciendo la persona es lo que después
    // explica el error (el `stack` solo dice dónde se rompió).
    bitacora.registrar('error', `${contexto}: ${mensaje.slice(0, 60)}`)
    const eventos = textoDeBitacora(bitacora.eventos())
    const doc: Omit<ErrorApp, 'id'> = {
      mensaje: mensaje.slice(0, 1000),
      contexto,
      fecha: new Date().toISOString(),
      usuario: user?.displayName || user?.email || 'Sin sesión',
      usuarioId: user?.uid ?? null,
      ruta: typeof window !== 'undefined' ? window.location.href.slice(0, 300) : '',
      dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : '',
      // Identidad del problema, para agrupar en Auditoría → Observabilidad sin recalcular al leer.
      huella: huellaDeError({ mensaje, contexto }),
      ...(eventos.length > 1 ? { bitacora: eventos } : {}),
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

/**
 * Borra los errores con más de `dias` días. Devuelve cuántos borró de verdad.
 *
 * El borrado va por **lotes** (máximo 500 operaciones por `writeBatch`): de a un
 * `deleteDoc` eran cientos de viajes de ida y vuelta y, si uno fallaba a mitad,
 * quedaba la limpieza a medias sin saber cuánto se borró. Si un lote falla se
 * corta y se devuelve lo ya borrado (los anteriores ya no están, informar 0
 * sería mentir).
 */
/**
 * Lo que devuelve la limpieza. 🔑 **Lleva el error adentro a propósito**: antes devolvía solo el número y
 * un `permission-denied` se traducía en **0 borrados**, que en pantalla se leía «No había errores con más
 * de 30 días» — una mentira. La regla `firestore.rules` de `tblErrores` decía `allow update, delete: if
 * false`, así que el botón **nunca pudo borrar nada** y nadie se enteró (📌 hallazgo del 03/11/2026).
 * La regla ya permite borrar a quien tiene auditoría; esto se queda como red para que un futuro cambio de
 * reglas se vea en pantalla en vez de esconderse en la consola.
 */
export type ResultadoLimpieza = { borrados: number; error: string | null }

export async function limpiarErrores(dias = 30): Promise<ResultadoLimpieza> {
  const corte = new Date()
  corte.setDate(corte.getDate() - dias)
  const limite = corte.toISOString()
  let borrados = 0
  try {
    const snap = await getDocs(collection(db, COL.ERRORES))
    const viejos = snap.docs.filter((d) => {
      const fecha = String((d.data() as { fecha?: string }).fecha || '')
      return Boolean(fecha) && fecha < limite
    })

    for (const lote of trocearLotes(viejos, TAMANO_LOTE)) {
      const batch = writeBatch(db)
      for (const d of lote) batch.delete(d.ref)
      await batch.commit()
      borrados += lote.length
    }
    return { borrados, error: null }
  } catch (e) {
    // Se devuelve el motivo para que la pantalla lo diga (un guardado bloqueado tiene que explicar por qué).
    console.error('❌ limpiarErrores:', e)
    const codigo = (e as { code?: string })?.code
    const motivo = codigo === 'permission-denied'
      ? 'Sin permiso para borrar errores (revisá el permiso de auditoría y las reglas de Firestore)'
      : (e as Error)?.message || 'No se pudieron borrar los errores'
    return { borrados, error: motivo }
  }
}
