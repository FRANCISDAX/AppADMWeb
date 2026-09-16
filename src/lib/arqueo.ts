/**
 * Desglose por **origen** del dinero de un turno — **módulo puro** (sin Firebase ni React).
 *
 * Para qué sirve: los dos bolsillos del arqueo (`efectivo` y `transferencia`) mezclan
 * cosas distintas. En una transferencia entra lo que se **vendió** pagado con Yape,
 * Plin, débito o tarjeta, y también lo que se **cobró** de una deuda de días atrás.
 * El total del bolsillo está bien así (es la plata que realmente entró al cajón o a la
 * billetera, y es contra eso que se concilia), pero leerlo como "ventas" engaña: en el
 * turno del 14/09/2026 la fila *"Ventas transferencia"* decía S/ 47.00 cuando las ventas
 * del día eran S/ 2.00 y los S/ 47.00 eran una **cobranza** de una boleta del 02/09.
 *
 * Criterio (elegido con el usuario): **no se mueve ningún total guardado**, se agrega el
 * desglose por origen dentro de cada bolsillo:
 *
 *   - `ventas`     → ventas (y notas de venta) del día
 *   - `cobranzas`  → cobros de crédito de documentos anteriores
 *   - `notas`      → notas de crédito/débito (la NC resta)
 *
 * ⚠️ **El total manda.** `ventas` se calcula como **residuo** (`total − cobranzas − notas`)
 * para que las tres partes sumen siempre el número guardado del turno, incluso en un turno
 * cerrado con anulaciones posteriores (ahí los totales **no** se descuentan: se acumulan en
 * `totalAnulado*` y el reporte multi-turno los resta aparte). Si el desglose derivado no
 * coincide con el total guardado, `consistente` queda en `false` y el residuo absorbe la
 * diferencia, en vez de mostrar tres números que no suman.
 *
 * Verificado contra producción: en los **93 turnos** el desglose derivado coincide con lo
 * guardado (tolerancia de 1 céntimo).
 */

import { bolsilloDe, bolsillosDeVenta, type BolsilloPago, type PagoGuardado } from './pagos.ts'

/** Redondeo a 2 decimales (evita los arrastres de coma flotante al mostrar). */
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100

/** Tolerancia para dar por consistente el desglose (un céntimo, igual que en pagos). */
const TOLERANCIA = 0.011

export type OrigenPago = 'ventas' | 'cobranzas' | 'notas'

/** Item guardado en `turno.ventasDelTurno`. Los dos campos son opcionales porque
 *  dentro conviven ventas, cobros y notas, cada uno con su forma. */
export type ItemTurno = {
  tipo?: string
  estado?: string
  tipoPago?: string
  monto?: number
  total?: number
  pagos?: readonly PagoGuardado[]
  serie_numero?: string
}

export type DesgloseBolsillo = {
  /** Total del bolsillo tal como está guardado en el turno. */
  total: number
  ventas: number
  cobranzas: number
  notas: number
}

export type DesgloseTurno = {
  efectivo: DesgloseBolsillo
  transferencia: DesgloseBolsillo
  /** `false` si lo derivado de los items no explica el total guardado (se ve en el residuo). */
  consistente: boolean
  /** Items que no se pudieron clasificar (estado anulado no: esos se descartan a propósito). */
  itemsIgnorados: number
}

/** Turno mínimo que necesita el desglose. */
export type TurnoParaDesglose = {
  totalEfectivo?: number
  totalTransferencia?: number
  ventasDelTurno?: readonly ItemTurno[]
}

/**
 * Bolsillo de un item de cobro o de nota, según su `tipoPago`.
 *
 * Las **notas** siguen la regla que ya usa `services/notas.ts` al mover la caja: una NC
 * de una venta en efectivo (o mixta) sale del efectivo y una de una venta por
 * transferencia sale de la transferencia. El crédito no toca ningún bolsillo.
 */
function bolsilloDeItem(tipoPago?: string): BolsilloPago {
  const pt = String(tipoPago ?? 'efectivo').trim().toLowerCase()
  // `mixto` no dice de qué bolsillo salió, y `notas.ts` lo trata como efectivo.
  if (pt === 'mixto') return 'efectivo'
  return bolsilloDe(pt)
}

const esCobro = (i: ItemTurno) => i.tipo === 'cobro_credito'
const esNota = (i: ItemTurno) => i.tipo === 'nota_credito' || i.tipo === 'nota_debito'

/**
 * Reparte los items del turno por bolsillo y por origen.
 * Los items anulados se descartan (el arqueo también los descarta).
 */
