/**
 * Avisos de pago de Yape (`tblPagosYape`) — Firestore.
 *
 * ## Quién escribe qué
 *
 * 🔑 **Esta app NUNCA crea avisos**: los crea el **puente** (el que lee el aviso real: la
 * notificación del celular o, más adelante, el webhook de la pasarela). El POS solo **lee**
 * los avisos y **avanza su estado** (`disponible → reservado → usado`, o `ignorado`). Esa
 * separación es lo que hace que un aviso signifique «el negocio recibió plata» y no «alguien
 * apretó un botón».
 *
 * ## Contrato del documento que escribe el puente
 *
 * ```
 * tblPagosYape/{id}
 *   monto          number     S/ yapeados (obligatorio)
 *   nroOperacion   string     N° de operación de Yape (obligatorio: es la identidad del aviso,
 *                             el puente no debe escribir dos veces el mismo)
 *   fecha          Timestamp  cuándo ocurrió el yapeo  ⚠️ TIENE que ser un Timestamp de
 *                             Firestore (`new Date(...)` / `Timestamp.fromMillis`), no un
 *                             string: la consulta filtra por rango sobre este campo
 *   estado         string     'disponible'
 *   pagadorNombre  string     opcional, tal como lo manda Yape (enmascarado: `Johan Rey*`)
 *   pagadorCelular string     opcional, enmascarado
 *   codigoSeguridad string    opcional: el código que Yape le muestra al que PAGA (`159`), para que
 *                             el cajero lo coteje con la pantalla del cliente. ⚠️ No es la identidad
 *                             del aviso (esa es el id del documento) y puede repetirse.
 *   origen         string     opcional ('puente', 'manual'): quién lo escribió
 *   textoCrudo     string     opcional: el texto original del aviso, para auditar el parser
 * ```
 *
 * El POS agrega al usarlo: `estado`, `reservadoPor`/`reservadoEn`, `ventaId`, `documento`,
 * `usadoPor`/`usadoEn`, `ignoradoPor`/`ignoradoEn`, `motivoIgnorado`, `anuladoPor`/`anuladoEn`.
 *
 * ⚠️ **Los avisos viejos no se borran**: son el respaldo de por qué una venta se cobró por
 * Yape. La consulta **del día** trae los del día (una colección que crece para siempre se vuelve
 * lenta) y el **historial** (`Reportes → Yape`) lee un **rango** de fechas a pedido.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  where,
} from 'firebase/firestore'
import { COL } from '@/constants/colecciones'
import { db } from '@/lib/firebase'
import { logActividad } from '@/lib/audit'
import { limpiarUndefined } from '@/lib/limpio'
import {
  ORIGEN_PRUEBA,
  RESERVA_YAPE_MINUTOS,
  VIGENCIA_YAPE_MINUTOS_POR_DEFECTO,
  situacionPagoYape,
  type PagoYape,
} from '@/lib/yape'

/** Cuántos avisos del día se traen como máximo (la vigencia es de minutos: sobra). */
const LIMITE_AVISOS = 100

