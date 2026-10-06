/**
 * **Cuándo un turno ya tiene demasiadas ventas** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Por qué existe**: el turno guarda **el detalle completo de cada venta** (`ventasDelTurno`) y lo
 * **reescribe entero** en cada operación de caja (alta, anulación, cobro de pedido, cobro de crédito,
 * nota, envío a SUNAT). Firestore tiene un límite **duro de 1 MiB por documento**, así que un turno con
 * demasiadas ventas **no se puede guardar** — y como la venta se guarda en la misma transacción, lo que
 * falla es el **cobro**.
 *
 * 📌 **Medido en producción el 04/10/2026** (`tblTurnos`, 115 turnos, 106 con ventas): **1.036 bytes por
 * venta** en promedio (el rango real va de 306 B a 1.327 B según los ítems y las formas de pago). Con ese
 * promedio, el turno aguanta **~1.000 ventas**; el más grande de la historia tiene **12** y pesa **6,6 KB**
 * (0,6 % del límite). El negocio hace ~3 documentos de venta por día.
 *
 * 🔑 **La salida es operativa, no técnica**: **cerrar el turno y abrir otro** (partir el día). Estos
 * umbrales existen para avisar **antes** de llegar al límite, y el aviso lo dispara esta regla —una sola
 * implementación— desde la pantalla de Turnos y desde el PDV.
 */

/** **1 MiB**: el límite de Firestore por documento, que no se configura ni se amplía. */
export const LIMITE_DOCUMENTO = 1024 * 1024

/**
 * Peso promedio de una venta dentro del turno, **medido** en producción (04/10/2026).
 * Es una estimación para dar una idea del tamaño: lo que decide es la cantidad de ventas.
 */
export const BYTES_POR_VENTA = 1036

/** A partir de acá se avisa que **a las 500 conviene cerrar** el turno. */
export const VENTAS_AVISO = 400

/** A partir de acá el turno **ya se debería cerrar** (la mitad del techo medido, con margen). */
export const VENTAS_CERRAR = 500

/** A partir de acá es urgente: cerca del límite el turno no se puede guardar y **no se puede cobrar**. */
export const VENTAS_URGENTE = 800

export type NivelLimiteTurno = 'ok' | 'aviso' | 'cerrar' | 'urgente'

export type LimiteTurno = {
  nivel: NivelLimiteTurno
  /** Ventas que tiene el turno (0 si no se sabe). */
  ventas: number
  /** Tamaño estimado del documento, en KB (con `BYTES_POR_VENTA`). */
  kb: number
  /** Qué porcentaje del límite de 1 MiB representa esa estimación. */
  pct: number
  /** Título corto para el aviso (vacío cuando no hay nada que avisar). */
  titulo: string
  /** La explicación, con el número de ventas y lo que hay que hacer. */
  detalle: string
  /** ¿Hay que cerrar el turno ya? (para pintar el aviso en rojo). */
  cerrarAhora: boolean
}

/**
 * **El estado de un turno según sus ventas.** Devuelve `nivel: 'ok'` (sin aviso) mientras no llegue al
 * umbral, así el llamador puede dibujar el aviso sin preguntar nada más.
 *
 * ⚠️ **Los umbrales son configurables** por si un negocio necesita otros (una caja más rápida o turnos
 * más largos), pero los de fábrica son los medidos: 400 para avisar y 500 para cerrar.
 */
export function limiteDeTurno(
  ventas: number | null | undefined,
  opts: { aviso?: number; cerrar?: number; urgente?: number; bytesPorVenta?: number } = {},
): LimiteTurno {
  const n = Math.max(0, Math.floor(Number(ventas) || 0))
  const aviso = opts.aviso ?? VENTAS_AVISO
  const cerrar = opts.cerrar ?? VENTAS_CERRAR
  const urgente = opts.urgente ?? VENTAS_URGENTE
  const bytes = opts.bytesPorVenta ?? BYTES_POR_VENTA
  const kb = Math.round((n * bytes) / 1024)
  const pct = Math.round(((n * bytes) / LIMITE_DOCUMENTO) * 1000) / 10

  if (n >= urgente) {
    return {
      nivel: 'urgente',
      ventas: n,
      kb,
      pct,
      titulo: `Este turno ya tiene ${n} ventas: cerralo ahora`,
      detalle:
        `El detalle del turno se guarda completo y no puede pasar de 1 MB. Al acercarse a ~1.000 ventas el turno ` +
        `no se puede guardar y no vas a poder cobrar. Cerrá este turno y abrí otro.`,
      cerrarAhora: true,
    }
  }

  if (n >= cerrar) {
    return {
      nivel: 'cerrar',
      ventas: n,
      kb,
      pct,
      titulo: `Este turno ya tiene ${n} ventas: cerralo y abrí otro`,
      detalle:
        `Pasaste las ${cerrar} ventas de referencia (el documento va por ~${kb} KB de 1.024 KB). ` +
        `Cerrá el turno —el arqueo se hace igual que siempre— y abrí uno nuevo para seguir cobrando liviano.`,
      cerrarAhora: true,
    }
  }

  if (n >= aviso) {
    return {
      nivel: 'aviso',
      ventas: n,
      kb,
      pct,
      titulo: `Este turno tiene ${n} ventas`,
      detalle:
        `A las ${cerrar} ventas conviene cerrarlo y abrir otro: el detalle del turno se guarda completo y no puede ` +
        `pasar de 1 MB. Todavía estás bien (el documento va por ~${kb} KB), pero andá pensando el cierre.`,
      cerrarAhora: false,
    }
  }

  return { nivel: 'ok', ventas: n, kb, pct, titulo: '', detalle: '', cerrarAhora: false }
}
