/**
 * **Pedido por link** — módulo puro (catálogo público + armado del pedido).
 *
 * 🔑 **Qué es esto**: la vidriera que el negocio comparte por WhatsApp. El cliente abre el link, arma su
 * pedido y lo manda; **el pedido no entra solo al sistema** (eso es la fase 2, con el backend publicado):
 * llega al WhatsApp del negocio como **texto ordenado** y el cajero lo arma en el PDV, donde ya existe todo
 * el circuito de pedidos (`crearVentaPendiente` → `PanelVentasPendientes` → `cobrarVentaPendiente`).
 *
 * ⚠️ **Lo único que este módulo NO puede permitir**: que el precio venga del navegador. Los precios salen
 * **siempre del catálogo publicado** (`precioDeItem`), nunca de lo que mande el cliente; el total se recalcula
 * acá. Es la misma regla que el PDV: el precio es **final al público** y no se negocia desde afuera.
 *
 * ⚠️ **El catálogo es una FOTO** (`publicado`): el link muestra de cuándo son esos precios y el texto del
 * pedido lo lleva escrito, para que nadie discuta un precio viejo. Se regenera con `npm run catalogo`.
 *
 * Módulo puro (sin Firebase ni React): se prueba con el runner nativo de Node (`npm test`).
 */

import { redondear2 } from './dinero.ts'

/** Un ítem de la vidriera: lo mínimo para que alguien pida (sin costos, sin proveedor, sin afectación). */
export type ItemCatalogoPublico = {
  id: string
  nombre: string
  codigo?: string
  categoria?: string
  /** Precio **final al público** en soles (con IGV incluido si el producto es gravado). */
  precio: number
  unidad?: string
  /** Stock que había **cuando se publicó** el catálogo. `0` = agotado (se ve, no se puede pedir). */
  stock: number
  imagen?: string
  /**
   * **Cómo lo busca la gente** (el `aliasVoz` del producto): «gaseosa», «agua», «chela»… Los productos están
   * nombrados por marca («Coca Cola 1LT»), así que sin alias el cliente que escribe el genérico **no encuentra
   * nada** (medido en el navegador: «gaseosa» daba 0 resultados). No se muestra: solo ayuda a encontrar.
   */
  alias?: string
}

/** El catálogo publicado: la foto que baja el link (`public/catalogo.json`). */
export type CatalogoPublico = {
  /** Cuándo se publicó (ISO). El link lo muestra: los precios son de ese momento. */
  publicado: string
  negocio?: string
  /** WhatsApp del negocio, **solo dígitos con código de país** (`51987654321`), para el botón de enviar. */
  whatsapp?: string
  items: ItemCatalogoPublico[]
}

/** Lo que se puede pedir de un ítem en un solo pedido (evita el dedo pegado en el `+`). */
export const MAX_UNIDADES_POR_ITEM = 50

/** El producto de la app, reducido a lo que el catálogo público necesita (no se importa el tipo de React). */
type ProductoParaCatalogo = {
  id: string
  nombre?: string
  codigo?: string
  categoria?: string
  precioVenta?: number
  precio?: number
  stock?: number
  activo?: boolean
  unidadBase?: string
  imagen?: string
  /** Alias de búsqueda que ya tiene el producto (se usa en la búsqueda por voz). */
  aliasVoz?: string
}