/** Inicio del día **local** en ms (los avisos se miran por jornada, como el resto de la app). */
function inicioDelDia(ahora: number = Date.now()): number {
  const d = new Date(ahora)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Convierte cualquier fecha que haya guardado el puente en ms.
 * ⚠️ Sin esto, un `fecha` guardado como string (o un Timestamp que no se convirtió) daría
 * `NaN` y **todos** los avisos parecerían vencidos: el parser del puente es código de otro
 * proceso y no se puede dar por hecho.
 */
function msDeFecha(valor: unknown): number {
  if (valor == null) return 0
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
  if (valor instanceof Date) return valor.getTime()
  if (typeof valor === 'string') {
    const t = Date.parse(valor)
    return Number.isFinite(t) ? t : 0
  }
  const ts = valor as { toMillis?: () => number; seconds?: number }
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  return 0
}

/** Texto recortado de un campo opcional ('' si no vino). */
function texto(valor: unknown): string {
  return String(valor ?? '').trim()
}

/** El primer campo que venga con algo: el puente puede escribir el nombre nuevo o el viejo. */
function primeraTexto(...valores: unknown[]): string {
  for (const v of valores) {
    const s = texto(v)
    if (s) return s
  }
  return ''
}

/** Documento crudo de Firestore → `PagoYape` (con los nombres nuevos y los viejos). */
function aPagoYape(id: string, data: Record<string, unknown>): PagoYape {
  const nombre = primeraTexto(data.pagadorNombre, data.pagador_nombre, data.nombrePagador)
  const celular = primeraTexto(data.pagadorCelular, data.pagador_celular, data.celularPagador)
  const codigoSeguridad = primeraTexto(data.codigoSeguridad, data.codigo_seguridad)
  const reservadoPor = texto(data.reservadoPor)
  const ventaId = texto(data.ventaId)
  const documento = texto(data.documento)
  const usadoPor = texto(data.usadoPor)
  const ignoradoPor = texto(data.ignoradoPor)
  const motivoIgnorado = texto(data.motivoIgnorado)
  const origen = texto(data.origen)
  const reservadoEn = msDeFecha(data.reservadoEn ?? data.reservado_en)
  const usadoEn = msDeFecha(data.usadoEn ?? data.usado_en)
  const ignoradoEn = msDeFecha(data.ignoradoEn ?? data.ignorado_en)
  const anuladoEn = msDeFecha(data.anuladoEn ?? data.anulado_en)
  return {
    id,
    monto: Number(data.monto) || 0,
    nroOperacion: primeraTexto(data.nroOperacion, data.nro_operacion, data.operacion),
    fecha: msDeFecha(data.fecha ?? data.fechaHora ?? data.creadoEn ?? data.createdAt),
    estado: texto(data.estado) || 'disponible',
    ...(nombre ? { pagadorNombre: nombre } : {}),
    ...(celular ? { pagadorCelular: celular } : {}),
    ...(codigoSeguridad ? { codigoSeguridad } : {}),
    ...(reservadoPor ? { reservadoPor } : {}),
    ...(reservadoEn ? { reservadoEn } : {}),
    ...(ventaId ? { ventaId } : {}),
    ...(documento ? { documento } : {}),
    ...(usadoPor ? { usadoPor } : {}),
    ...(usadoEn ? { usadoEn } : {}),
    ...(ignoradoPor ? { ignoradoPor } : {}),
    ...(ignoradoEn ? { ignoradoEn } : {}),
    ...(motivoIgnorado ? { motivoIgnorado } : {}),
    ...(anuladoEn ? { anuladoEn } : {}),
    ...(origen ? { origen } : {}),
  }
}

/** Los avisos del día, más nuevos primero. Sin `orderBy` compuesto ⇒ no necesita índice. */
function consultaDelDia() {
  return query(
    collection(db, COL.PAGOS_YAPE),
    where('fecha', '>=', new Date(inicioDelDia())),
    orderBy('fecha', 'desc'),
    fsLimit(LIMITE_AVISOS),
  )
}

/**
 * Escucha los avisos **en vivo**: el aviso que llega aparece en el PDV sin que nadie recargue,
 * y el que otra caja usa (o ignora) sale de la lista de todas. El error se avisa a quien llama
 * para que caiga a la lectura puntual: un panel congelado haría creer que no hay avisos.
 */
export function suscribirPagosYape(
  onDatos: (pagos: PagoYape[]) => void,
  onError?: (e: Error) => void,
): () => void {
  try {
    return onSnapshot(
      consultaDelDia(),
      (snap) => {
        const pagos = snap.docs.map((d) => aPagoYape(d.id, d.data() as Record<string, unknown>))
        pagos.sort((a, b) => b.fecha - a.fecha)
        onDatos(pagos)
      },
      (e) => {
        console.error('❌ Avisos de Yape:', e.message)
        onError?.(e)
      },
    )
  } catch (e) {
    console.error('❌ No se pudo escuchar los avisos de Yape:', (e as Error).message)
    onError?.(e as Error)
    return () => {}
  }
}

/** Lectura puntual de los avisos del día (respaldo cuando el canal en vivo se cae). */
export async function obtenerPagosYapeDelDia(): Promise<PagoYape[]> {
  const snap = await getDocs(consultaDelDia())
  const pagos = snap.docs.map((d) => aPagoYape(d.id, d.data() as Record<string, unknown>))
  return pagos.sort((a, b) => b.fecha - a.fecha)
}

// ─── Historial (Reportes → Yape) ────────────────────────────────────────────

/**
 * Cuántos avisos trae una lectura del historial.
 *
 * ⚠️ Al llegar al tope **hay que decirlo en pantalla** (el historial devuelve `tope: true`): un
 * rango que trae más avisos de los que se leyeron y no lo avisa hace creer que «esos no están».
 */
const LIMITE_AVISOS_HISTORIAL = 1000

/**
 * Avisos de un **rango de fechas**, los más nuevos primero (el historial de `Reportes → Yape`).
 *
 * 🔑 **Una sola consulta por rango de `fecha`** (con `orderBy` del **mismo** campo) ⇒ **no necesita
 * índice compuesto**. El filtro por situación y el buscador se hacen en memoria con
 * [`filtrarAvisosYape`]: pedir el filtro a Firestore exigiría un índice `estado + fecha` declarado
 * y **desplegado**, y si falta la consulta falla recién en producción (*«The query requires an
 * index»*). ⚠️ **No agregar acá una igualdad** (`where('estado', ...)`): si algún día hace falta,
 * va con su índice en `firestore.indexes.json` y su deploy. 🛡️ Guarda: `lib/yape-historial.test.ts`.
 *
 * ⚠️ **`error` no es lo mismo que «no hay avisos»**: quien llama tiene que distinguir un rango
 * vacío de una lectura que falló (si no, el reporte miente).
 */
export async function obtenerAvisosYapeDelRango({
  desde,
  hasta,
}: {
  desde: Date
  hasta: Date
}): Promise<{ pagos: PagoYape[]; tope: boolean; error?: string }> {
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.PAGOS_YAPE),
        where('fecha', '>=', desde),
        where('fecha', '<=', hasta),
        orderBy('fecha', 'desc'),
        fsLimit(LIMITE_AVISOS_HISTORIAL),
      ),
    )
    const pagos = snap.docs.map((d) => aPagoYape(d.id, d.data() as Record<string, unknown>))
    pagos.sort((a, b) => b.fecha - a.fecha)
    return { pagos, tope: snap.size >= LIMITE_AVISOS_HISTORIAL }
  } catch (e) {
    const error = (e as Error).message
    console.error('❌ No se pudieron leer los avisos de Yape del rango:', error)
    return { pagos: [], tope: false, error }
  }
}

