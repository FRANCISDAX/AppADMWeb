/**
 * **Alertas proactivas** — Firestore (lo que ya está guardado) + las vistas del usuario.
 *
 * 🔑 **Por qué existe** (pedido del usuario, 24/09/2026): todo lo que hace falta para saber que algo
 * anda mal **ya está escrito** en la base (el latido del puente, los turnos sin cerrar, el stock, los
 * avisos de Yape, las diferencias de caja, los descuentos y las anulaciones), pero nadie lo mira. La
 * regla vive en **`lib/alertas.ts`** (puro y testeado); acá solo se **lee** y se **mapea**, y cada
 * dato sale de donde ya salía en otra pantalla — no se inventa ninguna consulta nueva:
 *
 * | Dato | De dónde |
 * |---|---|
 * | Latido del puente | `leerPuenteYape()` (`services/puente.ts`) — el mismo mapeo que usa el PDV |
 * | Turnos abiertos | `tblTurnos` con `estado == 'abierto'` (una igualdad: **sin índice compuesto**) |
 * | Turnos cerrados hoy | `tblTurnos` con `estado == 'cerrado'` + `fechaCierre >=` (índice **ya declarado**) |
 * | Documentos del día | `tblDocumentos` con `fecha >=` (un solo campo: **sin índice compuesto**) |
 * | Avisos de Yape del día | `obtenerPagosYapeDelDia()` (`services/yape.ts`) — el mismo del PDV |
 *
 * ⚠️ **Nada de esto bloquea una operación**: son avisos. La regla «informa, no bloquea» es la misma
 * que la del cruce del cierre de Yape.
 *
 * ⚠️ **Un fallo de lectura se dice**: devolver `[]` cuando la consulta se cayó haría que el tablero
 * dijera *«todo en orden»* justo cuando no sabe nada. `error` viaja hasta la pantalla.
 */
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import type { DocumentoAlerta, TurnoAlerta } from '@/lib/alertas'
import type { LatidoPuenteYape } from '@/lib/puente'
import type { PagoYape } from '@/lib/yape'
import { leerPuenteYape } from '@/services/puente'
import { obtenerPagosYapeDelDia } from '@/services/yape'

/** Todo lo que el tablero necesita, tal como sale de Firestore (el catálogo lo agrega el hook). */
export type ContextoAlertasFirestore = {
  latido: LatidoPuenteYape | null
  turnosAbiertos: TurnoAlerta[]
  turnosCerradosHoy: TurnoAlerta[]
  documentosHoy: DocumentoAlerta[]
  avisosYape: PagoYape[]
}

/**
 * Inicio del **día local** en ISO.
 *
 * ⚠️ Las fechas de los documentos y de los turnos se guardan con `toISOString()` (UTC), y los ISO se
 * comparan cronológicamente como texto: por eso se pasa la medianoche **local** ya convertida a UTC
 * y la consulta sigue siendo correcta (es el mismo criterio de `services/yape.ts`).
 */
