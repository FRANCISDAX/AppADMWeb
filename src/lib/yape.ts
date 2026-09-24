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

/**
 * Marca de un aviso **de prueba**.
 *
 * 🔑 El puente escribe los avisos reales; esto es la **única** excepción: un aviso que se crea
 * desde **Configuración → Yape** para comprobar que el circuito funciona (panel → usar → cobro →
 * cruce del cierre) sin depender de que alguien yapee de verdad. ⚠️ **No es un pago**: la plata no
 * entró, así que se marca en todos lados donde aparece (panel del PDV y cruce del cierre) y se
 * puede borrar de un toque. Está fijado por una guarda: `lib/yape-creacion.test.ts`.
 */
export const ORIGEN_PRUEBA = 'prueba'

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
  /**
   * **Código de seguridad** que Yape le muestra al que paga (`El cód. de seguridad es: 159`), tal
   * como lo leyó el puente. Ver [`codigoDeSeguridadYape`].
   */
  codigoSeguridad?: string
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
 * Convierte cualquier fecha que haya guardado el puente en milisegundos.
 *
 * ⚠️ Sin esto, un `fecha` guardado como string (o un Timestamp que no se convirtió) daría `NaN` y
 * **todos** los avisos parecerían vencidos: el parser del puente es código de otro proceso y no se
 * puede dar por hecho. Lo usan `services/yape.ts` (avisos) y `services/puente.ts` (latido).
 */