// ─── El aviso de PRUEBA (la única puerta por la que la app crea un aviso) ───

/**
 * Crea un **aviso de prueba** desde `Configuración → Yape`: sirve para comprobar que el circuito
 * completo funciona (el aviso aparece en el PDV → se aplica a una venta → el cierre lo cruza)
 * **sin depender de que alguien yapee de verdad**, y para la puesta en marcha del puente.
 *
 * ⚠️ **Es la ÚNICA escritura de la app en `tblPagosYape`**, y va marcada `origen: 'prueba'`: la
 * plata **no entró**, así que el aviso se marca como PRUEBA en el panel del PDV y en el cruce del
 * cierre, y se borra con [`borrarAvisosDePrueba`]. Todo lo demás lo escribe el **puente**.
 * 🛡️ Una guarda (`lib/yape-creacion.test.ts`) falla si aparece otro camino de creación.
 */
export async function crearAvisoDePrueba({
  monto,
  usuario,
  pagadorNombre = 'PRUEBA DEL SISTEMA',
}: {
  monto: number
  usuario: string
  pagadorNombre?: string
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const limpio = Math.round((Number(monto) || 0) * 100) / 100
  if (!(limpio > 0)) return { success: false, error: 'Poné un monto mayor a 0 para el aviso de prueba.' }
  try {
    const ref = await addDoc(collection(db, COL.PAGOS_YAPE), limpiarUndefined({
      monto: limpio,
      nroOperacion: `PRUEBA-${Date.now()}`,
      pagadorNombre,
      fecha: new Date(),
      estado: 'disponible',
      origen: ORIGEN_PRUEBA,
      creadoPor: usuario,
    }))
    logActividad({
      accion: 'crear_aviso_prueba',
      entidad: COL.PAGOS_YAPE,
      entidadId: ref.id,
      detalle: { monto: limpio },
    })
    return { success: true, id: ref.id }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Borra **solo** los avisos de prueba (nunca uno real: los del puente son el respaldo de por qué
 * una venta se cobró por Yape y no se tocan). Devuelve cuántos borró de verdad.
 */
export async function borrarAvisosDePrueba(): Promise<{ success: boolean; borrados: number; error?: string }> {
  try {
    const snap = await getDocs(query(collection(db, COL.PAGOS_YAPE), where('origen', '==', ORIGEN_PRUEBA)))
    let borrados = 0
    for (const d of snap.docs) {
      await deleteDoc(d.ref)
      borrados++
    }
    if (borrados > 0) {
      logActividad({
        accion: 'borrar_avisos_prueba',
        entidad: COL.PAGOS_YAPE,
        entidadId: 'prueba',
        detalle: { borrados },
      })
    }
    return { success: true, borrados }
  } catch (e) {
    return { success: false, borrados: 0, error: (e as Error).message }
  }
}

// ─── Los tres pasos del ciclo de vida (siempre por transacción) ─────────────

type OpcionesAviso = {
  /** Minutos de vigencia configurados (se pasan desde la config: la regla es única). */
  vigenciaMin?: number
  usuario?: string
  usuarioId?: string
}

/** Lee el aviso y devuelve su situación, o lanza el error que verá el cajero. */
function exigirUsable(pago: PagoYape, opciones: OpcionesAviso, accion: 'reservar' | 'ignorar'): void {
  const situacion = situacionPagoYape(pago, {
    ahora: Date.now(),
    vigenciaMin: opciones.vigenciaMin ?? VIGENCIA_YAPE_MINUTOS_POR_DEFECTO,
    reservaMin: RESERVA_YAPE_MINUTOS,
  })
  if (situacion === 'disponible') return
  const deOtro = pago.reservadoPor ? ` por ${pago.reservadoPor}` : ''
  const mensajes: Record<string, string> = {
    usado: `Ese yape ya se usó${pago.documento ? ` en ${pago.documento}` : ''}.`,
    ignorado: 'Ese aviso fue ignorado.',
    anulado: 'Ese aviso fue anulado (la venta se anuló y la plata volvió al cliente).',
    vencido: 'Ese aviso ya venció: pedile al cliente que revise su celular o cobralo como transferencia.',
    reservado: accion === 'ignorar'
      ? `Otro cajero${deOtro} está usando ese aviso. Esperá a que termine o se libere.`
      : `Otro cajero${deOtro} tomó ese aviso primero. Refrescá la lista.`,
    desconocido: 'Ese aviso tiene un estado que el sistema no reconoce: revisá el puente de Yape.',
  }
  throw new Error(mensajes[situacion] ?? 'Ese aviso no se puede usar.')
}

/**
 * **Reserva** el aviso para esta venta (primero de los tres pasos).
 *
 * 🔑 Es el candado **anti-reuso**: se toma **antes** de cobrar, transaccionalmente, así que dos
 * cajas que vean el mismo yape no pueden aplicarlo las dos. Si el cobro no se concreta, el
 * aviso se suelta ([`soltarPagoYape`]) o vence solo a los `RESERVA_YAPE_MINUTOS`.
 */
export async function reservarPagoYape({
  pagoId,
  ...opciones
}: OpcionesAviso & { pagoId: string }): Promise<{ success: boolean; error?: string }> {
  const ref = doc(db, COL.PAGOS_YAPE, pagoId)
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Ese aviso de Yape ya no existe.')
      const pago = aPagoYape(pagoId, snap.data() as Record<string, unknown>)
      exigirUsable(pago, opciones, 'reservar')
      tx.update(ref, limpiarUndefined({
        estado: 'reservado',
        reservadoPor: opciones.usuario ?? 'sistema',
        reservadoPorId: opciones.usuarioId ?? null,
        reservadoEn: new Date(),
        reservaExpira: new Date(Date.now() + RESERVA_YAPE_MINUTOS * 60000),
      }) as Record<string, unknown>)
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * **Confirma** el aviso en la venta ya guardada (segundo paso): queda `usado`, apuntando al
 * comprobante. Es idempotente a propósito: si la confirmación se reintenta (o el cobro ya la
 * había hecho), volver a confirmar **la misma venta** no es un error.
 */
export async function confirmarPagoYapeEnVenta({
  pagoId,
  ventaId,
  documento,
  ...opciones
}: OpcionesAviso & { pagoId: string; ventaId?: string; documento?: string }): Promise<{ success: boolean; error?: string }> {
  const ref = doc(db, COL.PAGOS_YAPE, pagoId)
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Ese aviso de Yape ya no existe.')
      const pago = aPagoYape(pagoId, snap.data() as Record<string, unknown>)
      const estado = String(pago.estado).trim().toLowerCase()
      // Ya usado en ESTA venta: el reintento no es un error (idempotencia).
      if (estado === 'usado' && pago.ventaId && ventaId && pago.ventaId === ventaId) return
      if (estado === 'usado') {
        throw new Error(`Ese yape ya se usó${pago.documento ? ` en ${pago.documento}` : ''}.`)
      }
      if (estado === 'ignorado' || estado === 'anulado') {
        throw new Error('Ese aviso fue descartado: revisá el cruce de Yape en el cierre.')
      }
      // Se confirma también si la reserva ya venció (el cajero cobró igual): la venta existe y
      // no se puede deshacer, así que el aviso queda usado y el problema se ve en el cierre.
      if (estado !== 'reservado' && estado !== 'disponible') {
        throw new Error('Ese aviso tiene un estado que el sistema no reconoce.')
      }
      tx.update(ref, limpiarUndefined({
        estado: 'usado',
        ventaId: ventaId ?? null,
        documento: documento ?? null,
        usadoPor: opciones.usuario ?? 'sistema',
        usadoEn: new Date(),
        reservadoPor: null,
        reservadoEn: null,
        reservaExpira: null,
      }) as Record<string, unknown>)
    })
    logActividad({
      accion: 'usar_yape',
      entidad: COL.PAGOS_YAPE,
      entidadId: pagoId,
      detalle: { ventaId, documento },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * **Suelta** el aviso si se reservó para una venta que no se llegó a cobrar (se quitó el pago,
 * se vació el carrito, falló el cobro). Best-effort: **nunca lanza** — soltar no puede romper
 * el cobro, y si falla, la reserva vence sola.
 */
export async function soltarPagoYape({ pagoId }: { pagoId: string }): Promise<void> {
  const ref = doc(db, COL.PAGOS_YAPE, pagoId)
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) return
      const pago = aPagoYape(pagoId, snap.data() as Record<string, unknown>)
      const estado = String(pago.estado).trim().toLowerCase()
      // Solo se suelta una **reserva**: un aviso ya usado no se puede "desusar" (la venta existe).
      if (estado !== 'reservado') return
      tx.update(ref, limpiarUndefined({
        estado: 'disponible',
        reservadoPor: null,
        reservadoPorId: null,
        reservadoEn: null,
        reservaExpira: null,
      }) as Record<string, unknown>)
    })
  } catch (e) {
    console.warn('⚠️ No se pudo soltar el aviso de Yape (vence solo):', (e as Error).message)
  }
}

/** **Ignora** un aviso (el cajero ve que no corresponde a esta venta): queda con quién y por qué. */
export async function ignorarPagoYape({
  pagoId,
  motivo,
  ...opciones
}: OpcionesAviso & { pagoId: string; motivo?: string }): Promise<{ success: boolean; error?: string }> {
  const ref = doc(db, COL.PAGOS_YAPE, pagoId)
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      if (!snap.exists()) throw new Error('Ese aviso de Yape ya no existe.')
      const pago = aPagoYape(pagoId, snap.data() as Record<string, unknown>)
      const estado = String(pago.estado).trim().toLowerCase()
      if (estado === 'usado') throw new Error(`Ese yape ya se usó${pago.documento ? ` en ${pago.documento}` : ''}.`)
      if (estado === 'reservado') throw new Error('Otro cajero está usando ese aviso: no se puede ignorar.')
      if (estado === 'ignorado' || estado === 'anulado') return
      tx.update(ref, limpiarUndefined({
        estado: 'ignorado',
        ignoradoPor: opciones.usuario ?? 'sistema',
        ignoradoEn: new Date(),
        motivoIgnorado: (motivo ?? '').trim() || 'sin motivo',
      }) as Record<string, unknown>)
    })
    logActividad({
      accion: 'ignorar_yape',
      entidad: COL.PAGOS_YAPE,
      entidadId: pagoId,
      detalle: { motivo: motivo ?? '' },
    })
    return { success: true }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ─── Cruce del cierre ───────────────────────────────────────────────────────

