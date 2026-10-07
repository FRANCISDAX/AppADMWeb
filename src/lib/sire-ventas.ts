/**
 * **El Registro de Ventas del SIRE (RVIE)** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Para qué**: el contador presenta el Registro de Ventas Electrónico con el archivo que baja esta
 * pantalla, y SUNAT lo **cruza contra los comprobantes electrónicos** que ya tiene. Por eso lo que se
 * declara acá tiene que ser **lo mismo que declaró el comprobante**.
 *
 * 🔑 **La cuenta no se escribe de nuevo acá**: cada línea se valora con **`itemsParaSunat()`**
 * (`lib/sunat-importes.ts`) — la misma regla que arma el XML que se manda a SUNAT, con el **descuento
 * repartido entre las líneas** —, la afectación sale de **`afectacionGuardada()`** y el signo del
 * documento de **`signoDoc()`**. Si esta cuenta se escribiera aparte, el SIRE podría declarar algo
 * distinto que el comprobante (que es exactamente el bug que este módulo cierra).
 *
 * 📌 **Bug del 04/10/2026 (el SIRE sumaba el descuento)**: la pantalla calculaba las bases sumando
 * `items[].subtotal` —que es el **precio de lista**— y **nunca restaba** `venta.descuentoTotal`. Medido
 * contra producción, la **boleta `B001-000078`** (6 huevos con promo, aceptada por SUNAT) decía
 * **S/ 11.00** en el comprobante y **S/ 11.60** en el SIRE: los S/ 0.60 de descuento se **sumaban**.
 * Eran **8 documentos y S/ 4.50** en total (7 de septiembre + 1 de octubre).
 *
 * ⚠️ **El IGV de un ítem gravado se SEPARA, no se suma**: el precio es **final al público** (lleva el
 * IGV adentro), así que la base es `precio ÷ 1.18` (`precioSinIgv()`, la regla de `lib/precio-venta.ts`)
 * y el IGV es la diferencia. El bug anterior hacía `base = precio` y `igv = base × 18%`, o sea declaraba
 * **13,92 por una venta de 11,80** (y en esta región, con todo exonerado, no se notaba).
 */
import { redondear2 } from './dinero.ts'
import { precioSinIgv } from './precio-venta.ts'
import { tasaDelDocumento } from './igv.ts'
import { signoDoc } from './ventas-mensuales.ts'
import {
  afectacionGuardada,
  descuentoDeVenta,
  esGravado,
  importeBrutoDe,
  itemsParaSunat,
  type ItemVenta,
} from './sunat-importes.ts'

/** Un ítem de un documento de venta, con la afectación que pudo guardar el comprobante. */
export type ItemSire = ItemVenta & { tipoAfectacion?: string }

/** Lo que este módulo necesita de un documento (el resto no se usa). */
export type DocSire = {
  tipoDoc?: string | null
  estado?: string | null
  venta?: {
    total?: number | null
    descuentoTotal?: number | null
    descuento_total?: number | null
    items?: readonly ItemSire[] | null
  } | null
}

/** Una fila del registro: los importes que se declaran por comprobante. */
export type FilaSire = {
  /** Base gravada (el valor **sin** IGV de las líneas `'10'`). */
  baseGravada: number
  /** Base exonerada (afectación `'20'`). */
  baseExonerada: number
  /** Base inafecta (`'30'`/`'40'`). */
  baseInafecta: number
  /** El IGV de las líneas gravadas (separado del precio, nunca sumado encima). */
  igv: number
  /** **Lo declarado por el comprobante**: `Σ líneas` ya con el descuento aplicado. */
  total: number
  /** `-1` para la nota de crédito (resta), `+1` para el resto. */
  signo: number
  /** El código de tipo de comprobante de SUNAT (`01`, `03`, `07`, `08`). */
  tipoDocSunat: string
  /**
   * El documento **no trae ítems** (comprobantes viejos): se declara el total tal cual, **sin inventar
   * IGV** — sin detalle no hay forma de saber la afectación, y suponer gravado declararía un impuesto
   * que nadie cobró.
   */
  sinDetalle: boolean
}

/** El **tipo de comprobante de SUNAT** (Tabla 11 del RVIE) según el tipo del documento. */
export function tipoDocSunat(tipoDoc?: string | null): string {
  if (tipoDoc === 'FACTURA') return '01'
  if (tipoDoc === 'NC') return '07'
  if (tipoDoc === 'ND') return '08'
  return '03' // Boleta (y cualquier otro, que en este registro siempre es una boleta)
}

