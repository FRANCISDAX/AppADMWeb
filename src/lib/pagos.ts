/**
 * Formas de pago del PDV — **módulo puro** (sin Firebase, sin React).
 *
 * Modelo: cada pago tiene un **medio** (lo que el cliente usó: efectivo, Yape,
 * Plin, transferencia o tarjeta) y un **bolsillo** (dónde entra para la caja:
 * efectivo o transferencia). El bolsillo se guarda en `tipo`, que es lo que ya
 * entienden el arqueo, los reportes, las anulaciones y los cierres: por eso se
 * puede agregar detalle **sin tocar nada de eso**.
 *
 * Reglas (definidas acá y en ningún otro lado):
 * 1. Los medios electrónicos **nunca** pueden superar el total de la venta: no
 *    existe "vuelto por Yape".
 * 2. El **efectivo sí** puede superarlo: el excedente es el **vuelto**.
 * 3. Lo que se guarda en `pagos` son los montos **aplicados** (suman exacto el
 *    total), y aparte se conservan `montoRecibido` (lo que el cliente entregó) y
 *    `cambio` (el vuelto). Si no, la caja contaría de más.
 * 4. El **crédito no se combina** con otros medios: es por el total de la venta
 *    (la regla de si se permite vive en `lib/credito.ts`).
 */

import { redondear2 } from './dinero.ts'

/** Tolerancia para no bloquear por céntimos de redondeo. */
const TOLERANCIA = 0.01

/** Lo que el cliente usa para pagar. */
export type MedioPago = 'efectivo' | 'yape' | 'plin' | 'transferencia' | 'tarjeta'

/** Dónde entra la plata para la caja. Es lo que se guarda en `tipo`. */
export type BolsilloPago = 'efectivo' | 'transferencia' | 'credito'

export type InfoMedio = {
  medio: MedioPago
  label: string
  icono: string
  bolsillo: BolsilloPago
  /** Pide N° de operación (Yape, Plin, transferencia y tarjeta sí; efectivo no). */
  pideOperacion: boolean
}

/**
 * Medios ofrecidos en el PDV, en el orden en que se muestran.
 * Los iconos coinciden con los que ya usa el resto de la app (arqueo, recibos).
 */
export const MEDIOS: readonly InfoMedio[] = [
  { medio: 'efectivo', label: 'Efectivo', icono: '💵', bolsillo: 'efectivo', pideOperacion: false },
  { medio: 'yape', label: 'Yape', icono: '📱', bolsillo: 'transferencia', pideOperacion: true },
  { medio: 'plin', label: 'Plin', icono: '📱', bolsillo: 'transferencia', pideOperacion: true },
  { medio: 'transferencia', label: 'Transferencia', icono: '📲', bolsillo: 'transferencia', pideOperacion: true },
  { medio: 'tarjeta', label: 'Tarjeta', icono: '💳', bolsillo: 'transferencia', pideOperacion: true },
]

/** Medios del grupo "Transferencia" del PDV (todo lo que no es efectivo). */
export const MEDIOS_ELECTRONICOS: readonly InfoMedio[] = MEDIOS.filter((m) => m.bolsillo === 'transferencia')

/** Un pago tal como lo carga el cajero (antes de aplicar la regla). */
export type PagoEntrada = { id: string; medio: MedioPago; monto: number; operacion?: string }

/**
 * Un pago tal como se guarda en la venta. `tipo` = bolsillo (compatibilidad con
 * todo lo que ya lee `pagos`), `medio` = detalle del medio usado. `medio` es
 * opcional a propósito: las ventas viejas solo tienen `tipo`.
 */
export type PagoGuardado = { tipo: BolsilloPago; medio?: MedioPago; monto: number; operacion?: string }

export type ResumenPagos = {
  total: number
  /** Efectivo que el cliente entregó (puede ser más que lo que hace falta). */
  efectivoRecibido: number
  /** Suma de los medios electrónicos. */
  electronico: number
  /** Parte del efectivo que realmente cubre la venta. */
  efectivoAplicado: number
  /** Excedente de efectivo que se devuelve. */
  vuelto: number
  /** Cuánto falta para cubrir el total. */
  falta: number
  /** Cuánto se pasaron los medios electrónicos del total (debe ser 0). */
  excedeElectronico: number
  puedeCobrar: boolean
  /** Mensaje listo para mostrar cuando todavía no se puede cobrar. */
  motivo?: string
  /** El desglose con montos aplicados, listo para guardar. */
  pagos: PagoGuardado[]
}

