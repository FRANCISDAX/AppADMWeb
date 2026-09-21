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

// ─── Cobrar un pedido desde el carrito ("modo pedido") ───────────────────────────────────────

/** Línea de un pedido tal como se muestra en el carrito (solo lectura). */
export type ItemPedidoEnCarrito = { nombre: string; cantidad: number; precio: number }

/**
 * Lo que el carrito necesita para cobrar un pedido sin recalcularlo.
 *
 * 🔑 **`total` es el cotizado por el vendedor** (`venta.total`), no la suma de las líneas: el
 * pedido congela lo que se le prometió al cliente (con sus promos y descuentos del momento) y el
 * cajero cobra **eso**. Recalcularlo con las promociones vigentes haría que el mostrador cobre
 * un precio distinto al pactado.
 */
export type PedidoEnCarrito = {
  id: string
  codigo: string
  vendedor: string
  total: number
  cajaId: string
  clienteDni: string
  clienteNombre: string
  items: ItemPedidoEnCarrito[]
  /**
   * Descuento que ya trae el pedido (promociones de volumen, de producto, cliente o manual):
   * `total` ya viene neto, así que el cajero tiene que **ver** que hay un descuento aplicado
   * (si no, el precio unitario de la línea —precio de lista— no explica el total).
   */
  descuento: number
  /** Envío a domicilio cargado por el vendedor (si lo hay): el cajero lo hereda. */
  envio: { tipo?: string; direccion?: string; referencia?: string; zonaId?: string; costo?: number; notas?: string } | null
}

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const numero = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Convierte el documento de un pedido en lo que muestra el carrito. **No inventa nada.** */
export function pedidoParaCarrito(doc: {
  id?: unknown
  serieNumero?: unknown
  vendedorNombre?: unknown
  cajaId?: unknown
  venta?: { total?: unknown; descuentoTotal?: unknown; descuento_total?: unknown; cliente_dni?: unknown; cliente_nombre?: unknown; items?: unknown; envio?: unknown } | null
} | null | undefined): PedidoEnCarrito {
  const venta = doc?.venta ?? {}
  const items = Array.isArray(venta.items) ? venta.items : []
  return {
    id: texto(doc?.id),
    codigo: texto(doc?.serieNumero) || texto(doc?.id),
    vendedor: texto(doc?.vendedorNombre),
    total: numero(venta.total),
    // `descuento_total` (snake) es como lo guardaban los pedidos antes del 18/09/2026.
    descuento: numero(venta.descuentoTotal) || numero(venta.descuento_total),
    cajaId: texto(doc?.cajaId),
    clienteDni: texto(venta.cliente_dni),
    clienteNombre: texto(venta.cliente_nombre),
    envio: (venta.envio && typeof venta.envio === 'object' ? venta.envio : null) as PedidoEnCarrito['envio'],
    items: items.map((it) => {
      const linea = (it ?? {}) as { nombre?: unknown; quantity?: unknown; cantidad?: unknown; precioVenta?: unknown }
      return {
        nombre: texto(linea.nombre) || 'Producto',
        cantidad: numero(linea.quantity) || numero(linea.cantidad),
        precio: numero(linea.precioVenta),
      }
    }),
  }
}

/** Texto del cliente para el aviso del carrito (`Juan Pérez · DNI 12345678`), o `''`. */
export function clienteDelPedido(p: PedidoEnCarrito): string {
  const doc = p.clienteDni ? `${p.clienteDni.length === 11 ? 'RUC' : 'DNI'} ${p.clienteDni}` : ''
  return [p.clienteNombre, doc].filter(Boolean).join(' · ')
}

// ─── Pedidos duplicados ──────────────────────────────────────────────────────────────────────
//
// 📌 **Caso real (18/09/2026)**: un vendedor enviaba la venta a caja y, si el aviso tardaba o
// volvía a cargar los mismos productos, terminaba creando **dos pedidos idénticos** (`PED-000123`
// y `PED-000124`). El cajero cobraba uno y el otro quedaba pendiente para siempre: en la lista
// parecía "un pedido ya procesado que sigue apareciendo" y el stock se descontaba una sola vez,
// pero el pedido colgado confundía a la caja.
//
// La defensa es **detectar y avisar, no bloquear**: si el mismo vendedor envía exactamente la
// misma venta dentro de una ventana corta, el sistema avisa cuál es el pedido que ya existe y
// pide confirmación — porque una venta legítimamente igual (otro cliente, los mismos productos)
// tiene que poder enviarse.