export function inicioDelDiaISO(ahora: number = Date.now()): string {
  const d = new Date(ahora)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Un turno crudo → lo que necesita la regla. */
function aTurno(id: string, data: Record<string, unknown>): TurnoAlerta {
  return {
    id,
    usuarioNombre: String(data.usuarioNombre ?? '').trim() || undefined,
    cajaId: String(data.cajaId ?? '').trim() || undefined,
    estado: String(data.estado ?? ''),
    fechaApertura: data.fechaApertura,
    diferencia: Number(data.diferencia) || 0,
  }
}

/**
 * Un documento crudo → lo que necesita la regla.
 *
 * ⚠️ El total y el descuento viven **dentro de `venta`** (así los escribe `registrarVenta`), con
 * `importe_total` como respaldo de `total` —el mismo orden que usa `lib/pdf.ts`—. Leerlos del nivel
 * de arriba daría `0` y el aviso de descuentos nunca se dispararía.
 */
function aDocumento(id: string, data: Record<string, unknown>): DocumentoAlerta {
  const venta = (data.venta ?? {}) as Record<string, unknown>
  return {
    id,
    tipoDoc: String(data.tipoDoc ?? data.tipo ?? ''),
    serieNumero: String(data.serieNumero ?? ''),
    estado: String(data.estado ?? ''),
    cajero: String(data.cajero ?? ''),
    fecha: data.fecha,
    venta: {
      total: Number(venta.total) || 0,
      importe_total: Number(venta.importe_total ?? venta.total) || 0,
      descuentoTotal: Number(venta.descuentoTotal ?? venta.descuento_total) || 0,
    },
  }
}

/**
 * Lee todo el contexto de alertas.
 *
 * ⚠️ **Los avisos de Yape ya no se filtran acá por situación**: `lib/alertas.ts` decide qué es una
 * alerta (un `ignorado` o un `anulado` no lo son). Filtrar en la consulta exigiría un índice
 * `estado + fecha` —el mismo motivo por el que el historial filtra en memoria— y además escondería
 * los estados que el app no entiende, que son justo los que hay que ver.
 */
export async function cargarContextoAlertas(ahora: number = Date.now()): Promise<ContextoAlertasFirestore> {
  const desde = inicioDelDiaISO(ahora)
  const [latido, turnosAbiertos, turnosCerrados, documentos, avisosYape] = await Promise.all([
    leerPuenteYape(),
    getDocs(query(collection(db, COL.TURNOS), where('estado', '==', 'abierto'))),
    getDocs(
      query(collection(db, COL.TURNOS), where('estado', '==', 'cerrado'), where('fechaCierre', '>=', desde)),
    ),
    getDocs(query(collection(db, COL.DOCUMENTOS), where('fecha', '>=', desde))),
    obtenerPagosYapeDelDia(),
  ])

  return {
    latido,
    turnosAbiertos: turnosAbiertos.docs.map((d) => aTurno(d.id, d.data() as Record<string, unknown>)),
    turnosCerradosHoy: turnosCerrados.docs.map((d) => aTurno(d.id, d.data() as Record<string, unknown>)),
    documentosHoy: documentos.docs.map((d) => aDocumento(d.id, d.data() as Record<string, unknown>)),
    avisosYape,
  }
}

// ─── Posponer (por usuario) ─────────────────────────────────────────────────

/**
 * Hasta cuándo está pospuesta cada alerta, para **este** usuario.
 *
 * 🔑 Se guarda **por persona**: el dueño que ya vio que el puente se cayó y decidió ocuparse después
 * no le esconde el aviso al cajero, que es quien tiene que hacer algo al respecto.
 *
 * ⚠️ Es un documento chico y sin historial (`{ pospuestas: { id: ms } }`): no reemplaza a la
 * auditoría, solo evita que la misma alerta se muestre en cada recarga.
 */
export type VistasAlertas = { pospuestas: Record<string, number> }

/** Lo guardado por este usuario (`{ pospuestas: {} }` si todavía no pospuso nada). */
export async function cargarVistasAlertas(usuarioId: string): Promise<VistasAlertas> {
  if (!usuarioId) return { pospuestas: {} }
  try {
    const snap = await getDoc(doc(db, COL.ALERTAS_VISTAS, usuarioId))
    const datos = (snap.data() ?? {}) as Record<string, unknown>
    const crudo = (datos.pospuestas ?? {}) as Record<string, unknown>
    const pospuestas: Record<string, number> = {}
    for (const [k, v] of Object.entries(crudo)) {
      const ms = Number(v)
      if (Number.isFinite(ms) && ms > 0) pospuestas[k] = ms
    }
    return { pospuestas }
  } catch (e) {
    // No poder leer lo pospuesto no puede impedir ver las alertas: se muestran todas.
    console.warn('⚠️ No se pudieron leer las alertas pospuestas:', (e as Error).message)
    return { pospuestas: {} }
  }
}

/**
 * Posponer una alerta hasta `hasta` (ms). `hasta` en el pasado **la vuelve a mostrar** (es el botón
 * «Mostrar de nuevo»), y por eso no se borra el campo: se guarda la hora.
 */
export async function posponerAlerta(
  usuarioId: string,
  alertaId: string,
  hasta: number,
): Promise<{ success: boolean; error?: string }> {
  if (!usuarioId) return { success: false, error: 'Sesión sin usuario' }
  try {
    const ref = doc(db, COL.ALERTAS_VISTAS, usuarioId)
    const actual = await cargarVistasAlertas(usuarioId)
    await setDoc(ref, { pospuestas: { ...actual.pospuestas, [alertaId]: hasta }, actualizadoEn: new Date().toISOString() }, { merge: true })
    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
