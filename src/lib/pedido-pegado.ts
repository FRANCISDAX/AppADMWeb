/**
 * **Pegar el pedido del link en el PDV** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **Qué resuelve**: el pedido del link (`/pedido`) llega al **WhatsApp del negocio** como un texto
 * ordenado (`textoPedido()`, `lib/pedido-publico.ts`). Hasta ahora el cajero lo leía y **cargaba los
 * productos uno por uno** en el PDV. Esto lee ese mismo texto y devuelve las líneas ya resueltas contra
 * el catálogo, listas para crear el pedido (`crearVentaPendiente`) y que aparezca en su panel.
 *
 * 🔑 **La regla que NO se negocia: el precio sale del CATÁLOGO, nunca del texto pegado.** El mensaje
 * dice `2 × GALLETA SODA = S/ 3.00`, pero ese importe **solo se usa para comparar**: si el precio
 * cambió desde que el cliente vio el link, el pedido se arma con el precio de **hoy** y el cajero ve
 * la diferencia (`diferencia`). Aceptar el importe del texto sería dejar que la plata entre por un
 * campo de texto libre —y encima escrito por quien lo pega—, justo lo contrario del invariante del
 * sistema («el precio es final al público y sale del catálogo»).
 *
 * ⚠️ **El nombre del producto es la única llave que trae el mensaje** (el link no manda ids al
 * WhatsApp, y no debería: el cliente no tiene por qué ver el catálogo interno). Por eso la resolución
 * es por **nombre, código o alias** con la **misma tolerancia que el buscador del link**
 * (`buscarEnCatalogo`: sin tildes, plural y todas las palabras) y, cuando hay más de un candidato, se
 * desempata con el **importe del mensaje**. Lo que iguala no se adivina: la línea queda marcada
 * (`sin-producto` / `ambiguo`) y **el cajero decide** —quitarla o corregir el texto y volver a pegar—.
 * Nunca se descarta una línea en silencio: cobrar de menos por un producto que el cliente pidió es
 * peor que pedirle al cajero que mire.
 *
 * 📌 **Verificado contra el generador real**: los tests arman el mensaje con
 * `armarPedido()` + `textoPedido()` (las funciones que lo producen), así que el formato no puede
 * quedar desincronizado con este lector sin que falle un test.
 */

import { CATEGORIA_MANUAL } from './categorias.ts'
import { redondear2 } from './dinero.ts'
import {
  buscarEnCatalogo,
  catalogoPublico,
  normalizar,
  type CatalogoPublico,
  type ItemCatalogoPublico,
} from './pedido-publico.ts'

/** Lo que este módulo necesita de un producto del catálogo real (el resto no se usa). */
export type ProductoParaPegado = {
  id: string
  nombre?: string
  codigo?: string
  categoria?: string
  precioVenta?: number
  precio?: number
  stock?: number
  activo?: boolean
  unidadBase?: string
  aliasVoz?: string
  tipoAfectacion?: string
  isKit?: boolean
  kitItems?: { productoId: string; cantidad: number }[]
}

/** Por qué una línea del mensaje no se pudo usar tal cual. */
export type EstadoLineaPegada = 'ok' | 'sin-producto' | 'ambiguo'

export type LineaPegada = {
  /** La línea del mensaje, tal como llegó (sin los `*` de negrita de WhatsApp). */
  texto: string
  /** Cuántas unidades pidió el cliente. */
  cantidad: number
  /** El nombre tal como lo escribió el link. */
  nombre: string
  /** El importe que dice el mensaje. **Solo para comparar**: no se cobra desde acá. */
  importeMensaje: number
  estado: EstadoLineaPegada
  /** El producto resuelto (solo cuando `estado === 'ok'`). */
  producto?: ProductoParaPegado
  /** Precio por **unidad base** que se va a usar (del catálogo de hoy). */
  precio?: number
  /** Los nombres que empataron, para que el cajero sepa qué corregir. */
  candidatos?: string[]
  /** Pidió más de lo que hay **hoy**: el pedido no reserva stock, así que se avisa (y se valida al cobrar). */
  stockInsuficiente?: boolean
  /** El mensaje dice un importe distinto al del catálogo de hoy (la diferencia se muestra). */
  importeDistinto?: boolean
}

