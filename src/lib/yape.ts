/**
 * Avisos de pago de Yape — **módulo puro** (sin Firebase, sin React).
 *
 * Para qué sirve: cuando el cliente yapea, el negocio recibe el aviso y el cajero tiene que
 * enterarse **en el PDV**, sin mirar el teléfono. Acá viven las reglas de cuándo un aviso
 * sirve, cuándo venció, cuándo lo está usando otro cajero y cuánto se le puede aplicar a la
 * venta. Las usan el panel del PDV (`components/PanelPagosYape.tsx`), el guardado
 * (`services/yape.ts`) y el cruce del cierre (`components/CierreCaja.tsx`): **una sola
 * implementación**, así lo que se ve y lo que se permite no pueden contradecirse.
 *
 * ## El ciclo de vida de un aviso
 *
 * ```
 *   disponible ──(un cajero aprieta «Usar»)──▶ reservado ──(la venta se guarda)──▶ usado
 *        ▲                                         │
 *        └──────────(se quita el pago / falla)─────┘      (reserva vencida: se suelta sola)
 *        │
 *        ├──(alguien aprieta «Ignorar»)──▶ ignorado
 *        └──(pasa la vigencia)───────────▶ vencido
 * ```
 *
 * 🔑 **Por qué hay una reserva y no solo un candado al final**: el aviso se toma **antes** de
 * cobrar. Si el único control fuera marcar `usado` después de guardar la venta, dos cajas
 * podrían tomar el mismo yape y la segunda se enteraría **después de haber cobrado**. La
 * reserva es transaccional en `services/yape.ts` (`reservarPagoYape`), y si el cobro no se
 * concreta se suelta (`soltarPagoYape`) o vence sola a los `RESERVA_YAPE_MINUTOS`.
 *
 * ⚠️ **Un aviso es de un monto, no de una venta**: Yape no dice a qué venta corresponde, así
 * que el sistema no puede garantizar que ese yape sea el de esta venta. El cruce real es el
 * cierre (los avisos confirmados contra los cobros por Yape del turno).
 */

import { redondear2 } from './dinero.ts'

/** Cuánto vale un aviso para usarse (se configura en **Configuración → Yape**). */
export const VIGENCIA_YAPE_MINUTOS_POR_DEFECTO = 10

/** Cuánto dura la reserva antes de soltarse sola (ver el comentario de arriba). */
export const RESERVA_YAPE_MINUTOS = 2

/** Un aviso ya usado se sigue mostrando un rato, como confirmación para el cajero. */
export const YAPE_USADO_RECIENTE_MINUTOS = 5

/** Tolerancia para comparar montos (un céntimo, igual que en `lib/pagos.ts`). */
const TOLERANCIA = 0.01

/** Lo que el negocio configura (todos opcionales: una config vieja no trae ninguno). */
export type ConfigYape = {
  /** Mostrar los avisos en el PDV (por defecto **sí**: sin avisos igual no se ve nada). */
  yapeAvisoActivo?: boolean
  /** Minutos que un aviso sirve para usarse. */
  yapeVigenciaMinutos?: number
  /** Sonar cuando llega un aviso nuevo. */
  yapeSonido?: boolean
  /** Número de Yape del negocio, para dictárselo al cliente. */
  yapeNumero?: string
}

/** Estado guardado en `tblPagosYape` (lo escribe el puente; el PDV solo lo avanza). */
export type EstadoPagoYape = 'disponible' | 'reservado' | 'usado' | 'ignorado' | 'anulado'

/** Lo que la app **interpreta** de ese estado en este momento (un vencimiento no se guarda). */
export type SituacionPagoYape =
  | 'disponible'
  | 'reservado'
  | 'usado'
  | 'ignorado'
  | 'anulado'
  | 'vencido'
  | 'desconocido'

