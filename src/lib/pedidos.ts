/**
 * Reparto de pedidos por caja — **módulo puro** (sin imports, testeable con `npm test`).
 *
 * Un pedido (venta que un vendedor manda a caja) lleva `cajaId`: la caja **a la que va**. Cada
 * cajero trabaja con la suya y debe ver sus pedidos; pero la lista **no puede quedar ciega**
 * por una configuración, así que la regla es explícita:
 *
 *   - **Sin caja asignada** (usuario sin `cajaId`): ve **todos** los pedidos.
 *   - **Con caja**: ve los de su caja **y** los que no tienen caja (van a cualquiera).
 *   - Los pedidos de **otra caja** se separan en `otrasCajas`: no se esconden —se muestran
 *     aparte, para poder rescatarlos si esa caja se cayó— pero se distinguen, porque cobrarlos
 *     emite con **la serie de la caja que cobra**, no con la del pedido.
 *
 * ⚠️ **Por qué existe esto** (caso real, 17/09/2026): la lista filtraba en Firestore por la caja
 * del cajero, así que un cajero **sin caja** veía todo vacío y un pedido creado por un vendedor
 * **sin caja** (`cajaId: ''`) no lo veía nadie aunque el cajero tuviera la suya. Y con dos cajas,
 * si la caja 2 se cae con pedidos abiertos, esos pedidos quedan varados salvo que alguien los
 * transfiera (acción de admin) o que otra caja pueda cobrarlos.
 */

export type PedidoConCaja = { cajaId?: string | null; fecha?: string | null }

export type RepartoPedidos<T extends PedidoConCaja> = {
  /** Los que este usuario debe atender: su caja, los sin caja, o todos si no tiene caja. */
  mios: T[]
  /** Los de otra caja: se muestran aparte (rescate), nunca se ocultan en silencio. */
  otrasCajas: T[]
}

/**
 * Reparte los pedidos según la caja del usuario. No ordena: el orden lo decide quien consulta.
 */
export function repartirPedidos<T extends PedidoConCaja>(pedidos: T[] | null | undefined, cajaId?: string | null): RepartoPedidos<T> {
  const lista = Array.isArray(pedidos) ? pedidos : []
  const mia = (cajaId || '').trim()

  // Sin caja asignada: ve todo. Es preferible mostrar de más que dejar una venta sin cobrar.
  if (!mia) return { mios: lista, otrasCajas: [] }

  const mios: T[] = []
  const otrasCajas: T[] = []
  for (const p of lista) {
    const suya = (p?.cajaId || '').trim()
    if (!suya || suya === mia) mios.push(p)
    else otrasCajas.push(p)
  }
  return { mios, otrasCajas }
}

/** Nombre legible de una caja para los avisos (el id es un slug: `caja_02` → `caja 02`). */
export function nombreCaja(cajaId?: string | null): string {
  const id = (cajaId || '').trim()
  if (!id) return 'sin caja'
  return id.replace(/_/g, ' ')
}

/** Aviso para la confirmación al cobrar un pedido de otra caja. */
export function avisoOtraCaja(cajaPedido?: string | null, cajaMia?: string | null): string {
  return `Este pedido es de la ${nombreCaja(cajaPedido)} y se va a emitir con la serie de tu ${nombreCaja(cajaMia)}.`
}
