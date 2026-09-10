import type { Producto } from '@/hooks/use-productos'

// Port de services/inventario.js → generarReporte de la app RN (misma lógica).

export function generarReporteStockGeneral(productos: Producto[]) {
  const ordenados = [...productos].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
  const stockTotal = ordenados.reduce((s, p) => s + (p.stock || 0), 0)
  const valorTotalInventario = ordenados.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0)
  return {
    titulo: '📋 STOCK GENERAL - CIERRE DE TURNO',
    fechaGeneracion: new Date().toLocaleString('es-PE'),
    productos: ordenados,
    estadisticas: {
      totalProductos: ordenados.length,
      stockTotal,
      productosConStock: ordenados.filter((p) => (p.stock || 0) > 0).length,
      productosSinStock: ordenados.filter((p) => (p.stock || 0) === 0).length,
      productosBajoMinimo: ordenados.filter((p) => p.minStock != null && (p.stock || 0) <= p.minStock).length,
      valorTotalInventario: valorTotalInventario.toFixed(2),
    },
  }
}

export function generarReporteStockBajo(productos: Producto[]) {
  const productosBajoStock = productos.filter((p) => p.minStock != null && (p.stock || 0) <= p.minStock)
  return {
    titulo: '📉 PRODUCTOS CON STOCK BAJO',
    totalProductos: productosBajoStock.length,
    productos: productosBajoStock,
    fechaGeneracion: new Date().toLocaleString('es-PE'),
  }
}

export function generarReporteMayorInversion(productos: Producto[]) {
  const ordenados = productos
    .map((p) => ({ ...p, inversionTotal: (p.precioCompra || 0) * (p.stock || 0) }))
    .sort((a, b) => (b.inversionTotal || 0) - (a.inversionTotal || 0))
  return {
    titulo: '💰 MAYOR INVERSIÓN EN STOCK',
    totalProductos: ordenados.length,
    productos: ordenados,
    totalInventario: ordenados.reduce((s, p) => s + (p.inversionTotal || 0), 0),
    fechaGeneracion: new Date().toLocaleString('es-PE'),
  }
}

export function generarReportePorCategoria(productos: Producto[]) {
  const resumenCategorias: Record<string, { cantidadProductos: number; stockTotal: number; valorInventario: number; productos: Producto[] }> = {}
  productos.forEach((p) => {
    const cat = p.categoria || 'Sin categoría'
    if (!resumenCategorias[cat]) resumenCategorias[cat] = { cantidadProductos: 0, stockTotal: 0, valorInventario: 0, productos: [] }
    resumenCategorias[cat].cantidadProductos++
    resumenCategorias[cat].stockTotal += p.stock || 0
    resumenCategorias[cat].valorInventario += (p.precioCompra || 0) * (p.stock || 0)
    resumenCategorias[cat].productos.push(p)
  })
  return {
    titulo: '📊 RESUMEN POR CATEGORÍA',
    categorias: resumenCategorias,
    fechaGeneracion: new Date().toLocaleString('es-PE'),
    totalProductos: productos.length,
    totalStock: productos.reduce((s, p) => s + (p.stock || 0), 0),
    totalValorInventario: productos.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0),
  }
}

export function generarReporteGeneral(productos: Producto[]) {
  const totalValorCompra = productos.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0)
  const totalValorVenta = productos.reduce((s, p) => s + (p.precioVenta || 0) * (p.stock || 0), 0)
  const gananciaPotencial = totalValorVenta - totalValorCompra
  return {
    titulo: '📈 REPORTE GENERAL DE INVENTARIO',
    totalProductos: productos.length,
    totalStock: productos.reduce((s, p) => s + (p.stock || 0), 0),
    totalValorCompra: totalValorCompra.toFixed(2),
    totalValorVenta: totalValorVenta.toFixed(2),
    gananciaPotencial: gananciaPotencial.toFixed(2),
    margenGanancia: totalValorVenta > 0 ? ((gananciaPotencial / totalValorVenta) * 100).toFixed(1) : '0',
    productosBajoStock: productos.filter((p) => p.minStock != null && (p.stock || 0) <= p.minStock).length,
    productosSinStock: productos.filter((p) => (p.stock || 0) === 0).length,
    fechaGeneracion: new Date().toLocaleString('es-PE'),
  }
}

export function generarReporteUtilidad(productos: Producto[]) {
  const conUtilidad = productos
    .map((p) => {
      const costo = p.precioCompra || 0
      const venta = p.precioVenta || 0
      const stock = p.stock || 0
      const utilidadUnidad = venta - costo
      const margen = venta > 0 ? (utilidadUnidad / venta) * 100 : 0
      return { ...p, costoUnitario: costo, utilidadUnidad, margen, utilidadTotal: utilidadUnidad * stock }
    })
    .sort((a, b) => (b.utilidadTotal || 0) - (a.utilidadTotal || 0))

  const totalValorCompra = productos.reduce((s, p) => s + (p.precioCompra || 0) * (p.stock || 0), 0)
  const totalValorVenta = productos.reduce((s, p) => s + (p.precioVenta || 0) * (p.stock || 0), 0)
  const utilidadGeneral = totalValorVenta - totalValorCompra
  const margenGeneral = totalValorVenta > 0 ? (utilidadGeneral / totalValorVenta) * 100 : 0

  return {
    titulo: '💰 UTILIDAD DE INVENTARIO',
    fechaGeneracion: new Date().toLocaleString('es-PE'),
    productos: conUtilidad,
    totalProductos: conUtilidad.length,
    totalValorCompra: totalValorCompra.toFixed(2),
    totalValorVenta: totalValorVenta.toFixed(2),
    utilidadGeneral: utilidadGeneral.toFixed(2),
    margenGeneral: margenGeneral.toFixed(1),
    productosConGanancia: conUtilidad.filter((p) => p.utilidadUnidad > 0).length,
    productosPerdida: conUtilidad.filter((p) => p.utilidadUnidad < 0).length,
  }
}

export function generarReporte(tipo: string, productos: Producto[]) {
  switch (tipo) {
    case 'stockGeneral': return generarReporteStockGeneral(productos)
    case 'stockBajo': return generarReporteStockBajo(productos)
    case 'mayorInversion': return generarReporteMayorInversion(productos)
    case 'porCategoria': return generarReportePorCategoria(productos)
    case 'general': return generarReporteGeneral(productos)
    case 'utilidad': return generarReporteUtilidad(productos)
    default: return null
  }
}