/** Convierte lo que haya en el input (string, NaN, negativo) en un monto válido. */
export function normalizarMonto(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor ?? '').replace(',', '.'))
  if (!Number.isFinite(n) || n <= 0) return 0
  return redondear2(n)
}

/** Ficha del medio. Un valor desconocido (documento viejo, typo) cae en efectivo. */
export function infoMedio(medio: string): InfoMedio {
  return MEDIOS.find((m) => m.medio === medio) ?? MEDIOS[0]
}

/**
 * Bolsillo de un medio: en qué total del turno entra.
 *
 * ⚠️ **`'credito'` (y cualquier valor desconocido) no entra a NINGÚN bolsillo.** Una
 * venta al fiado no deja plata en el cajón ni en la billetera: queda **por cobrar**.
 * Antes esta función caía a `infoMedio`, que ante un medio desconocido devuelve el
 * primer medio de la lista (**efectivo**), así que `bolsilloDe('credito')` daba
 * `'efectivo'` y **una venta a crédito inflaba el efectivo de la caja** → el arqueo
 * mostraba un faltante igual al crédito. Los llamadores comparan con `'efectivo'` /
 * `'transferencia'`, así que devolver un tercer valor los deja correctos sin tocarlos.
 */
export function bolsilloDe(medio: string): BolsilloPago {
  const clave = String(medio ?? '').trim().toLowerCase()
  const info = MEDIOS.find((m) => m.medio === clave)
  return info ? info.bolsillo : 'credito'
}

/**
 * Reparto de una venta entre los bolsillos de la caja — **única** implementación de
 * la regla, para que el alta (`ventas.ts`) y la anulación calculen lo mismo.
 *
 * Si la venta trae `pagos` (pago múltiple), cada pago va a su bolsillo. Si no, se cae
 * a `tipoPago` (documentos viejos y los que escribe la app móvil, que no guarda
 * `pagos`). Una venta a crédito devuelve **0 y 0**.
 *
 * ⚠️ Los **cobros de crédito** que se van agregando a `venta.pagos` usan `tipoPago`
 * (no `tipo`) y acá se **ignoran a propósito**: no son pagos de esta venta y ya están
 * contados en el turno como items `cobro_credito`.
 */
export function bolsillosDeVenta(entrada: {
  tipoPago?: string
  pagos?: readonly PagoGuardado[]
  total?: number
}): { efectivo: number; transferencia: number } {
  const res = { efectivo: 0, transferencia: 0 }
  const pagos = Array.isArray(entrada.pagos) ? entrada.pagos : []
  if (pagos.length > 0) {
    for (const p of pagos) {
      const b = bolsilloDe(p.medio ?? p.tipo ?? '')
      if (b !== 'credito') res[b] += Number(p.monto) || 0
    }
    return res
  }
  const b = bolsilloDe(entrada.tipoPago ?? '')
  if (b !== 'credito') res[b] = Number(entrada.total) || 0
  return res
}

/**
 * **Medio** de una venta guardada (`yape`/`plin`/`transferencia`/`tarjeta`), o `'mixto'`
 * si se pagó con más de uno. Devuelve `undefined` cuando no hay dato: los documentos viejos
 * y los de la app móvil solo tienen el bolsillo en `tipoPago`, y **no hay que inventar** un
 * medio (un `tipoPago: 'transferencia'` puede ser Yape, Plin o el banco).
 *
 * ⚠️ Se usa al emitir una **nota** para heredar el medio del comprobante original: sin
 * esto, una NC de una venta por Yape quedaba como "Transferencia (sin detalle)" y la
 * conciliación por billetera perdía exactitud.
 */
export function medioDeVenta(venta: { pagos?: readonly PagoGuardado[] } | null | undefined): string | undefined {
  const pagos = Array.isArray(venta?.pagos) ? venta.pagos : []
  if (pagos.length > 1) return 'mixto'
  const medio = pagos[0]?.medio
  return typeof medio === 'string' && medio ? medio : undefined
}

/**
 * Etiqueta legible de un pago, aguantando documentos viejos que solo tienen
 * `tipo` (efectivo / transferencia / credito / mixto) sin `medio`.
 */