export function msDeFechaYape(valor: unknown): number {
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

/** ¿Es un aviso de prueba (creado desde Configuración → Yape)? No corresponde a un pago real. */
export function esAvisoDePrueba(pago: PagoYape): boolean {
  return String(pago.origen ?? '').trim().toLowerCase() === ORIGEN_PRUEBA
}

/** ¿El monto del aviso es exactamente el total de la venta? (se destaca en el panel). */
export function coincideConTotal(pago: PagoYape, total: number): boolean {
  const t = Number(total) || 0
  if (t <= 0) return false
  return Math.abs((Number(pago.monto) || 0) - t) < TOLERANCIA
}

/** Hora local del yapeo, **con segundos**: es lo que deja cruzar «este aviso es el de mi cliente». */
export function horaDeYape(fecha: number): string {
  const d = new Date(Number(fecha) || 0)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`
}

/**
 * Otros avisos **disponibles** por el mismo monto (sin contar el propio).
 *
 * 🔑 **Por qué existe** (22/09/2026, pregunta del usuario sobre 3 cajas trabajando a la vez): con
 * varias cajas abiertas **todos ven la misma lista** de avisos — la plata entra a **una sola cuenta
 * Yape**, así que el pago no dice de qué caja es. Si dos clientes yapean lo mismo casi al mismo
 * tiempo, el monto ya no alcanza para reconocer el propio: el panel tiene que **avisarlo** para que
 * el cajero mire el N° de operación (o la hora) con el cliente delante. No es un candado: es no
 * dejar que elija a ciegas.
 */
export function avisosDelMismoMonto(
  pago: PagoYape,
  pagos: readonly PagoYape[],
  opciones: OpcionesYape = {},
): PagoYape[] {
  const monto = Number(pago?.monto) || 0
  if (monto <= 0) return []
  return (pagos ?? []).filter(
    (p) =>
      !!p &&
      p.id !== pago.id &&
      Math.abs((Number(p.monto) || 0) - monto) < TOLERANCIA &&
      situacionPagoYape(p, opciones) === 'disponible'
  )
}

/**
 * ¿Hay que confirmar antes de aplicarlo? El aviso **no coincide** con el total de la venta.
 *
 * ⚠️ **No es un candado**: aplicar un aviso por menos (pago parcial) o por más (se topea, ver
 * `aplicarYapeEnVenta`) es legítimo. Lo que hace es **frenar un segundo** al cajero para que mire
 * monto y N° de operación con el cliente delante, que es el único control real cuando varias cajas
 * ven la misma lista.
 */
export function confirmarAntesDeAplicar(pago: PagoYape, total: number): boolean {
  return !coincideConTotal(pago, total)
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

/**
 * La **referencia** con la que se guarda el pago de la venta (queda en `pagos[].operacion` y de ahí
 * sale la `referencia` del documento, el `· Op:` del ticket y el del arqueo).
 *
 * 🔑 **Qué se guarda, y por qué** (corregido el 24/09/2026 a pedido del usuario): el **N° de
 * operación** si el aviso lo trae y, si no, el **código de seguridad**.
 *
 * 📌 **Lo que estaba mal**: cuando el aviso no traía N° de operación —y **estos avisos no lo traen**,
 * verificado en el celular del negocio— se guardaba **el id del documento** (`nd_1790227037576`). Ese
 * id es interno (sirve para ubicar el aviso en `tblPagosYape`, no para una persona) y terminaba
 * impreso en el PDV, en el ticket y en el arqueo como si fuera un número de operación: el cajero veía
 * *«un garabato»*. Lo que hay que poder cotejar con el cliente es el **código de seguridad** que Yape
 * le muestra al que paga.
 * ⚠️ **No hace falta el id para nada**: el vínculo venta ↔ aviso se guarda **en el aviso**
 * (`ventaId`/`documento`, que escribe `confirmarPagoYapeEnVenta`) y por ahí lo encuentra la anulación
 * (`anularPagoYapeDeVenta` busca por `ventaId`). Ninguna regla compara ni busca por este campo.
 * ⚠️ Si el aviso no trae ni N° de operación ni código, devuelve **`''`**: el pago se guarda **sin**
 * referencia (y el ticket no imprime `· Op:`), que es más honesto que un id interno.
 */
export function operacionDePagoYape(pago: PagoYape): string {
  const nro = String(pago.nroOperacion ?? '').trim()
  if (nro) return nro
  return codigoDeSeguridadYape(pago)
}

/**
 * Qué decirle al cajero sobre **qué quedó** en el campo de referencia (`''` = no hace falta
 * explicar nada porque vino el N° de operación de verdad).
 */
export function textoOperacionYape(pago: PagoYape): string {
  if (String(pago.nroOperacion ?? '').trim()) return ''
  if (codigoDeSeguridadYape(pago).trim()) {
    return 'Código de seguridad del aviso: estos avisos no traen N° de operación'
  }
  return 'El aviso no trae N° de operación ni código de seguridad'
}

/**
 * **Código de seguridad** del aviso, tal como lo leyó el puente (`''` si no vino).
 *
 * 🔑 **Para qué está** (pedido del usuario, 22/09/2026): Yape le muestra ese número al que **paga**
 * —*«El cód. de seguridad es: 159»*— y el cliente lo dice o lo muestra; el cajero lo compara con el
 * que está en el PDV y así sabe que **ese** aviso es el de la persona que tiene delante. Es el
 * control más rápido que hay, y hace falta justamente porque **estos avisos NO traen N° de
 * operación** (verificado en el celular del negocio): sin el código, lo único que distinguía un
 * aviso de otro era el monto y el nombre, que pueden repetirse.
 *
 * ⚠️ **No es la identidad del aviso** (la identidad es el `id` del documento, que el puente arma con
 * el `postTime` de la notificación): dos clientes pueden yapear con el mismo monto y el código es de
 * 3 dígitos, así que **coincidir no alcanza como prueba** — es una ayuda para cotejar, igual que el
 * N° de operación cuando viene.
 */
export function codigoDeSeguridadYape(pago: PagoYape): string {
  return String(pago.codigoSeguridad ?? '').trim()
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

/** «hace 12 s» / «hace 3 min» — hace cuánto yapeó el cliente. Los segundos importan con varias cajas. */
export function haceCuantoYape(fecha: number, ahora: number = Date.now()): string {
  const seg = Math.floor(Math.max(0, ahora - Number(fecha)) / 1000)
  if (seg < 60) return `hace ${seg} s`
  const min = Math.floor(seg / 60)
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
  const codigo = codigoDeSeguridadYape(pago)
  if (codigo) partes.push(`cód. ${codigo}`)
  return partes.join(' · ')
}

// ─── Historial (Reportes → Yape) ─────────────────────────────────────────────

/**
 * Fecha local del yapeo `DD/MM/AAAA` (compañera de [`horaDeYape`], que da la hora con segundos).
 *
 * 🔑 **El historial muestra fecha y hora por separado** porque un rango puede cruzar varios días:
 * en el panel del PDV alcanza con la hora, pero al revisar yapes anteriores hay que poder ubicar
 * el aviso en su jornada — y con la hora vieja (`estado: 'disponible'` de anteayer) un aviso
 * parece de hoy cuando no lo es.
 */
export function fechaDeYape(fecha: number): string {
  const d = new Date(Number(fecha) || 0)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Cómo se llama cada situación en pantalla (una sola nomenclatura para el historial). */
export function etiquetaSituacionYape(situacion: SituacionPagoYape): string {
  switch (situacion) {
    case 'disponible':
      return 'Disponible'
    case 'reservado':
      return 'En uso'
    case 'usado':
      return 'Usado'
    case 'ignorado':
      return 'Ignorado'
    case 'anulado':
      return 'Anulado'
    case 'vencido':
      return 'Vencido'
    default:
      return 'No reconocido'
  }
}

/** Lo que el cajero escribió (o el sistema dedujo) sobre un aviso que no llegó a venta. */
export function detalleDeAviso(pago: PagoYape, opciones: OpcionesYape = {}): string {
  const situacion = situacionPagoYape(pago, opciones)
  if (situacion === 'ignorado') return String(pago.motivoIgnorado ?? '').trim()
  if (situacion === 'anulado') return 'la venta se anuló: la plata volvió al cliente'
  if (situacion === 'reservado') {
    const quien = String(pago.reservadoPor ?? '').trim()
    return quien ? `en uso por ${quien}` : 'en uso'
  }
  if (situacion === 'desconocido') return `estado «${String(pago.estado ?? '').trim()}»`
  return ''
}

/**
 * Todo lo que sirve para **reconocer** un aviso en el historial: pagador, celular, N° de
 * operación, comprobante, quién lo usó, motivo, origen, id y el monto en texto.
 *
 * 🔑 Buscar por **monto** (`25.00`) está a propósito: cuando el cliente reclama, lo que suele
 * decir es *«yapeé 25»*, no el número de operación.
 */
function textoBuscableDeAviso(pago: PagoYape): string {
  return [
    pago.pagadorNombre,
    pago.pagadorCelular,
    pago.nroOperacion,
    pago.documento,
    pago.ventaId,
    pago.usadoPor,
    pago.ignoradoPor,
    pago.motivoIgnorado,
    pago.reservadoPor,
    pago.origen,
    pago.id,
    (Number(pago.monto) || 0).toFixed(2),
  ]
    .map((v) => String(v ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ')
}

/** `'todos'` o una situación concreta (incluye `vencido`, que no es un estado guardado). */
export type EstadoFiltradoYape = 'todos' | SituacionPagoYape

export type FiltroAvisosYape = {
  /** Situación a mostrar (`'todos'` = sin filtro). ⚠️ Es la **situación**, no el estado guardado. */
  estado?: EstadoFiltradoYape
  /** Texto libre (pagador, N° de operación, comprobante, quién lo usó, motivo, monto). */
  texto?: string
  opciones?: OpcionesYape
}

/**
 * Filtra y ordena los avisos del historial: los más nuevos primero.
 *
 * 🔑 **El filtro se hace acá y no en Firestore**, a propósito: filtrar por estado en la consulta
 * exigiría un **índice compuesto** (`estado` + rango de `fecha`) que hay que declarar en
 * `firestore.indexes.json` **y desplegar** — y un índice que falta no se ve hasta que la consulta
 * falla en producción. El historial lee **un rango de fechas** (un solo campo ⇒ sin índice
 * compuesto) y filtra en memoria, igual que `obtenerPedidosDelMes` del reporte de pedidos.
 */
export function filtrarAvisosYape(
  pagos: readonly PagoYape[],
  filtro: FiltroAvisosYape = {},
): PagoYape[] {
  const estado = filtro.estado ?? 'todos'
  const busca = String(filtro.texto ?? '').trim().toLowerCase()
  const opciones = filtro.opciones ?? {}
  return (pagos ?? [])
    .filter((p) => !!p)
    .filter((p) => estado === 'todos' || situacionPagoYape(p, opciones) === estado)
    .filter((p) => !busca || textoBuscableDeAviso(p).includes(busca))
    .sort((a, b) => Number(b.fecha) - Number(a.fecha))
}

/** Cuántos avisos hay en cada situación dentro del rango consultado (para los contadores del filtro). */
export type ConteoAvisosYape = Record<'todos' | SituacionPagoYape, number>

export function conteoAvisosYape(
  pagos: readonly PagoYape[],
  opciones: OpcionesYape = {},
): ConteoAvisosYape {
  const c: ConteoAvisosYape = {
    todos: 0,
    disponible: 0,
    reservado: 0,
    usado: 0,
    ignorado: 0,
    anulado: 0,
    vencido: 0,
    desconocido: 0,
  }
  for (const p of pagos ?? []) {
    if (!p) continue
    c.todos++
    c[situacionPagoYape(p, opciones)]++
  }
  return c
}

/** Lo que el historial afirma del rango: cuánto entró **con un aviso detrás** y cuánto no. */
export type ResumenHistorialYape = {
  /** Avisos que entraron en el rango. */
  cantidad: number
  /** Monto de esos avisos, **sin contar los de PRUEBA** (un aviso de prueba no es plata). */
  total: number
  /** Monto de los **usados**: lo que el sistema puede afirmar que entró por Yape. */
  cobrado: number
  /** Avisos que no terminaron en una venta: ignorados, anulados o vencidos. */
  sinUsar: number
  montoSinUsar: number
  /** Avisos de PRUEBA del rango (se cuentan aparte y **no** suman a los montos). */
  pruebas: number
  montoPruebas: number
  /** Estados que la app no entiende: si hay, el puente está escribiendo otra cosa. */
  desconocidos: number
}

/**
 * Resumen del rango para el encabezado del historial.
 *
 * 🔑 **Los avisos de PRUEBA no suman a `total` ni a `cobrado`**: un aviso `origen: 'prueba'` es
 * un botón que alguien apretó para probar el circuito, no plata que entró (ver el invariante de
 * los avisos). Se informan aparte para que se vean, pero no inflan lo cobrado.
 */
export function resumenHistorialYape(
  pagos: readonly PagoYape[],
  opciones: OpcionesYape = {},
): ResumenHistorialYape {
  const r: ResumenHistorialYape = {
    cantidad: 0,
    total: 0,
    cobrado: 0,
    sinUsar: 0,
    montoSinUsar: 0,
    pruebas: 0,
    montoPruebas: 0,
    desconocidos: 0,
  }
  for (const p of pagos ?? []) {
    if (!p) continue
    const monto = Number(p.monto) || 0
    r.cantidad++
    if (esAvisoDePrueba(p)) {
      r.pruebas++
      r.montoPruebas = redondear2(r.montoPruebas + monto)
      continue
    }
    const situacion = situacionPagoYape(p, opciones)
    r.total = redondear2(r.total + monto)
    if (situacion === 'usado') r.cobrado = redondear2(r.cobrado + monto)
    if (situacion === 'ignorado' || situacion === 'anulado' || situacion === 'vencido') {
      r.sinUsar++
      r.montoSinUsar = redondear2(r.montoSinUsar + monto)
    }
    if (situacion === 'desconocido') r.desconocidos++
  }
  return r
}

/** Encabezados de la planilla del historial (los usa la pantalla y el Excel). */
export const COLUMNAS_AVISOS_YAPE = [
  'Fecha',
  'Hora',
  'Monto',
  'Pagador',
  'N° operación',
  'Código',
  'Situación',
  'Origen',
  'Lo usó',
  'Comprobante',
  'Detalle',
] as const

/**
 * Filas del historial, en el mismo orden en que se ven en pantalla: una sola forma de armar la
 * planilla, para que el Excel no diga algo distinto de la tabla.
 */
export function filasDeAvisosYape(
  pagos: readonly PagoYape[],
  opciones: OpcionesYape = {},
): (string | number)[][] {
  return (pagos ?? []).filter(Boolean).map((p) => [
    fechaDeYape(p.fecha),
    horaDeYape(p.fecha),
    redondear2(Number(p.monto) || 0),
    String(p.pagadorNombre ?? '').trim(),
    String(p.nroOperacion ?? '').trim(),
    codigoDeSeguridadYape(p),
    etiquetaSituacionYape(situacionPagoYape(p, opciones)) + (esAvisoDePrueba(p) ? ' (PRUEBA)' : ''),
    esAvisoDePrueba(p) ? 'PRUEBA' : String(p.origen ?? '').trim(),
    String(p.usadoPor ?? '').trim(),
    String(p.documento ?? '').trim(),
    detalleDeAviso(p, opciones),
  ])
}
