/**
 * Tests de los reportes de inventario (`lib/inventario-reportes.ts`) con la **regla única del costo**.
 *
 * 🔑 **Qué se está cuidando acá**: el margen y la valorización tienen que usar el **costo vigente**
 * del producto —el promedio ponderado, con el último costo como respaldo (`costoDeProducto()`, en
 * `lib/valorizacion.ts`)— y **no** `precioCompra` leído a mano. Fue un bug real (19/09/2026): el
 * Inventario valorizaba con el promedio y el Análisis y los reportes de utilidad seguían usando el
 * último costo tipeado, así que **dos pantallas de la misma app mostraban dos costos distintos**, y el
 * equivocado era el que se miraba para decidir a cuánto vender.
 *
 * Runner nativo de Node: `npm test`.
 * ⚠️ Los imports entre módulos de `lib/` llevan extensión `.ts` explícita.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  generarReporteGeneral,
  generarReporteMayorInversion,
  generarReportePorCategoria,
  generarReporteStockGeneral,
  generarReporteUtilidad,
} from './inventario-reportes.ts'
import type { Producto } from '@/hooks/use-productos'

/** Producto con lo mínimo que usan los reportes (el resto del catálogo no participa del cálculo). */
function producto(p: Partial<Producto> & { id: string }): Producto {
  return { stock: 0, ...p } as Producto
}

// Casos reales del catálogo de JorFel, para que los números signifiquen algo.
const COCA_1LT = producto({ id: '8791', nombre: 'Coca Cola 1LT', categoria: 'BEBIDAS', stock: 10, precioCompra: 3.17, costoPromedio: 3.5, precioVenta: 5 })
const AQUAREY = producto({ id: '4213', nombre: 'Aquarey 625ML', categoria: 'BEBIDAS', stock: 4, precioCompra: 0.5, precioVenta: 1 })
const WAFER = producto({ id: '0326', nombre: 'WAFER NIK CHOCOLATE', categoria: 'DULCES', stock: 5, precioVenta: 1 })

describe('generarReporteUtilidad — margen con el costo promedio', () => {
  it('usa el promedio ponderado, no el último costo tipeado', () => {
    // 10 unidades: costo vigente 3.50 (no 3.17), venta 5.00 → utilidad 1.50 por unidad, 15.00 total
    const r = generarReporteUtilidad([COCA_1LT])
    const fila = r.productos[0]
    assert.equal(fila.costoUnitario, 3.5)
    assert.equal(fila.utilidadUnidad, 1.5)
    assert.equal(fila.utilidadTotal, 15)
    assert.equal(fila.margen, 30, 'margen sobre el precio de venta: 1.50 / 5.00')
    assert.equal(r.totalValorCompra, '35.00', '10 unidades × 3.50')
    assert.equal(r.totalValorVenta, '50.00')
    assert.equal(r.utilidadGeneral, '15.00')
  })

  it('sin promedio calculado sigue usando el último costo (no cambia lo que ya hacía)', () => {
    const r = generarReporteUtilidad([AQUAREY])
    assert.equal(r.productos[0].costoUnitario, 0.5)
    assert.equal(r.productos[0].utilidadUnidad, 0.5)
    assert.equal(r.productos[0].margen, 50)
  })

  it('⚠️ un producto sin ningún costo da 100% de margen (limitación conocida, no se cambia acá)', () => {
    // Caso real: WAFER NIK CHOCOLATE (0326) y WAFER NIK FRESA (8742) tienen stock y ningún costo.
    // El reporte NO distingue «no hay dato de costo» de «costo cero»: le asigna 100% de margen. Es una
    // limitación conocida y documentada (por eso el Inventario avisa "N sin costo (valen S/ 0)");
    // este test la fija para que un cambio de comportamiento no pase desapercibido.
    const r = generarReporteUtilidad([WAFER])
    assert.equal(r.productos[0].costoUnitario, 0)
    assert.equal(r.productos[0].utilidadUnidad, 1)
    assert.equal(r.productos[0].margen, 100)
    assert.equal(r.productosConGanancia, 1)
  })
})

describe('los reportes de inventario valorizan con el mismo costo que el Inventario', () => {
  it('stock general: el valor del inventario usa el promedio', () => {
    // Antes: 10 × 3.17 = 31.70 (último costo). Ahora: 10 × 3.50 = 35.00.
    const r = generarReporteStockGeneral([COCA_1LT])
    assert.equal(r.estadisticas.valorTotalInventario, '35.00')
  })

  it('mayor inversión: ordena y suma por valor al promedio', () => {
    const r = generarReporteMayorInversion([COCA_1LT, AQUAREY])
    assert.equal(r.productos[0].inversionTotal, 35)
    assert.equal(r.totalInventario, 37) // 35.00 + 4 × 0.50
  })

  it('por categoría: el valor de cada categoría usa el promedio', () => {
    const r = generarReportePorCategoria([COCA_1LT, AQUAREY])
    assert.equal(r.categorias['BEBIDAS'].valorInventario, 37)
    assert.equal(r.totalValorInventario, 37)
  })

  it('reporte general: valor de compra y ganancia potencial al promedio', () => {
    const r = generarReporteGeneral([COCA_1LT, AQUAREY])
    assert.equal(r.totalValorCompra, '37.00')
    assert.equal(r.totalValorVenta, '54.00') // 10 × 5.00 + 4 × 1.00
    assert.equal(r.gananciaPotencial, '17.00')
    assert.equal(r.margenGanancia, '31.5')
  })
})
