// Reglas puras de la **consolidación de Notas de Venta a Boleta**.
//
// 🔑 `generarConsolidado` (`services/consolidado.ts`) arma una BOLETA que agrupa las NV del día.
// Ese documento se imprime y se manda a SUNAT como cualquier otro, así que tiene que cumplir los
// mismos invariantes que una venta: **las líneas a precio de lista + la fila `Descuento` = el
// total** (`lib/pdf.ts` y `lib/sunat.ts` recalculan `precioVenta × cantidad` y restan el
// descuento declarado en la venta).
//
// 📌 **Bug del 18/09/2026**: el consolidador sumaba los totales (ya netos) de cada NV, pero
// **tiraba el descuento** y unía los items por `id` sin mirar el precio. Resultado: una boleta
// consolidada con una NV que tuvo promoción salía con las líneas a precio de lista, el total
// menor y **sin ninguna fila de descuento** que explicara la diferencia — el mismo defecto que
// el comprobante de un pedido (una NV con descuento se veía bien; al consolidarla, el descuento
// desaparecía) y, encima, el XML declaraba de más.

import { cantidadDe, descuentoDeVenta, importeBrutoDe } from './sunat-importes.ts'

const r2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100

/** Forma mínima de una NV para consolidar (lo que hay que leer del documento). */
export type NvConsolidable = {
  id?: unknown
  venta?: { total?: unknown; items?: unknown; descuentoTotal?: unknown; descuento_total?: unknown } | null
}

/** Línea de la boleta consolidada (misma forma que la de un documento de venta). */
export type ItemConsolidado = Record<string, unknown> & {
  id: string
  cantidad: number
  precioVenta: number
  subtotal: number
}

/** Items guardados en la venta de una NV (lista vacía si no hay o viene con basura). */
function itemsDe(nv: NvConsolidable | null | undefined): Record<string, unknown>[] {
  const items = nv?.venta?.items
  if (!Array.isArray(items)) return []
  return items.filter((it): it is Record<string, unknown> => Boolean(it) && typeof it === 'object')
}

/**
 * Une los items de varias NV en las líneas de la boleta consolidada.
 *
 * 🔑 **La clave de agrupación incluye el PRECIO y la UNIDAD, no solo el `id`**: dos NV pueden
 * vender el mismo producto a precios distintos (promo que cambió, lista de precios, descuento
 * por producto). Unirlas en una sola línea dejaba un `precioVenta` que **no explicaba el
 * subtotal**, y como el comprobante y el XML declaran `precioVenta × cantidad` (no el subtotal
 * guardado), el importe declarado dejaba de ser el cobrado.
 */
export function consolidarItems(nvs: readonly NvConsolidable[] | null | undefined): ItemConsolidado[] {
  const porClave = new Map<string, ItemConsolidado>()
  for (const nv of nvs ?? []) {
    for (const it of itemsDe(nv)) {
      const cantidad = cantidadDe(it) || 1
      const precio = r2(Number(it.precioVenta ?? it.precio_unitario ?? 0))
      const clave = `${String(it.id ?? '')}|${precio}|${String(it.unidad ?? '')}`
      const bruto = importeBrutoDe(it)
      const previo = porClave.get(clave)
      if (previo) {
        previo.cantidad = r2(previo.cantidad + cantidad)
        previo.subtotal = r2(previo.subtotal + bruto)
        continue
      }
      porClave.set(clave, { ...it, id: String(it.id ?? ''), cantidad, precioVenta: precio, subtotal: bruto })
    }
  }
  return [...porClave.values()]
}

/** Total de la boleta consolidada: la suma de los totales (ya netos) de cada NV. */
export function totalConsolidado(nvs: readonly NvConsolidable[] | null | undefined): number {
  return r2((nvs ?? []).reduce((s, nv) => s + (Number(nv?.venta?.total) || 0), 0))
}

/**
 * Descuento que la boleta consolidada tiene que declarar: la suma de los descuentos de cada NV.
 *
 * Se lee con **`descuentoDeVenta()`** (la regla única: camelCase con respaldo en snake_case), así
 * una NV vieja que solo tenga `descuento_total` también se declara bien. Sin esto la boleta
 * mostraba las líneas a precio de lista contra un total neto, sin fila de descuento.
 */
export function descuentoConsolidado(nvs: readonly NvConsolidable[] | null | undefined): number {
  return r2((nvs ?? []).reduce((s, nv) => s + descuentoDeVenta(nv?.venta as Record<string, unknown> | null | undefined), 0))
}

/** Nombre con el que sale la boleta consolidada si la empresa no configuró otro. */
export const CLIENTE_CONSOLIDADO_POR_DEFECTO = 'CONSUMIDOR FINAL'

/** Documento con el que sale la boleta consolidada si la empresa no configuró otro. */
export const DNI_CONSOLIDADO_POR_DEFECTO = '00000000'

/**
 * 🔑 **Nombre del cliente de la BOLETA CONSOLIDADA** (decisión del usuario, 21/09/2026).
 *
 * Una boleta consolidada agrupa las **notas de venta del día**: no tiene un cliente real, va con
 * documento `00000000` y el nombre es un rótulo. Estaba **fijo** en `'CONSUMIDOR FINAL'` (el
 * consolidador ya leía `config.clienteDefaultNombre`, pero **no había dónde configurarlo**), y hay
 * negocios que prefieren `'VENTAS DEL DÍA'` o `'CLIENTES VARIOS'` para que se entienda en el papel.
 *
 * ⚠️ Ese rótulo **se imprime en la boleta y se declara a SUNAT** como razón social del receptor:
 * cambiarlo es una decisión del negocio (hablarlo con el contador), y vacío **vuelve al valor por
 * defecto** — nunca se manda un nombre en blanco.
 */
export function nombreClienteConsolidado(config?: Record<string, unknown> | null): string {
  const nombre = String(config?.clienteDefaultNombre ?? '').trim()
  return nombre || CLIENTE_CONSOLIDADO_POR_DEFECTO
}

/**
 * Número de documento del receptor de la boleta consolidada (`00000000` = doc. no domina).
 * ⚠️ **Se lee del mismo lugar que el nombre** y por la misma razón: los dos describen al receptor
 * que se declara.
 */
export function documentoClienteConsolidado(config?: Record<string, unknown> | null): string {
  const dni = String(config?.clienteDefaultDni ?? '').trim()
  return dni || DNI_CONSOLIDADO_POR_DEFECTO
}