/** Los datos del cliente que vienen en el mensaje. */
export type ClientePegado = {
  nombre: string
  telefono: string
  entrega: 'recojo' | 'delivery'
  direccion?: string
  nota?: string
}

export type PedidoPegado = {
  /** `false` = hay algo que impide crear el pedido tal cual (se explica en `avisos`). */
  ok: boolean
  /** El código que muestra el link (`P-8F3K2`), con el que el cliente cita su pedido. */
  codigo: string
  cliente: ClientePegado
  lineas: LineaPegada[]
  /** El total que dice el mensaje. **Solo para comparar.** */
  totalMensaje: number
  /** El total con los precios del catálogo de hoy (lo que se va a cobrar). */
  total: number
  /** `total − totalMensaje`: `0` = los precios no cambiaron. */
  diferencia: number
  /** Lo que el mensaje decía que había que confirmar por stock. */
  aConfirmarMensaje: string[]
  /** De cuándo eran los precios que el cliente vio (`26/09/2026`), tal como dice el mensaje. */
  citado?: string
  /** Todo lo que el cajero tiene que mirar antes de aceptar, en castellano y sin ruido. */
  avisos: string[]
  /** `true` cuando el texto no parece un pedido del link. */
  desconocido?: boolean
}

/** Un ítem del pedido en el **formato de documento** (el mismo que arma `registrarVenta` y el PDV). */
export type ItemPegado = {
  id: string
  nombre: string
  quantity: number
  cantidad: number
  cantidadEnUnidadBase: number
  precioVenta: number
  subtotal: number
  unidad: string
  presentacionNombre: string
  presentacionId: string
  factorConversion: number
  categoria: string
  tipoAfectacion: string
  usarPrecioEspecial: boolean
  manual?: boolean
  kitItems?: { productoId: string; cantidad: number }[]
}

/** Sin negritas de WhatsApp: el mensaje se arma con `*…*` y el cajero puede pegarlo con o sin ellas. */
const sinMarcas = (t: string) => String(t ?? '').replace(/\*/g, '')

/** Las líneas de producto: `2 × GALLETA SODA = S/ 3.00` (el nombre no puede traer `=`). */
const RX_LINEA = /^(\d{1,4})\s*[×xX]\s*(.+?)\s*=\s*(?:S\/\s*)?([\d.,]+)$/

const RX_PEDIDO = /^PEDIDO\s+(P-[A-Z0-9]{4,10})/i
const RX_CLIENTE = /^Cliente\s*:\s*(.+?)\s*(?:[·|]\s*(.+))?$/i
const RX_ENVIO = /^Entrega\s*:\s*env[íi]o\s*(?:a\s*)?(.*)$/i
const RX_RECOJO = /^Entrega\s*:\s*recojo/i
const RX_TOTAL = /^TOTAL\s*:\s*(?:S\/\s*)?([\d.,]+)/i
/** ⚠️ La línea de aviso arranca con un emoji (`⚠️`), así que se lo come antes de comparar. */
const RX_POR_STOCK = /^[^\p{L}\d]*A confirmar por stock\s*:\s*(.+)$/iu
const RX_NOTA = /^Nota\s*:\s*(.+)$/i
const RX_FECHA = /^Precios del cat[áa]logo al\s*(.+)$/i

/** Las líneas decorativas del mensaje (`—————`, `---`, `===`): no son datos. */
const esSeparador = (t: string) => /^[-—_=·.\s]+$/.test(t)

/**
 * **Un monto escrito por una persona** (`S/ 3.00`, `3,50`, `1,234.50`). La app siempre escribe con
 * punto decimal (`toFixed(2)`), pero el mensaje puede pasar por manos que lo editen.
 */