export function etiquetaPago(pago: { tipo?: string; medio?: string }): string {
  const clave = pago.medio || pago.tipo || 'efectivo'
  if (clave === 'credito') return '💳 Crédito'
  if (clave === 'mixto') return '🪙 Mixto'
  const info = MEDIOS.find((m) => m.medio === clave)
  return info ? `${info.icono} ${info.label}` : '💵 Efectivo'
}

/**
 * Tope que acepta un medio: los electrónicos no pueden pasar lo que falta
 * (devolverían un "vuelto" imposible), el efectivo no tiene tope (da vuelto).
 * `null` = sin tope.
 */
export function topeSugerido(medio: string, falta: number): number | null {
  if (bolsilloDe(medio) === 'efectivo') return null
  return redondear2(Math.max(0, falta))
}

/**
 * Aplica las reglas a lo que cargó el cajero y devuelve los totales más el
 * desglose listo para guardar. Es la **única** implementación: la usan el panel
 * del PDV (para mostrar) y el guardado (para decidir), así lo que se ve y lo que
 * se permite no pueden contradecirse.
 */
export function resumenPagos({ pagos, total }: { pagos: readonly PagoEntrada[]; total: number }): ResumenPagos {
  const t = redondear2(Math.max(0, Number(total) || 0))
  const validos = (pagos ?? []).filter((p) => p && normalizarMonto(p.monto) > 0)

  let efectivoRecibido = 0
  let electronico = 0
  for (const p of validos) {
    const monto = normalizarMonto(p.monto)
    if (bolsilloDe(p.medio) === 'efectivo') efectivoRecibido += monto
    else electronico += monto
  }
  efectivoRecibido = redondear2(efectivoRecibido)
  electronico = redondear2(electronico)

  const excedeElectronico = redondear2(Math.max(0, electronico - t))
  // El efectivo cubre lo que los electrónicos no cubrieron; lo que sobre es vuelto.
  const efectivoAplicado = redondear2(Math.max(0, t - electronico))
  const vuelto = redondear2(Math.max(0, efectivoRecibido - efectivoAplicado))
  const falta = redondear2(Math.max(0, t - electronico - efectivoRecibido))

  const puedeCobrar = falta <= TOLERANCIA && excedeElectronico <= TOLERANCIA
  let motivo: string | undefined
  if (excedeElectronico > TOLERANCIA) {
    motivo = `Los pagos electrónicos superan el total por S/ ${excedeElectronico.toFixed(2)}. Solo el efectivo puede pagar de más (da vuelto).`
  } else if (falta > TOLERANCIA) {
    motivo = `Faltan S/ ${falta.toFixed(2)} por cubrir.`
  }

  // Desglose a guardar: los electrónicos como se cargaron y un único efectivo
  // con el monto aplicado (el que entra a la caja).
  const guardados: PagoGuardado[] = []
  for (const p of validos) {
    if (bolsilloDe(p.medio) === 'efectivo') continue
    const operacion = (p.operacion ?? '').trim()
    guardados.push({
      tipo: 'transferencia',
      medio: p.medio,
      monto: normalizarMonto(p.monto),
      ...(operacion ? { operacion } : {}),
    })
  }
  if (efectivoRecibido > 0 && efectivoAplicado > 0) {
    guardados.push({ tipo: 'efectivo', medio: 'efectivo', monto: efectivoAplicado })
  }

  return {
    total: t,
    efectivoRecibido,
    electronico,
    efectivoAplicado,
    vuelto,
    falta,
    excedeElectronico,
    puedeCobrar,
    ...(motivo ? { motivo } : {}),
    pagos: guardados,
  }
}

/** `tipoPago` del documento: el bolsillo si hay uno solo, `mixto` si hay varios. */
export function tipoPagoDe(pagos: readonly PagoGuardado[]): 'efectivo' | 'transferencia' | 'credito' | 'mixto' {
  if (pagos.length === 0) return 'efectivo'
  if (pagos.length === 1) return pagos[0].tipo
  return 'mixto'
}

/** Texto de la forma de pago para el documento y el recibo. */
export function formaPagoLabel(pagos: readonly { tipo?: string; medio?: string }[], tipoPago?: string): string {
  if (tipoPago === 'credito' || (pagos ?? []).some((p) => (p.medio || p.tipo) === 'credito')) return 'Crédito'
  if (!pagos || pagos.length === 0) return 'Efectivo'
  if (pagos.length > 1) return 'Mixto'
  return infoMedio(pagos[0].medio || pagos[0].tipo || 'efectivo').label
}