/** Un aviso de pago, tal como lo lee la app. `fecha` en milisegundos (el service normaliza). */
export type PagoYape = {
  id: string
  /** Monto yapeado, en soles. */
  monto: number
  /** N° de operación de Yape: es la identidad del aviso (idempotencia del puente). */
  nroOperacion: string
  /** Nombre del que yapeó (Yape lo manda enmascarado: `Juan Rey*`). Se guarda tal cual. */
  pagadorNombre?: string
  pagadorCelular?: string
  /** Cuándo ocurrió el yapeo (ms). */
  fecha: number
  estado: EstadoPagoYape | string
  reservadoPor?: string
  reservadoEn?: number
  /** Ventas/comprobante donde se aplicó (se llenan al confirmar). */
  ventaId?: string
  documento?: string
  usadoPor?: string
  usadoEn?: number
  ignoradoPor?: string
  ignoradoEn?: number
  motivoIgnorado?: string
  /** De dónde salió el aviso (`puente`, `manual`): sirve para saber quién lo escribió. */
  origen?: string
}

export type OpcionesYape = {
  /** «Ahora» en ms. Se pasa explícito para poder testear (por defecto, la hora real). */
  ahora?: number
  /** Vigencia en minutos (por defecto `VIGENCIA_YAPE_MINUTOS_POR_DEFECTO`). */
  vigenciaMin?: number
  /** Duración de la reserva en minutos (por defecto `RESERVA_YAPE_MINUTOS`). */
  reservaMin?: number
}

// ─── Configuración ──────────────────────────────────────────────────────────

/** ¿Se muestran los avisos en el PDV? Ausente = sí (una config vieja no rompe nada). */
export function avisoYapeActivo(config?: ConfigYape | null): boolean {
  return config?.yapeAvisoActivo !== false
}

/** Vigencia de un aviso en minutos, con respaldo al valor por defecto. */
export function vigenciaYapeMinutos(config?: ConfigYape | null): number {
  const n = Number(config?.yapeVigenciaMinutos)
  return Number.isFinite(n) && n > 0 ? n : VIGENCIA_YAPE_MINUTOS_POR_DEFECTO
}

/** ¿Suena cuando llega un aviso nuevo? Ausente = sí. */
export function sonidoYapeActivo(config?: ConfigYape | null): boolean {
  return config?.yapeSonido !== false
}

// ─── Situación de un aviso ──────────────────────────────────────────────────

/**
 * Qué es este aviso **ahora**: si el estado guardado es `disponible` pero ya pasó la
 * vigencia, está `vencido` (no se guarda el vencimiento: se deriva, así no hace falta
 * ningún proceso que limpie la colección). Una reserva vieja vuelve a estar `disponible`.
 *
 * Un estado vacío se lee como `disponible` (es lo natural para un aviso recién llegado),
 * pero un estado **desconocido** queda en `desconocido` y **no se muestra ni se puede usar**:
 * es la forma de que un puente mal escrito se note en vez de ofrecer avisos que no se entienden.
 */
export function situacionPagoYape(pago: PagoYape, opciones: OpcionesYape = {}): SituacionPagoYape {
  const ahora = opciones.ahora ?? Date.now()
  const vigenciaMin = opciones.vigenciaMin ?? VIGENCIA_YAPE_MINUTOS_POR_DEFECTO
  const reservaMin = opciones.reservaMin ?? RESERVA_YAPE_MINUTOS
  const estado = String(pago.estado ?? '').trim().toLowerCase() || 'disponible'

  if (estado === 'usado') return 'usado'
  if (estado === 'ignorado') return 'ignorado'
  if (estado === 'anulado') return 'anulado'
  if (estado === 'reservado') {
    const desde = Number(pago.reservadoEn)
    // Sin fecha de reserva no se puede saber si está viva: se da por vencida (mejor que
    // dejar el aviso tomado para siempre por una reserva sin fecha que nadie va a soltar).
    if (!Number.isFinite(desde)) return 'disponible'
    return ahora - desde < reservaMin * 60000 ? 'reservado' : 'disponible'
  }
  if (estado !== 'disponible') return 'desconocido'
  return ahora - Number(pago.fecha) < vigenciaMin * 60000 ? 'disponible' : 'vencido'
}