/**
 * Avisos **confirmados** en una ventana de tiempo (el turno): es lo que el sistema puede
 * afirmar que entró por Yape con un aviso detrás, para cruzarlo contra los cobros por Yape
 * del turno. Se filtra por `usadoEn` (cuándo se aplicó a la venta), igual que la venta.
 */
export async function obtenerPagosYapeDelTurno(
  desdeIso: string | undefined,
  hastaIso?: string,
): Promise<PagoYape[]> {
  const desde = desdeIso ? new Date(desdeIso) : new Date(inicioDelDia())
  const hasta = hastaIso ? new Date(hastaIso) : new Date()
  try {
    const snap = await getDocs(
      query(
        collection(db, COL.PAGOS_YAPE),
        where('usadoEn', '>=', desde),
        orderBy('usadoEn', 'desc'),
        fsLimit(LIMITE_AVISOS),
      ),
    )
    return snap.docs
      .map((d) => aPagoYape(d.id, d.data() as Record<string, unknown>))
      .filter((p) => {
        const usado = Number(p.usadoEn) || 0
        return String(p.estado).trim().toLowerCase() === 'usado' && usado >= desde.getTime() && usado <= hasta.getTime()
      })
  } catch (e) {
    console.warn('⚠️ No se pudieron leer los avisos de Yape del turno:', (e as Error).message)
    return []
  }
}

