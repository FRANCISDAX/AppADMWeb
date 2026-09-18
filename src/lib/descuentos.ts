export type DescuentoProducto = {
  porcentaje: number
  montoUnitario: number
  subtotalSinDescuento: number
  subtotalConDescuento: number
}

export type DescuentoVolumen = {
  promocionId: string
  nombre: string
  tipo: '3x2' | '2da_50' | 'lleva_paga' | 'porcentaje' | 'monto_fijo'
  valor?: number
  descuento: number
  productos: string[]
}

export type DescuentoCupon = {
  codigo: string
  tipo: 'porcentaje' | 'monto'
  valor: number
  descuento: number
}

export type DescuentoCliente = {
  porcentaje: number
  descuento: number
}

export type DescuentoGlobal = {
  tipo: 'porcentaje' | 'monto'
  valor: number
  descuento: number
}

export type ResumenDescuentos = {
  porProducto: DescuentoProducto[]
  volumen: DescuentoVolumen[]
  cliente: DescuentoCliente | null
  global: DescuentoGlobal | null
  totalDescuento: number
  totalBruto: number
  totalFinal: number
}

type ItemCarrito = {
  productoId: string
  nombre: string
  precioUnitario: number
  cantidad: number
  tienePromo?: boolean
  precioEspecial?: number
  descuentoPorcentaje?: number
}

/** Precio unitario efectivo considerando promo y descuento por producto. */
export function precioUnitarioEfectivo(item: ItemCarrito): number {
  let base = item.tienePromo && (item.precioEspecial ?? 0) > 0
    ? item.precioEspecial ?? 0
    : item.precioUnitario
  if ((item.descuentoPorcentaje ?? 0) > 0) {
    base = base * (1 - (item.descuentoPorcentaje ?? 0) / 100)
  }
  return Math.round(base * 100) / 100
}

/** Descuento por producto individual. */
export function calcDescuentoProducto(item: ItemCarrito): DescuentoProducto {
  const subtotalSin = item.precioUnitario * item.cantidad
  const precioEfectivo = precioUnitarioEfectivo(item)
  const subtotalCon = precioEfectivo * item.cantidad
  return {
    porcentaje: item.descuentoPorcentaje ?? 0,
    montoUnitario: Math.round((item.precioUnitario - precioEfectivo) * 100) / 100,
    subtotalSinDescuento: subtotalSin,
    subtotalConDescuento: subtotalCon,
  }
}

/** Reglas de volumen predefinidas. */
export function calcDescuentoVolumen(
  items: ItemCarrito[],
  reglas: DescuentoVolumen[],
): { descuento: number; aplicados: DescuentoVolumen[] } {
  let total = 0
  const aplicados: DescuentoVolumen[] = []
  for (const regla of reglas) {
    const itemsRegla = items.filter((it) => regla.productos.includes(it.productoId))
    const cantidadTotal = itemsRegla.reduce((s, it) => s + it.cantidad, 0)
    if (cantidadTotal < 2) continue

    if (regla.tipo === '3x2') {
      const grupos = Math.floor(cantidadTotal / 3)
      if (grupos > 0) {
        const precioPromedio = itemsRegla.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0) / cantidadTotal
        const d = grupos * precioPromedio
        total += d
        aplicados.push({ ...regla, descuento: d })
      }
    } else if (regla.tipo === '2da_50') {
      const pares = Math.floor(cantidadTotal / 2)
      if (pares > 0) {
        const precioPromedio = itemsRegla.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0) / cantidadTotal
        const d = pares * precioPromedio * 0.5
        total += d
        aplicados.push({ ...regla, descuento: d })
      }
    } else if (regla.tipo === 'lleva_paga') {
      if (cantidadTotal >= 4) {
        const precioPromedio = itemsRegla.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0) / cantidadTotal
        const d = precioPromedio
        total += d
        aplicados.push({ ...regla, descuento: d })
      }
    } else if (regla.tipo === 'porcentaje') {
      const subtotal = itemsRegla.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0)
      const d = subtotal * (regla.descuento / 100)
      total += d
      aplicados.push({ ...regla, descuento: d })
    } else if (regla.tipo === 'monto_fijo') {
      const unidadesRequeridas = regla.valor ?? 3
      const grupos = Math.floor(cantidadTotal / unidadesRequeridas)
      if (grupos > 0) {
        const precioPromedio = itemsRegla.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0) / cantidadTotal
        const subtotalGrupos = grupos * unidadesRequeridas * precioPromedio
        const montoGrupo = grupos * (regla.descuento ?? 0)
        const d = subtotalGrupos - montoGrupo
        if (d > 0) {
          total += d
          aplicados.push({ ...regla, descuento: d })
        }
      }
    }
  }
  return { descuento: total, aplicados }
}

/** Descuento por cupón. */
export function calcDescuentoCupon(
  subtotal: number,
  cupon: { tipo: 'porcentaje' | 'monto'; valor: number } | null,
): DescuentoCupon | null {
  if (!cupon || cupon.valor <= 0) return null
  const descuento = cupon.tipo === 'porcentaje'
    ? Math.round(subtotal * cupon.valor / 100 * 100) / 100
    : Math.min(cupon.valor, subtotal)
  return { codigo: '', tipo: cupon.tipo, valor: cupon.valor, descuento }
}

/** Descuento por cliente frecuente. */
export function calcDescuentoCliente(
  subtotal: number,
  porcentaje: number,
): DescuentoCliente | null {
  if (porcentaje <= 0 || porcentaje > 100) return null
  return { porcentaje, descuento: Math.round(subtotal * porcentaje / 100 * 100) / 100 }
}