/** ¿Está libre para usarse? (es lo que mira el botón «Usar en esta venta»). */
export function estaDisponible(pago: PagoYape, opciones: OpcionesYape = {}): boolean {
  return situacionPagoYape(pago, opciones) === 'disponible'
}

/** Minutos que le quedan de vigencia (0 si ya venció). Para el «vence en 7 min». */
export function minutosRestantesYape(pago: PagoYape, opciones: OpcionesYape = {}): number {
  const ahora = opciones.ahora ?? Date.now()
  const vigenciaMin = opciones.vigenciaMin ?? VIGENCIA_YAPE_MINUTOS_POR_DEFECTO
  const vence = Number(pago.fecha) + vigenciaMin * 60000
  return Math.max(0, Math.ceil((vence - ahora) / 60000))
}

/** ¿El monto del aviso es exactamente el total de la venta? (se destaca en el panel). */
export function coincideConTotal(pago: PagoYape, total: number): boolean {
  const t = Number(total) || 0
  if (t <= 0) return false
  return Math.abs((Number(pago.monto) || 0) - t) < TOLERANCIA
}

/**
 * Cuánto de este aviso se puede aplicar a la venta, y si se puede.
 *
 * Los medios electrónicos **no pueden superar el total** (no existe «vuelto por Yape», ver
 * `lib/pagos.ts`), así que un aviso por más plata que la venta se aplica **topeado** y se
 * avisa: el resto queda a favor del cliente en el celular, no en el cajón.
 */
export function aplicarYapeEnVenta(
  pago: PagoYape,
  total: number,
): { ok: boolean; monto: number; motivo?: string; aviso?: string } {
  const t = redondear2(Math.max(0, Number(total) || 0))
  const monto = redondear2(Math.max(0, Number(pago.monto) || 0))
  if (t <= 0) return { ok: false, monto: 0, motivo: 'Agregá productos al carrito antes de aplicar el aviso.' }
  if (monto <= 0) return { ok: false, monto: 0, motivo: 'El aviso no tiene monto: revisá el correo o el puente.' }
  if (monto > t + TOLERANCIA) {
    return {
      ok: true,
      monto: t,
      aviso: `El aviso es por ${textoMonto(monto)} y la venta es ${textoMonto(t)}: se aplican ${textoMonto(t)}. Los ${textoMonto(redondear2(monto - t))} de más quedan a favor del cliente (Yape no da vuelto).`,
    }
  }
  return { ok: true, monto }
}

/** N° de operación con el que se guarda el pago de la venta (queda en `pagos[].operacion`). */
export function operacionDePagoYape(pago: PagoYape): string {
  const nro = String(pago.nroOperacion ?? '').trim()
  return nro || pago.id
}

// ─── Listas para la UI ──────────────────────────────────────────────────────

/** Orden de la lista: primero lo que se puede usar, después lo que está en uso, después lo usado. */
const ORDEN: Record<SituacionPagoYape, number> = {
  disponible: 0,
  reservado: 1,
  usado: 2,
  vencido: 3,
  ignorado: 3,
  anulado: 3,
  desconocido: 4,
}

/**
 * Avisos que el cajero tiene que ver, ordenados: los **disponibles** primero (el más nuevo
 * arriba), después los **reservados** (así se entiende por qué desapareció uno: lo está
 * usando otra caja) y por último los **usados hace poco**, como confirmación. Los vencidos,
 * ignorados, anulados y desconocidos no se muestran: el panel los resume en una línea.
 */