/**
 * **Lo que declara un documento.** Devuelve los importes ya con el signo del documento aplicado
 * (la NC resta), listos para sumar en los totales del período.
 *
 * 🔑 **La tasa del IGV sale del documento** (y, si es anterior a que se guardara, de la configuración de la
 * empresa): el registro tiene que declarar **lo mismo que el comprobante**, y el comprobante de un
 * restaurante/hotel va al 10% (`lib/igv.ts`).
 */
export function calcularFilaSire(d: DocSire | null | undefined, config?: unknown): FilaSire {
  const signo = signoDoc(d)
  const venta = d?.venta ?? {}
  const items = venta.items ?? []
  const tasaIgv = tasaDelDocumento(venta, config)

  let baseGravada = 0
  let baseExonerada = 0
  let baseInafecta = 0
  let igv = 0

  if (items.length === 0) {
    // Sin detalle: se declara lo cobrado y no se supone afectación (ver `sinDetalle`).
    baseExonerada = Math.abs(Number(venta.total) || 0)
    return {
      baseGravada: 0,
      baseExonerada: redondear2(signo * baseExonerada),
      baseInafecta: 0,
      igv: 0,
      total: redondear2(signo * baseExonerada),
      signo,
      tipoDocSunat: tipoDocSunat(d?.tipoDoc),
      sinDetalle: true,
    }
  }

  // 🔑 La misma regla del comprobante: el descuento repartido entre las líneas.
  for (const it of itemsParaSunat(items, descuentoDeVenta(venta))) {
    const importe = redondear2(Math.abs(importeBrutoDe(it)))
    if (importe === 0) continue
    const af = afectacionGuardada(it)
    if (esGravado(af)) {
      // El precio es final al público: la base es el valor sin IGV y el IGV, la diferencia.
      const neto = redondear2(precioSinIgv(importe, af, tasaIgv))
      baseGravada += neto
      igv += redondear2(importe - neto)
    } else if (af.startsWith('2')) {
      baseExonerada += importe
    } else if (af.startsWith('3') || af.startsWith('4')) {
      baseInafecta += importe
    }
  }

  const bGrav = redondear2(signo * baseGravada)
  const bExo = redondear2(signo * baseExonerada)
  const bIna = redondear2(signo * baseInafecta)
  const igvR = redondear2(signo * igv)
  return {
    baseGravada: bGrav,
    baseExonerada: bExo,
    baseInafecta: bIna,
    igv: igvR,
    // El total sale de las partes (no de `venta.total`): así no puede contradecir a las bases.
    total: redondear2(bGrav + bExo + bIna + igvR),
    signo,
    tipoDocSunat: tipoDocSunat(d?.tipoDoc),
    sinDetalle: false,
  }
}

/** Los totales de un período: lo que va en la fila TOTALES y en las tarjetas de arriba. */
export type TotalesSire = {
  baseGravada: number
  baseExonerada: number
  baseInafecta: number
  igv: number
  total: number
  /** Cuántos documentos entraron en la cuenta. */
  cantidad: number
  /** Cuántos se declararon sin detalle de ítems (ver `FilaSire.sinDetalle`). */
  sinDetalle: number
}

/** Suma las filas del registro. */
export function totalesSire(filas: readonly FilaSire[] | null | undefined): TotalesSire {
  const t: TotalesSire = { baseGravada: 0, baseExonerada: 0, baseInafecta: 0, igv: 0, total: 0, cantidad: 0, sinDetalle: 0 }
  for (const f of filas ?? []) {
    t.baseGravada += f.baseGravada
    t.baseExonerada += f.baseExonerada
    t.baseInafecta += f.baseInafecta
    t.igv += f.igv
    t.total += f.total
    t.cantidad += 1
    if (f.sinDetalle) t.sinDetalle += 1
  }
  return {
    baseGravada: redondear2(t.baseGravada),
    baseExonerada: redondear2(t.baseExonerada),
    baseInafecta: redondear2(t.baseInafecta),
    igv: redondear2(t.igv),
    total: redondear2(t.total),
    cantidad: t.cantidad,
    sinDetalle: t.sinDetalle,
  }
}