/** Solo se publica una imagen si es una **URL corta**: una foto en base64 dentro del JSON lo haría pesar MB. */
const imagenPublicable = (imagen?: string): string | undefined => {
  const v = String(imagen ?? '').trim()
  if (!v || v.length > 400 || !/^https?:\/\//i.test(v)) return undefined
  return v
}

/**
 * **Arma el catálogo público desde los productos del negocio.**
 *
 * Deja afuera lo que no se puede vender: inactivos, sin nombre y **sin precio** (un producto sin precio no se
 * ofrece: inventarle un `0` sería venderlo gratis). El stock negativo se aplana a `0` y el precio se redondea
 * a 2 decimales.
 *
 * ⚠️ **Las fotos en base64 (`data:image/…`) NO se publican**: las que tiene cargadas el negocio son data-URI y
 * metidas en el JSON lo hacían pesar **8 MB** (medido: 38 ítems ⇒ 8,2 MB), imposible de abrir desde un celular
 * con datos. Solo viaja una imagen si algún día es una URL corta.
 */
export function catalogoPublico(
  productos: readonly ProductoParaCatalogo[],
  opts: { publicado: string; negocio?: string; whatsapp?: string },
): CatalogoPublico {
  const items: ItemCatalogoPublico[] = []
  for (const p of productos ?? []) {
    if (!p || p.activo === false) continue
    const nombre = String(p.nombre ?? '').trim()
    const precio = redondear2(Number(p.precioVenta ?? p.precio ?? 0) || 0)
    if (!p.id || !nombre || precio <= 0) continue
    const imagen = imagenPublicable(p.imagen)
    items.push({
      id: String(p.id),
      nombre,
      ...(p.codigo ? { codigo: String(p.codigo) } : {}),
      ...(p.categoria ? { categoria: String(p.categoria) } : {}),
      precio,
      ...(p.unidadBase ? { unidad: String(p.unidadBase) } : {}),
      stock: Math.max(0, Math.floor(Number(p.stock ?? 0) || 0)),
      ...(imagen ? { imagen } : {}),
      ...(String(p.aliasVoz ?? '').trim() ? { alias: String(p.aliasVoz).trim().toLowerCase() } : {}),
    })
  }
  items.sort(
    (a, b) =>
      String(a.categoria ?? '').localeCompare(String(b.categoria ?? '')) || a.nombre.localeCompare(b.nombre),
  )
  return {
    publicado: opts.publicado,
    ...(opts.negocio ? { negocio: opts.negocio } : {}),
    ...(opts.whatsapp ? { whatsapp: opts.whatsapp } : {}),
    items,
  }
}

/**
 * Sin tildes y en minúsculas: buscar «galleta» tiene que encontrar «GALLETA» y «Galletas».
 * **Es la regla única de comparación de nombres**: la usa el buscador del link y también el lector
 * del pedido pegado en el PDV (`lib/pedido-pegado.ts`), para que el nombre que el cliente vio en el
 * link sea el que el cajero puede resolver.
 */
export const normalizar = (t: string) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()

/**
 * Un cliente escribe en plural («galletas», «bebidas») y el producto puede estar en singular: si la palabra
 * termina en `s` y tiene más de 3 letras, se busca también sin la `s`. Sin esto, el link parecía vacío.
 */
const singular = (palabra: string) =>
  palabra.length > 3 && palabra.endsWith('s') ? palabra.slice(0, -1) : palabra

/**
 * El buscador de la vidriera: por **nombre, código, categoría o alias**, y **todas** las palabras que escribió el
 * cliente tienen que aparecer (así «galleta soda» no trae todas las galletas). Vacío = todo el catálogo.
 *
 * 🔑 **El alias es lo que hace encontrable el genérico**: los productos están por marca («Coca Cola 1LT»), así
 * que un cliente que escribe «gaseosa» no encontraba nada hasta que el producto tiene ese alias cargado.
 */
export function buscarEnCatalogo(catalogo: CatalogoPublico, texto: string): ItemCatalogoPublico[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean)
  const items = catalogo?.items ?? []
  if (palabras.length === 0) return items
  return items.filter((i) => {
    const pajar = normalizar(`${i.nombre} ${i.codigo ?? ''} ${i.categoria ?? ''} ${i.alias ?? ''}`)
    return palabras.every((p) => pajar.includes(p) || pajar.includes(singular(p)))
  })
}

/** Una línea del carrito del cliente: `id` del catálogo + cuántos quiere. */
export type LineaPedido = { id: string; cantidad: number }

/** El precio del catálogo. **Es la única fuente de precio**: lo que mande el navegador no se lee. */
export function precioDeItem(catalogo: CatalogoPublico, id: string): number | null {
  const item = (catalogo?.items ?? []).find((i) => i.id === id)
  return item ? item.precio : null
}

/** Lo que saldría el pedido, con los precios del catálogo (antes de pedir los datos del cliente). */
export function totalPedido(catalogo: CatalogoPublico, lineas: readonly LineaPedido[]): number {
  let total = 0
  for (const l of lineas ?? []) {
    const precio = precioDeItem(catalogo, l.id)
    if (precio === null) continue
    total += precio * cantidadValida(l.cantidad)
  }
  return redondear2(total)
}

/** Cantidad utilizable: entero entre 1 y el tope. Lo que no sirve vale 0 (se ignora). */
function cantidadValida(cantidad: unknown): number {
  const n = Math.floor(Number(cantidad) || 0)
  if (n < 1) return 0
  return Math.min(n, MAX_UNIDADES_POR_ITEM)
}

/** Los datos que deja el cliente en el link. */
export type DatosCliente = {
  nombre: string
  telefono: string
  entrega: 'recojo' | 'delivery'
  direccion?: string
  nota?: string
  /** Código corto que muestra el link para citar el pedido (`P-…`), lo genera la pantalla. */
  codigo: string
}

/** Un pedido listo para mandar, con los precios ya resueltos contra el catálogo. */
export type PedidoPublico = {
  codigo: string
  nombre: string
  telefono: string
  entrega: 'recojo' | 'delivery'
  direccion?: string
  nota?: string
  items: { id: string; nombre: string; cantidad: number; precio: number; importe: number }[]
  total: number
  /** Ítems que superan el stock publicado: el negocio los confirma antes de preparar. */
  aConfirmar: string[]
  /** De cuándo son los precios que se están citando. */
  publicado: string
}

export type ResultadoPedido =
  | { ok: true; pedido: PedidoPublico }
  | { ok: false; error: string }

/** Un código corto para citar el pedido (`P-8F3K2`). `semilla` lo pasa la pantalla (`Date.now()`). */
export function codigoPedidoPublico(semilla: string | number): string {
  const s = String(semilla ?? '')
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 60466176 // 36^5
  const alfabeto = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let out = ''
  for (let i = 0; i < 5; i++) {
    out = alfabeto[h % 36] + out
    h = Math.floor(h / 36)
  }
  return `P-${out}`
}