export function montoPegado(texto: string): number {
  const s = String(texto ?? '').replace(/\s/g, '')
  // Con coma y punto juntos, la coma es de miles (`1,234.50`); sola, es decimal (`3,50`).
  const limpio = s.includes(',') && s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.')
  const n = Number(limpio.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** El teléfono, solo dígitos (el link lo manda así; si alguien lo editó, igual se limpia). */
const soloDigitos = (t: string) => String(t ?? '').replace(/\D/g, '')

/**
 * Empata un nombre del mensaje con un producto del catálogo.
 *
 * Orden: **nombre/código exacto** → **el que cuadra con el importe del mensaje** → **único candidato**.
 * Si queda más de uno, es `ambiguo` (no se elige el primero: elegir por el cajero es inventar).
 */
function resolverProducto(
  catalogo: CatalogoPublico,
  nombre: string,
  cantidad: number,
  importe: number,
): { item?: ItemCatalogoPublico; candidatos: ItemCatalogoPublico[] } {
  const candidatos = buscarEnCatalogo(catalogo, nombre)
  if (candidatos.length === 0) return { candidatos }

  const clave = normalizar(nombre)
  const exactos = candidatos.filter(
    (i) => normalizar(i.nombre) === clave || (i.codigo ? normalizar(i.codigo) === clave : false),
  )
  if (exactos.length === 1) return { item: exactos[0], candidatos }

  // Desempate por el importe: si el mensaje dice `= S/ 3.00` y solo un candidato da eso con esa
  // cantidad, es ese. El importe no se cobra: sirve para reconocer de qué producto hablaba.
  const porImporte = candidatos.filter((i) => redondear2(i.precio * cantidad) === redondear2(importe))
  if (porImporte.length === 1) return { item: porImporte[0], candidatos }

  if (candidatos.length === 1) return { item: candidatos[0], candidatos }
  return { candidatos }
}

/**
 * **Lee el mensaje del link** y devuelve el pedido con cada línea resuelta contra el catálogo real.
 *
 * `productos` es el catálogo del negocio (el que ve el PDV). Se filtra igual que el catálogo público
 * (`catalogoPublico`: afuera inactivos, sin nombre y **sin precio**), así que un producto que ya no se
 * vende **no se puede cargar** por más que el mensaje lo nombre: queda marcado y lo decide el cajero.
 */
export function leerPedidoPegado(
  texto: string,
  productos: readonly ProductoParaPegado[],
  opts: { publicado?: string } = {},
): PedidoPegado {
  const lineas = String(texto ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => sinMarcas(l).trim())
    .filter((l) => l.length > 0)

  const catalogo = catalogoPublico(productos ?? [], { publicado: opts.publicado ?? '' })
  const porId = new Map((productos ?? []).map((p) => [String(p.id), p]))

  let codigo = ''
  let nombreCliente = ''
  let telefono = ''
  let entrega: 'recojo' | 'delivery' = 'recojo'
  let direccion = ''
  let nota = ''
  let citado = ''
  let totalMensaje = 0
  let hayTotal = false
  const aConfirmarMensaje: string[] = []
  const pegadas: LineaPegada[] = []

  for (const l of lineas) {
    if (esSeparador(l)) continue

    const mPedido = RX_PEDIDO.exec(l)
    if (mPedido) {
      codigo = mPedido[1].toUpperCase()
      continue
    }

    const mCliente = RX_CLIENTE.exec(l)
    if (mCliente) {
      nombreCliente = mCliente[1].trim()
      telefono = soloDigitos(mCliente[2] ?? '')
      continue
    }

    if (RX_RECOJO.test(l)) {
      entrega = 'recojo'
      continue
    }
    const mEnvio = RX_ENVIO.exec(l)
    if (mEnvio) {
      entrega = 'delivery'
      direccion = mEnvio[1].trim()
      continue
    }

    const mTotal = RX_TOTAL.exec(l)
    if (mTotal) {
      totalMensaje = montoPegado(mTotal[1])
      hayTotal = true
      continue
    }

    const mStock = RX_POR_STOCK.exec(l)
    if (mStock) {
      aConfirmarMensaje.push(
        ...mStock[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      continue
    }

    const mNota = RX_NOTA.exec(l)
    if (mNota) {
      nota = mNota[1].trim()
      continue
    }

    const mFecha = RX_FECHA.exec(l)
    if (mFecha) {
      citado = mFecha[1].trim()
      continue
    }

    const mLinea = RX_LINEA.exec(l)
    if (mLinea) {
      const cantidad = Math.max(1, Math.floor(montoPegado(mLinea[1])))
      const nombre = mLinea[2].trim()
      const importeMensaje = montoPegado(mLinea[3])
      const { item, candidatos } = resolverProducto(catalogo, nombre, cantidad, importeMensaje)

      if (!item) {
        // Más de un candidato = **ambiguo** (se muestra cuáles son); ninguno = el producto no está
        // en el catálogo vendible. En los dos casos el cajero decide: nunca se elige por él.
        pegadas.push({
          texto: l,
          cantidad,
          nombre,
          importeMensaje,
          estado: candidatos.length > 1 ? 'ambiguo' : 'sin-producto',
          ...(candidatos.length > 0 ? { candidatos: candidatos.map((c) => c.nombre) } : {}),
        })
        continue
      }

      const producto = porId.get(item.id)
      if (!producto) {
        pegadas.push({ texto: l, cantidad, nombre, importeMensaje, estado: 'sin-producto' })
        continue
      }

      const stock = Math.max(0, Math.floor(Number(producto.stock ?? item.stock ?? 0) || 0))
      pegadas.push({
        texto: l,
        cantidad,
        nombre,
        importeMensaje,
        estado: 'ok',
        producto,
        precio: item.precio,
        ...(cantidad > stock ? { stockInsuficiente: true } : {}),
        ...(redondear2(item.precio * cantidad) !== redondear2(importeMensaje) ? { importeDistinto: true } : {}),
      })
      continue
    }

    // Una línea que no reconocemos no se inventa: se ignora, pero el pedido no queda "sin aviso".
  }

  const desconocido = !codigo && pegadas.length === 0

  const total = redondear2(
    pegadas.reduce((s, p) => s + (p.estado === 'ok' && p.precio ? p.precio * p.cantidad : 0), 0),
  )
  const sumaLineas = redondear2(pegadas.reduce((s, p) => s + p.importeMensaje, 0))
  const diferencia = redondear2(total - totalMensaje)

  const avisos: string[] = []
  const sinResolver = pegadas.filter((p) => p.estado !== 'ok')
  if (sinResolver.length > 0) {
    avisos.push(
      `No se pudieron identificar ${sinResolver.length} producto(s): ${sinResolver.map((p) => `«${p.nombre}»`).join(', ')}. Corregí el nombre en el texto o quitá la línea para cargar el resto.`,
    )
  }
  const ambiguas = pegadas.filter((p) => p.estado === 'ambiguo')
  for (const a of ambiguas) {
    avisos.push(`«${a.nombre}» coincide con más de un producto: ${(a.candidatos ?? []).join(' / ')}.`)
  }
  const sinStock = pegadas.filter((p) => p.stockInsuficiente)
  if (sinStock.length > 0) {
    avisos.push(
      `Hoy no alcanza el stock de: ${sinStock.map((p) => p.producto?.nombre ?? p.nombre).join(', ')}. El pedido no reserva stock: se valida al cobrar.`,
    )
  }
  if (hayTotal && sumaLineas !== totalMensaje) {
    avisos.push(
      `El mensaje se contradice: sus líneas suman S/ ${sumaLineas.toFixed(2)} y el TOTAL dice S/ ${totalMensaje.toFixed(2)}.`,
    )
  }
  if (hayTotal && diferencia !== 0) {
    avisos.push(
      diferencia > 0
        ? `Los precios subieron desde que el cliente vio el link: el mensaje dice S/ ${totalMensaje.toFixed(2)} y con los precios de hoy son S/ ${total.toFixed(2)} (S/ ${diferencia.toFixed(2)} más).`
        : `Los precios bajaron desde que el cliente vio el link: el mensaje dice S/ ${totalMensaje.toFixed(2)} y con los precios de hoy son S/ ${total.toFixed(2)} (S/ ${Math.abs(diferencia).toFixed(2)} menos).`,
    )
  }
  if (desconocido) {
    avisos.push(
      'No parece un pedido del link: pegá el mensaje completo (el que empieza con *PEDIDO P-…*).',
    )
  }

  return {
    ok: !desconocido && pegadas.length > 0 && sinResolver.length === 0,
    codigo,
    cliente: {
      nombre: nombreCliente,
      telefono,
      entrega,
      ...(direccion ? { direccion } : {}),
      ...(nota ? { nota } : {}),
    },
    lineas: pegadas,
    totalMensaje,
    total,
    diferencia,
    aConfirmarMensaje,
    ...(citado ? { citado } : {}),
    avisos,
    ...(desconocido ? { desconocido: true } : {}),
  }
}

/**
 * **Los ítems del pedido**, en el formato de documento del PDV (el mismo de `registrarVenta`).
 *
 * `excluidas` son las líneas que el cajero decidió **no** cargar (porque el producto ya no está o no
 * se pudo identificar) y `envio` la línea manual del envío, si le cobra algo: el link no cotiza el
 * flete, así que esa plata la decide el negocio —y va como ítem manual, igual que en el PDV—.
 */
export function itemsDelPegado(
  pegado: PedidoPegado,
  opts: {
    /** Índices de `pegado.lineas` que NO se cargan (los eligió el cajero, con los ojos en la pantalla). */
    excluidas?: readonly number[]
    /** Afectación por defecto del negocio (ítem manual / producto sin la suya). */
    afectacionPorDefecto: string
    /** Costo de envío a cobrar (0 = no se agrega línea). */
    envio?: { costo: number; afectacion?: string } | null
  },
): { items: ItemPegado[]; total: number } {
  const fuera = new Set(opts.excluidas ?? [])
  const items: ItemPegado[] = []

  pegado.lineas.forEach((l, i) => {
    if (fuera.has(i) || l.estado !== 'ok' || !l.producto || l.precio == null) return
    const p = l.producto
    const precio = l.precio
    const cantidad = l.cantidad
    const base = {
      id: String(p.id),
      nombre: String(p.nombre ?? l.nombre),
      // El carrito usa `quantity` y el documento `cantidad`: la venta del link es por **unidad base**.
      quantity: cantidad,
      cantidad,
      cantidadEnUnidadBase: cantidad,
      precioVenta: precio,
      subtotal: redondear2(precio * cantidad),
      unidad: String(p.unidadBase ?? 'Unidad') || 'Unidad',
      presentacionNombre: String(p.unidadBase ?? 'Unidad') || 'Unidad',
      presentacionId: 'unidad',
      factorConversion: 1,
      categoria: String(p.categoria ?? ''),
      // ⚠️ La afectación es la del PRODUCTO: sin esto el pedido se declararía GRAVADO ('10') aunque
      // el producto sea exonerado ('20') —es el bug del 18/09/2026— y el comprobante cobraría un IGV
      // que nadie pagó.
      tipoAfectacion: String(p.tipoAfectacion || opts.afectacionPorDefecto),
      // El link cotiza **precio de lista** (no aplica la promo de volumen): el pedido es una
      // cotización y no se recalcula con las promos del día.
      usarPrecioEspecial: false,
    }
    // Un kit tiene que viajar con sus componentes: el stock se descuenta por componente al cobrar.
    if (p.isKit && p.kitItems?.length) {
      items.push({ ...base, kitItems: p.kitItems.map((k) => ({ productoId: k.productoId, cantidad: k.cantidad })) })
      return
    }
    items.push(base)
  })

  const costoEnvio = redondear2(Number(opts.envio?.costo ?? 0) || 0)
  if (costoEnvio > 0) {
    items.push({
      id: 'envio',
      nombre: 'Envío a domicilio',
      quantity: 1,
      cantidad: 1,
      cantidadEnUnidadBase: 1,
      precioVenta: costoEnvio,
      subtotal: costoEnvio,
      unidad: 'Unidad',
      presentacionNombre: 'Unidad',
      presentacionId: 'unidad',
      factorConversion: 1,
      categoria: CATEGORIA_MANUAL,
      tipoAfectacion: String(opts.envio?.afectacion || opts.afectacionPorDefecto),
      usarPrecioEspecial: false,
      manual: true,
    })
  }

  return { items, total: redondear2(items.reduce((s, i) => s + i.subtotal, 0)) }
}