export function pagosYapeVisibles(pagos: readonly PagoYape[], opciones: OpcionesYape = {}): PagoYape[] {
  const ahora = opciones.ahora ?? Date.now()
  const recientes = YAPE_USADO_RECIENTE_MINUTOS * 60000
  return (pagos ?? [])
    .filter((p) => {
      if (!p) return false
      const s = situacionPagoYape(p, opciones)
      if (s === 'disponible' || s === 'reservado') return true
      if (s === 'usado') return ahora - Number(p.usadoEn ?? 0) < recientes
      return false
    })
    .sort((a, b) => {
      const oa = ORDEN[situacionPagoYape(a, opciones)] ?? 9
      const ob = ORDEN[situacionPagoYape(b, opciones)] ?? 9
      if (oa !== ob) return oa - ob
      return Number(b.fecha) - Number(a.fecha)
    })
}

/** Cuántos avisos hay en cada situación (encabezado del panel y cruce del cierre). */
export type ResumenYape = {
  disponibles: number
  reservados: number
  usados: number
  ignorados: number
  vencidos: number
  /** Estados que la app no entiende: si hay, el puente está escribiendo otra cosa. */
  desconocidos: number
  montoDisponible: number
}

export function resumenYape(pagos: readonly PagoYape[], opciones: OpcionesYape = {}): ResumenYape {
  const r: ResumenYape = {
    disponibles: 0,
    reservados: 0,
    usados: 0,
    ignorados: 0,
    vencidos: 0,
    desconocidos: 0,
    montoDisponible: 0,
  }
  for (const p of pagos ?? []) {
    if (!p) continue
    switch (situacionPagoYape(p, opciones)) {
      case 'disponible':
        r.disponibles++
        r.montoDisponible = redondear2(r.montoDisponible + (Number(p.monto) || 0))
        break
      case 'reservado':
        r.reservados++
        break
      case 'usado':
        r.usados++
        break
      case 'ignorado':
      case 'anulado':
        r.ignorados++
        break
      case 'vencido':
        r.vencidos++
        break
      default:
        r.desconocidos++
    }
  }
  return r
}

// ─── Cruce del cierre ───────────────────────────────────────────────────────

/**
 * Avisos **confirmados** en un turno (los que se usaron entre la apertura y ahora): es lo que
 * el sistema puede afirmar que entró por Yape con un aviso detrás.
 *
 * Se filtra por `usadoEn` (cuándo se aplicó a la venta) y no por `fecha` (cuándo yapeó el
 * cliente) para que el aviso caiga en el turno que lo cobró, igual que la venta.
 */
export function pagosYapeDeTurno(
  pagos: readonly PagoYape[],
  { desde, hasta }: { desde: number; hasta?: number },
): PagoYape[] {
  const fin = hasta ?? Date.now()
  return (pagos ?? []).filter(
    (p) =>
      p &&
      String(p.estado ?? '').trim().toLowerCase() === 'usado' &&
      Number(p.usadoEn) >= desde &&
      Number(p.usadoEn) <= fin,
  )
}

export function totalYape(pagos: readonly PagoYape[]): number {
  return redondear2((pagos ?? []).reduce((acc, p) => acc + (Number(p?.monto) || 0), 0))
}

// ─── Textos ─────────────────────────────────────────────────────────────────

/** `S/ 25.00` (el mismo formato que usa toda la app). */
export function textoMonto(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`
}

/** «hace 3 min» — hace cuánto yapeó el cliente. */
export function haceCuantoYape(fecha: number, ahora: number = Date.now()): string {
  const min = Math.floor(Math.max(0, ahora - Number(fecha)) / 60000)
  if (min < 1) return 'hace menos de 1 min'
  if (min < 60) return `hace ${min} min`
  const hrs = Math.floor(min / 60)
  return `hace ${hrs} h ${min % 60} min`
}

/** Texto de una línea del aviso, para el panel y el cierre. */
export function etiquetaYape(pago: PagoYape): string {
  const partes = [textoMonto(pago.monto)]
  const nombre = String(pago.pagadorNombre ?? '').trim()
  if (nombre) partes.push(nombre)
  const nro = String(pago.nroOperacion ?? '').trim()
  if (nro) partes.push(`op. ${nro}`)
  return partes.join(' · ')
}