/**
 * **Arma el pedido**: valida los datos del cliente, resuelve cada línea contra el catálogo, recalcula el total
 * y marca lo que hay que confirmar por stock.
 *
 * ⚠️ **Nada de esto es una venta**: el pedido es un mensaje. El comprobante, el stock y la plata siguen
 * pasando por el PDV, como con cualquier pedido del vendedor.
 */
export function armarPedido(
  catalogo: CatalogoPublico,
  lineas: readonly LineaPedido[],
  datos: DatosCliente,
): ResultadoPedido {
  const nombre = String(datos.nombre ?? '').trim()
  if (nombre.length < 3) return { ok: false, error: 'Escribí tu nombre (mínimo 3 letras).' }

  const telefono = String(datos.telefono ?? '').replace(/\D/g, '')
  if (telefono.length < 6 || telefono.length > 15) {
    return { ok: false, error: 'Escribí un teléfono al que te podamos llamar (6 a 15 dígitos).' }
  }

  const direccion = String(datos.direccion ?? '').trim()
  if (datos.entrega === 'delivery' && direccion.length < 5) {
    return { ok: false, error: 'Para enviarlo, escribí la dirección.' }
  }

  const items: PedidoPublico['items'] = []
  const aConfirmar: string[] = []
  for (const l of lineas ?? []) {
    const item = (catalogo?.items ?? []).find((i) => i.id === l.id)
    if (!item) continue // un ítem que ya no está en el catálogo no se pide (y no se le inventa precio)
    const cantidad = cantidadValida(l.cantidad)
    if (cantidad === 0) continue
    if (item.stock <= 0 || cantidad > item.stock) aConfirmar.push(item.nombre)
    items.push({
      id: item.id,
      nombre: item.nombre,
      cantidad,
      precio: item.precio,
      importe: redondear2(item.precio * cantidad),
    })
  }
  if (items.length === 0) return { ok: false, error: 'Tu pedido está vacío (o los productos ya no están disponibles).' }

  const total = redondear2(items.reduce((s, i) => s + i.importe, 0))
  const codigo = String(datos.codigo ?? '').trim() || codigoPedidoPublico(`${nombre}${telefono}${total}`)
  const nota = String(datos.nota ?? '').trim()

  return {
    ok: true,
    pedido: {
      codigo,
      nombre,
      telefono,
      entrega: datos.entrega === 'delivery' ? 'delivery' : 'recojo',
      ...(direccion ? { direccion } : {}),
      ...(nota ? { nota } : {}),
      items,
      total,
      aConfirmar,
      publicado: String(catalogo?.publicado ?? ''),
    },
  }
}

/** El monto como lo escribe un cliente: `S/ 5.50`. */
const soles = (n: number) => `S/ ${Number(n || 0).toFixed(2)}`

/** `2026-09-26T…` → `26/09/2026` (la fecha que ve el cliente, en local). */
export function fechaPublicacion(iso?: string): string {
  const d = new Date(String(iso ?? ''))
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/**
 * **El texto que le llega al negocio por WhatsApp.** Está escrito para que se lea de un vistazo en el celular y
 * para que el cajero lo pueda pasar al PDV sin interpretar nada: cantidades, productos, total y **de cuándo son
 * los precios**.
 */
export function textoPedido(pedido: PedidoPublico, catalogo?: CatalogoPublico): string {
  const lineas: string[] = []
  lineas.push(`*PEDIDO ${pedido.codigo}*${catalogo?.negocio ? ` · ${catalogo.negocio}` : ''}`)
  lineas.push(`Cliente: ${pedido.nombre} · ${pedido.telefono}`)
  lineas.push(pedido.entrega === 'delivery' ? `Entrega: ENVÍO a ${pedido.direccion ?? ''}` : 'Entrega: recojo en tienda')
  lineas.push('—————')
  for (const i of pedido.items) lineas.push(`${i.cantidad} × ${i.nombre} = ${soles(i.importe)}`)
  lineas.push('—————')
  lineas.push(`*TOTAL: ${soles(pedido.total)}* (${pedido.items.length} ${pedido.items.length === 1 ? 'producto' : 'productos'})`)
  if (pedido.aConfirmar.length > 0) {
    lineas.push(`⚠️ A confirmar por stock: ${pedido.aConfirmar.join(', ')}`)
  }
  if (pedido.nota) lineas.push(`Nota: ${pedido.nota}`)
  const fecha = fechaPublicacion(pedido.publicado)
  if (fecha) lineas.push(`Precios del catálogo al ${fecha}`)
  return lineas.join('\n')
}

/**
 * **El enlace de WhatsApp** con el pedido ya escrito. Devuelve `''` si el negocio no cargó su número: la
 * pantalla, en ese caso, ofrece copiar el texto (así el link nunca queda sin salida).
 */
export function enlaceWhatsApp(pedido: PedidoPublico, catalogo?: CatalogoPublico): string {
  const numero = String(catalogo?.whatsapp ?? '').replace(/\D/g, '')
  if (!numero) return ''
  return `https://wa.me/${numero}?text=${encodeURIComponent(textoPedido(pedido, catalogo))}`
}