/**
 * Marca como **anulado** el aviso que se usó en una venta que después se anuló: la plata volvió
 * al cliente, así que ese yape **no puede contar como cobro confirmado** en el cierre.
 *
 * Best-effort y **nunca lanza**: la anulación de la venta no puede fallar por esto (si falla, el
 * descuadre se ve igual en el cruce del cierre, que es para lo que está).
 */
export async function anularPagoYapeDeVenta({
  ventaId,
  motivo,
  usuario,
}: {
  ventaId: string
  motivo?: string
  usuario?: string
}): Promise<number> {
  if (!ventaId) return 0
  try {
    // Igualdad simple (sin `orderBy`) ⇒ sin índice compuesto.
    const snap = await getDocs(query(collection(db, COL.PAGOS_YAPE), where('ventaId', '==', ventaId)))
    let anulados = 0
    for (const d of snap.docs) {
      const pago = aPagoYape(d.id, d.data() as Record<string, unknown>)
      if (String(pago.estado).trim().toLowerCase() !== 'usado') continue
      const ref = doc(db, COL.PAGOS_YAPE, d.id)
      await runTransaction(db, async (tx) => {
        const actual = await tx.get(ref)
        if (!actual.exists()) return
        if (String(actual.data().estado ?? '').trim().toLowerCase() !== 'usado') return
        tx.update(ref, limpiarUndefined({
          estado: 'anulado',
          anuladoPor: usuario ?? 'sistema',
          anuladoEn: new Date(),
          motivoAnulado: (motivo ?? '').trim() || 'venta anulada',
        }) as Record<string, unknown>)
        anulados++
      })
    }
    if (anulados > 0) {
      logActividad({
        accion: 'anular_yape',
        entidad: COL.PAGOS_YAPE,
        entidadId: ventaId,
        detalle: { anulados, motivo: motivo ?? '' },
      })
    }
    return anulados
  } catch (e) {
    console.warn('⚠️ No se pudieron anular los avisos de Yape de la venta:', (e as Error).message)
    return 0
  }
}