/** Descuento global (aplica al final). */
export function calcDescuentoGlobal(
  subtotal: number,
  tipo: 'porcentaje' | 'monto',
  valor: number,
): DescuentoGlobal | null {
  if (valor <= 0) return null
  const descuento = tipo === 'porcentaje'
    ? Math.round(subtotal * valor / 100 * 100) / 100
    : Math.min(valor, subtotal)
  return { tipo, valor, descuento }
}

/** Resumen completo de descuentos. Aplica en orden: producto → volumen → cliente → global. */
export function calcularDescuentos(
  items: ItemCarrito[],
  options: {
    reglasVolumen?: DescuentoVolumen[]
    descuentoClientePorcentaje?: number
    descuentoGlobalTipo?: 'porcentaje' | 'monto'
    descuentoGlobalValor?: number
  } = {},
): ResumenDescuentos {
  // 1. Subtotal bruto (sin descuentos de producto)
  const totalBruto = items.reduce((s, it) => s + it.precioUnitario * it.cantidad, 0)

  // 2. Descuentos por producto
  const porProducto = items.map(calcDescuentoProducto)
  const subtotalConDescProd = porProducto.reduce((s, d) => s + d.subtotalConDescuento, 0)

  // 3. Descuentos por volumen (se aplican sobre el subtotal con descuento de producto)
  const volumenResult = calcDescuentoVolumen(
    items.map((it, i) => ({ ...it, precioUnitario: porProducto[i].subtotalConDescuento / it.cantidad || it.precioUnitario })),
    options.reglasVolumen ?? [],
  )
  const subtotalPostVolumen = subtotalConDescProd - volumenResult.descuento

  // 4. Descuento cliente
  const clienteResult = calcDescuentoCliente(subtotalPostVolumen, options.descuentoClientePorcentaje ?? 0)
  const subtotalPostCliente = subtotalPostVolumen - (clienteResult?.descuento ?? 0)

  // 5. Descuento global
  const globalResult = calcDescuentoGlobal(subtotalPostCliente, options.descuentoGlobalTipo ?? 'monto', options.descuentoGlobalValor ?? 0)

  const totalDescuento = totalBruto - subtotalPostCliente - (globalResult?.descuento ?? 0)
  const totalFinal = Math.max(0, subtotalPostCliente - (globalResult?.descuento ?? 0))

  return {
    porProducto,
    volumen: volumenResult.aplicados,
    cliente: clienteResult,
    global: globalResult,
    totalDescuento: Math.round(totalDescuento * 100) / 100,
    totalBruto: Math.round(totalBruto * 100) / 100,
    totalFinal: Math.round(totalFinal * 100) / 100,
  }
}

// ─── Tope del descuento MANUAL (política del negocio) ────────────────────────────────────────

/**
 * Resultado de revisar el descuento manual que carga un usuario en el PDV.
 * `porcentaje` es cuánto representa sobre el subtotal (una sola unidad de medida, tanto si el
 * usuario escribió un % como si escribió un monto en soles).
 */
export type RevisionDescuento = {
  /** Porcentaje efectivo del descuento sobre el subtotal (0 si no hay descuento). */
  porcentaje: number
  /** `true` si se pasó del tope del negocio. */
  excede: boolean
  /** Valor ya recortado al tope, listo para usar (mismo `tipo` que la entrada). */
  valorAjustado: number
  /** Mensaje para mostrar al usuario; vacío si no hay nada que avisar. */
  mensaje: string
}

/**
 * ¿El descuento manual que se está por aplicar respeta el tope del negocio?
 *
 * ⚠️ **El tope es del descuento MANUAL** (el que carga una persona en el PDV: global o por línea):
 * las promociones automáticas (volumen, descuento de producto, descuento de cliente, precio
 * especial) **no se tocan**, porque son configuración del negocio, no una decisión del momento.
 *
 * ⚠️ **`topePorcentaje = 0` significa SIN TOPE** (igual que `limiteCredito = 0` = sin límite):
 * interpretarlo al revés bloquearía todo descuento de los negocios que no configuraron nada.
 */
export function revisarDescuentoManual({
  tipo,
  valor,
  subtotal,
  topePorcentaje,
}: {
  tipo: 'porcentaje' | 'monto'
  valor: number
  subtotal: number
  topePorcentaje?: number | null
}): RevisionDescuento {
  const base = Number(subtotal) > 0 ? Number(subtotal) : 0
  const v = Number(valor) > 0 ? Number(valor) : 0
  const tope = Number(topePorcentaje) > 0 ? Number(topePorcentaje) : 0

  // Sin base no hay porcentaje que calcular (carrito vacío): no se puede exceder nada.
  const porcentaje = base > 0
    ? Math.round((tipo === 'porcentaje' ? v : (v / base) * 100) * 100) / 100
    : 0

  if (tope === 0 || porcentaje <= tope) {
    return { porcentaje, excede: false, valorAjustado: v, mensaje: '' }
  }

  // Recorte al tope, en la unidad en la que el usuario escribió.
  const valorAjustado = tipo === 'porcentaje'
    ? tope
    : Math.round(((base * tope) / 100) * 100) / 100

  return {
    porcentaje,
    excede: true,
    valorAjustado,
    mensaje: `El descuento manual máximo es ${tope}%. Escribiste ${porcentaje}%: se ajustó al tope.`,
  }
}
