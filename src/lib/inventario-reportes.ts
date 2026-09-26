import type { Producto } from '@/hooks/use-productos'
import { redondear2 } from './dinero.ts'
import { costoDeProducto } from './valorizacion.ts'
import { margenDePrecio, precioSinIgv } from './precio-venta.ts'
import { afectacionGuardada } from './sunat-importes.ts'

// Port de services/inventario.js → generarReporte de la app RN (misma lógica).
//
// ⚠️ **El costo de cada producto sale SIEMPRE de `costoDeProducto()`** (el promedio ponderado, con el
// último costo como respaldo) y no de `p.precioCompra`: si no, estos reportes valorizan el stock y
// calculan la utilidad con un costo distinto al del Inventario y al del kardex. `precioCompra` es el
// **último costo**, que sirve para precargar una compra o comparar precios entre proveedores, no para
// valorizar plata. ⚠️ La RN tiene el mismo defecto: hay que portarlo cuando se retome la móvil.
//
// 🔑 **Y el valor de venta se mide SIN IGV cuando el producto es gravado** (`lib/precio-venta.ts`): el
// IGV que se cobra no es plata del negocio, así que restarle el costo a un precio con IGV infla la
// ganancia. 📌 Medido el 25/09/2026 (negocio de Lima, precio 150 y costo neto 100): el reporte daba
// **33%** donde el margen real era **21,3%**. Con un producto **exonerado** (`'20'`, el caso de esta
// región) el neto es el precio cobrado y **no cambia ningún número** de estos reportes.

/**
 * **El valor de venta de UNA unidad, en la base del negocio**: el precio **sin IGV** si el producto es
 * gravado (el IGV que se cobra no es plata del negocio) y el precio tal cual si es exonerado.
 * Se redondea por unidad para que la columna que se ve en pantalla y el total digan lo mismo.
 */
const valorUnitarioNeto = (p: Producto) => redondear2(precioSinIgv(p.precioVenta || 0, afectacionGuardada(p)))

export function generarReporteStockGeneral(productos: Producto[]) {
  const ordenados = [...productos].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
  const stockTotal = ordenados.reduce((s, p) => s + (p.stock || 0), 0)
  const valorTotalInventario = ordenados.reduce((s, p) => s + costoDeProducto(p) * (p.stock || 0), 0)
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
    .map((p) => ({ ...p, inversionTotal: costoDeProducto(p) * (p.stock || 0) }))
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
    resumenCategorias[cat].valorInventario += costoDeProducto(p) * (p.stock || 0)
    resumenCategorias[cat].productos.push(p)
  })
  return {
    titulo: '📊 RESUMEN POR CATEGORÍA',
    categorias: resumenCategorias,
    fechaGeneracion: new Date().toLocaleString('es-PE'),
    totalProductos: productos.length,
    totalStock: productos.reduce((s, p) => s + (p.stock || 0), 0),
    totalValorInventario: productos.reduce((s, p) => s + costoDeProducto(p) * (p.stock || 0), 0),
  }
}

export function generarReporteGeneral(productos: Producto[]) {
  const totalValorCompra = productos.reduce((s, p) => s + costoDeProducto(p) * (p.stock || 0), 0)
  // `totalValorVenta` es lo que **queda para el negocio** (sin IGV en los gravados): con el precio tal
  // como está en la etiqueta, la resta «venta − compra» le sumaría a la ganancia un IGV que hay que
  // declarar. El margen tiene que cuadrar con esa resta, así que las dos puntas van en la misma base.
  const totalValorVenta = productos.reduce((s, p) => s + valorUnitarioNeto(p) * (p.stock || 0), 0)
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
      const costo = costoDeProducto(p)
      const stock = p.stock || 0
      // 🔑 La regla única del margen (`lib/precio-venta.ts`): si el producto es **gravado**, el margen se
      // mide sobre el precio **sin IGV** (y `valorNeto` es esa base, para que la tabla cuadre); si es
      // exonerado es el precio tal cual, exactamente como antes.
      const m = margenDePrecio(p.precioVenta || 0, costo, afectacionGuardada(p))
      return { ...p, costoUnitario: costo, valorNeto: m.neto, utilidadUnidad: m.margen, margen: m.margenPct, utilidadTotal: m.margen * stock }
    })
    .sort((a, b) => (b.utilidadTotal || 0) - (a.utilidadTotal || 0))

  const totalValorCompra = productos.reduce((s, p) => s + costoDeProducto(p) * (p.stock || 0), 0)
  const totalValorVenta = productos.reduce((s, p) => s + valorUnitarioNeto(p) * (p.stock || 0), 0)
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