export function desglosarTurno(turno: TurnoParaDesglose): DesgloseTurno {
  const items = (turno.ventasDelTurno ?? []).filter((i) => i && i.estado !== 'anulada')

  const crudo = {
    efectivo: { ventas: 0, cobranzas: 0, notas: 0 },
    transferencia: { ventas: 0, cobranzas: 0, notas: 0 },
  }
  let itemsIgnorados = 0

  for (const item of items) {
    if (esCobro(item)) {
      const b = bolsilloDeItem(item.tipoPago)
      if (b === 'credito') { itemsIgnorados++; continue }
      crudo[b].cobranzas += Number(item.monto ?? item.total ?? 0) || 0
      continue
    }
    if (esNota(item)) {
      const b = bolsilloDeItem(item.tipoPago)
      if (b === 'credito') { itemsIgnorados++; continue }
      // `total` ya viene con signo: en una NC es negativo y resta del bolsillo.
      crudo[b].notas += Number(item.total ?? 0) || 0
      continue
    }
    // Venta: el reparto entre bolsillos lo define `lib/pagos.ts` (pago múltiple incluido,
    // y una venta a crédito no entra a ninguno).
    const reparto = bolsillosDeVenta({ tipoPago: item.tipoPago, pagos: item.pagos, total: item.total })
    crudo.efectivo.ventas += reparto.efectivo
    crudo.transferencia.ventas += reparto.transferencia
  }

  const armar = (b: 'efectivo' | 'transferencia', totalGuardado: number): { d: DesgloseBolsillo; ok: boolean } => {
    const total = r2(totalGuardado)
    const cobranzas = r2(crudo[b].cobranzas)
    const notas = r2(crudo[b].notas)
    const derivadoVentas = crudo[b].ventas
    const derivadoTotal = r2(derivadoVentas + cobranzas + notas)
    const ok = Math.abs(derivadoTotal - total) < TOLERANCIA
    // El total manda: `ventas` es el residuo, así las tres partes suman el total guardado.
    const ventas = ok ? r2(derivadoVentas) : r2(total - cobranzas - notas)
    return { d: { total, ventas, cobranzas, notas }, ok }
  }

  const ef = armar('efectivo', turno.totalEfectivo ?? 0)
  const tr = armar('transferencia', turno.totalTransferencia ?? 0)

  return {
    efectivo: ef.d,
    transferencia: tr.d,
    consistente: ef.ok && tr.ok,
    itemsIgnorados,
  }
}

/** Suma el desglose de varios turnos (para el encabezado del día en el arqueo). */
export function sumarDesgloses(desgloses: readonly DesgloseTurno[]): DesgloseTurno {
  const acc = {
    efectivo: { total: 0, ventas: 0, cobranzas: 0, notas: 0 },
    transferencia: { total: 0, ventas: 0, cobranzas: 0, notas: 0 },
    consistente: true,
    itemsIgnorados: 0,
  }
  for (const d of desgloses) {
    for (const b of ['efectivo', 'transferencia'] as const) {
      acc[b].total += d[b].total
      acc[b].ventas += d[b].ventas
      acc[b].cobranzas += d[b].cobranzas
      acc[b].notas += d[b].notas
    }
    if (!d.consistente) acc.consistente = false
    acc.itemsIgnorados += d.itemsIgnorados
  }
  for (const b of ['efectivo', 'transferencia'] as const) {
    acc[b].total = r2(acc[b].total)
    acc[b].ventas = r2(acc[b].ventas)
    acc[b].cobranzas = r2(acc[b].cobranzas)
    acc[b].notas = r2(acc[b].notas)
  }
  return acc
}

/**
 * Detalle de un bolsillo para mostrar en la UI, **omitiendo los orígenes que están en
 * cero**: en el caso normal (todo ventas) no agrega ruido, y solo cuando hay cobranzas o
 * notas aparece la línea que lo explica.
 */
export function lineasDeOrigen(d: DesgloseBolsillo): { origen: OrigenPago; label: string; monto: number }[] {
  const lineas: { origen: OrigenPago; label: string; monto: number }[] = []
  if (d.ventas !== 0) lineas.push({ origen: 'ventas', label: 'ventas', monto: d.ventas })
  if (d.cobranzas !== 0) lineas.push({ origen: 'cobranzas', label: 'cobranza de crédito', monto: d.cobranzas })
  if (d.notas !== 0) lineas.push({ origen: 'notas', label: 'notas', monto: d.notas })
  return lineas
}