/** Minutos dentro de los cuales un pedido idéntico se considera un reenvío y no una venta nueva. */
export const VENTANA_DUPLICADO_MINUTOS = 15

/** Item tal como llega desde el carrito o desde el documento, para calcular la huella. */
export type ItemParaHuella = {
  id?: unknown
  nombre?: unknown
  cantidad?: unknown
  quantity?: unknown
  precioVenta?: unknown
}

/** Valor normalizado para comparar: texto recortado, números a dos decimales. */
function norm(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.round(v * 100) / 100)
  return ''
}

/**
 * **Huella de un pedido**: identifica la misma venta enviada por el mismo vendedor, con
 * independencia de la hora y del orden en que se cargaron los productos.
 *
 * Incluye vendedor, total y las líneas (producto, cantidad y precio). **No** incluye la fecha —
 * es justamente lo que hay que ignorar para detectar un reenvío— ni el cliente: si el vendedor
 * reenvía la misma venta habiendo corregido el cliente, sigue siendo el mismo pedido.
 */
export function huellaPedido({
  vendedorId,
  items,
  total,
}: {
  vendedorId?: string | null
  items?: readonly ItemParaHuella[] | null
  total?: number | null
}): string {
  const lineas = (items ?? [])
    .map((it) =>
      [
        norm(it?.id) || norm(it?.nombre),
        norm(it?.cantidad) || norm(it?.quantity),
        norm(it?.precioVenta),
      ].join('~'),
    )
    .filter((linea) => linea.replace(/~/g, '') !== '')
    .sort()
  return [norm(vendedorId), norm(total), ...lineas].join('|')
}

/** Pedido pendiente, con lo mínimo para compararlo contra uno nuevo. */
export type PedidoParaDuplicado = {
  id?: string
  serieNumero?: string
  vendedorId?: string
  estado?: string
  fecha?: string
  /** Huella guardada al crear el pedido (los pedidos viejos no la tienen). */
  huella?: string
  venta?: { items?: unknown; total?: unknown } | null
}

/**
 * Devuelve el pedido **idéntico y todavía pendiente** que ese vendedor envió dentro de la ventana,
 * o `null` si no hay ninguno. Es la regla que usa la capa de servicios antes de crear un pedido.
 *
 * Los pedidos creados antes de que existiera la huella se comparan recalculándola con la misma
 * función (misma regla, mismos datos), así la comprobación también cubre lo ya enviado.
 */
export function pedidoDuplicado(
  pendientes: readonly PedidoParaDuplicado[] | null | undefined,
  candidato: { vendedorId?: string | null; huella: string; ahora?: Date; ventanaMinutos?: number },
): PedidoParaDuplicado | null {
  const ventana = (candidato.ventanaMinutos ?? VENTANA_DUPLICADO_MINUTOS) * 60000
  const ahora = (candidato.ahora ?? new Date()).getTime()
  const vendedor = norm(candidato.vendedorId)

  for (const pedido of pendientes ?? []) {
    if (norm(pedido?.vendedorId) !== vendedor) continue
    if ((pedido?.estado || 'pendiente') !== 'pendiente') continue

    const huella =
      norm(pedido?.huella) ||
      huellaPedido({
        vendedorId: pedido?.vendedorId,
        items: (Array.isArray(pedido?.venta?.items) ? pedido?.venta?.items : []) as ItemParaHuella[],
        total: Number(pedido?.venta?.total) || 0,
      })
    if (huella !== candidato.huella) continue

    // Fuera de la ventana se considera una venta nueva (el mismo cliente puede volver a comprar lo mismo).
    const fecha = Date.parse(norm(pedido?.fecha))
    if (Number.isFinite(fecha) && ahora - fecha > ventana) continue

    return pedido
  }
  return null
}
