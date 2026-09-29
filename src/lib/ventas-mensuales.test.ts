/**
 * **El gráfico mensual del Dashboard Gerencial** (`lib/ventas-mensuales.ts`).
 *
 * ⚠️ Lo que este test fija es el **porqué** de cada número: qué cuenta como venta, qué resta y qué
 * se ignora. Un gráfico que sume distinto que Reportes es peor que no tener gráfico.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  anioDeFecha,
  aniosParaSelector,
  esDocumentoDeVenta,
  importeNetoDeVenta,
  mapaDeCostos,
  margenDeDocumento,
  mesDeFecha,
  MESES_CORTOS,
  serieMensual,
  signoDoc,
  type DocDeVenta,
} from './ventas-mensuales.ts'

const doc = (extra: Partial<DocDeVenta> = {}): DocDeVenta => ({
  tipoDoc: 'NV',
  estado: 'pagado',
  fecha: '2026-03-14T15:30:00.000Z',
  venta: { total: 100 },
  ...extra,
})

describe('esDocumentoDeVenta — qué cuenta como venta', () => {
  it('los cinco tipos de comprobante que suma el reporte de ventas', () => {
    for (const tipoDoc of ['NV', 'BOLETA', 'FACTURA', 'NC', 'ND']) {
      assert.equal(esDocumentoDeVenta(doc({ tipoDoc })), true, tipoDoc)
    }
  })

  it('un pedido pendiente NO es una venta (todavía no tiene comprobante)', () => {
    assert.equal(esDocumentoDeVenta(doc({ tipoDoc: 'PENDIENTE' })), false)
  })

  it('una venta anulada no cuenta', () => {
    assert.equal(esDocumentoDeVenta(doc({ estado: 'anulada' })), false)
  })

  it('una boleta consolidada no cuenta: sus notas de venta ya se contaron en caja', () => {
    assert.equal(esDocumentoDeVenta(doc({ consolidado: true })), false)
  })

  it('basura no rompe', () => {
    assert.equal(esDocumentoDeVenta(null), false)
    assert.equal(esDocumentoDeVenta(undefined), false)
    assert.equal(esDocumentoDeVenta({}), false)
  })
})

describe('signoDoc / importeNetoDeVenta — la nota de crédito resta', () => {
  it('la NC resta y el resto suma (la ND también suma)', () => {
    assert.equal(signoDoc(doc({ tipoDoc: 'NC' })), -1)
    assert.equal(signoDoc(doc({ tipoDoc: 'ND' })), 1)
    assert.equal(signoDoc(doc({ tipoDoc: 'BOLETA' })), 1)
  })

  it('lo que aporta cada comprobante al total del mes', () => {
    assert.equal(importeNetoDeVenta(doc({ venta: { total: 150 } })), 150)
    assert.equal(importeNetoDeVenta(doc({ tipoDoc: 'NC', venta: { total: 40 } })), -40)
    assert.equal(importeNetoDeVenta(doc({ tipoDoc: 'PENDIENTE', venta: { total: 99 } })), 0)
    assert.equal(importeNetoDeVenta(doc({ estado: 'anulada', venta: { total: 99 } })), 0)
  })

  it('un total ausente o basura vale 0 (no inventa NaN)', () => {
    assert.equal(importeNetoDeVenta(doc({ venta: null })), 0)
    assert.equal(importeNetoDeVenta(doc({ venta: {} })), 0)
    assert.equal(importeNetoDeVenta(doc({ venta: { total: 'x' as unknown as number } })), 0)
  })
})

describe('mesDeFecha / anioDeFecha', () => {
  it('lee el mes y el año de una fecha ISO', () => {
    assert.equal(mesDeFecha('2026-03-14T15:30:00.000Z'), 3)
    assert.equal(anioDeFecha('2026-03-14T15:30:00.000Z'), 2026)
  })

  it('una fecha que no se puede leer devuelve 0 (y no entra en ningún mes)', () => {
    assert.equal(mesDeFecha(''), 0)
    assert.equal(mesDeFecha(undefined), 0)
    assert.equal(anioDeFecha('no es una fecha'), 0)
  })
})

describe('serieMensual — un año, mes por mes', () => {
  const docs: DocDeVenta[] = [
    doc({ fecha: '2026-01-05T10:00:00.000Z', venta: { total: 100 } }),
    doc({ fecha: '2026-01-20T10:00:00.000Z', venta: { total: 50 } }),
    doc({ fecha: '2026-03-02T10:00:00.000Z', tipoDoc: 'BOLETA', venta: { total: 300 } }),
    doc({ fecha: '2026-03-20T10:00:00.000Z', tipoDoc: 'NC', venta: { total: 100 } }),
    // Ruido que NO debe sumar:
    doc({ fecha: '2026-03-25T10:00:00.000Z', tipoDoc: 'PENDIENTE', venta: { total: 999 } }),
    doc({ fecha: '2026-03-26T10:00:00.000Z', estado: 'anulada', venta: { total: 888 } }),
    doc({ fecha: '2026-03-27T10:00:00.000Z', consolidado: true, venta: { total: 777 } }),
    // De otro año: lo tiene que ignorar aunque la consulta se haya pasado de rango.
    doc({ fecha: '2025-03-27T10:00:00.000Z', venta: { total: 555 } }),
  ]

  it('siempre devuelve los 12 meses (un mes sin ventas queda en cero, no desaparece)', () => {
    const s = serieMensual(docs, 2026)
    assert.equal(s.meses.length, 12)
    assert.deepEqual(s.meses.map((m) => m.label), [...MESES_CORTOS])
    assert.deepEqual(s.meses.map((m) => m.mes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('agrupa por mes y resta la nota de crédito', () => {
    const s = serieMensual(docs, 2026)
    assert.equal(s.meses[0].total, 150, 'enero: 100 + 50')
    assert.equal(s.meses[1].total, 0, 'febrero sin ventas')
    assert.equal(s.meses[2].total, 200, 'marzo: 300 − 100 de la NC')
  })

  it('cuenta los comprobantes del mes y los del año', () => {
    const s = serieMensual(docs, 2026)
    assert.equal(s.meses[0].comprobantes, 2)
    assert.equal(s.meses[2].comprobantes, 2, 'la NC es un comprobante (aunque reste)')
    assert.equal(s.comprobantes, 4)
  })

  it('el total del año y el mejor mes', () => {
    const s = serieMensual(docs, 2026)
    assert.equal(s.total, 350, '150 + 200: los 999/888/777/555 no entran')
    assert.equal(s.mejorMes?.mes, 3)
    assert.equal(s.mejorMes?.total, 200)
    assert.equal(s.mesesConVentas, 2)
    assert.equal(s.max, 200)
  })

  it('un año sin ventas no rompe: total 0, sin mejor mes y la escala en 1', () => {
    const s = serieMensual(docs, 2020)
    assert.equal(s.total, 0)
    assert.equal(s.comprobantes, 0)
    assert.equal(s.mejorMes, null)
    assert.equal(s.max, 1, 'la escala nunca es 0: dividir por 0 daría barras NaN')
    assert.equal(s.mesesConVentas, 0)
  })

  it('sin documentos devuelve el año vacío (no `undefined`)', () => {
    const s = serieMensual(null, 2026)
    assert.equal(s.anio, 2026)
    assert.equal(s.meses.length, 12)
    assert.equal(s.total, 0)
  })

  it('un mes con más devoluciones que ventas puede dar negativo (se muestra, no se esconde)', () => {
    const s = serieMensual([doc({ tipoDoc: 'NC', fecha: '2026-05-02T10:00:00.000Z', venta: { total: 80 } })], 2026)
    assert.equal(s.meses[4].total, -80)
    assert.equal(s.mejorMes, null, 'sin ninguna venta positiva no hay “mejor mes”')
  })
})

describe('margenDeDocumento — la utilidad bruta de lo vendido', () => {
  const venta = (items: { id: string; cantidad: number; precioVenta: number }[], extra: Partial<DocDeVenta> = {}): DocDeVenta => ({
    tipoDoc: 'NV',
    estado: 'pagado',
    fecha: '2026-03-14T15:30:00.000Z',
    venta: { total: 0, items },
    ...extra,
  })

  const costos = new Map([
    ['exo', { costo: 6, afectacion: '20' }], // exonerado: el precio ES el neto
    ['gra', { costo: 100, afectacion: '10' }], // gravado: el IGV no es plata del negocio
  ])

  it('con un exonerado: ingreso = precio, y el margen es lo que queda sobre el costo', () => {
    const r = margenDeDocumento(venta([{ id: 'exo', cantidad: 2, precioVenta: 10 }]), costos)
    assert.equal(r.ingreso, 20)
    assert.equal(r.costo, 12, '2 × 6')
    assert.equal(r.margen, 8)
    assert.equal(r.itemsSinCosto, 0)
  })

  it('con un gravado mide sobre el NETO (el IGV cobrado no es del negocio)', () => {
    // 118 con IGV y costo neto 100 ⇒ el negocio no gana nada. Si se midiera sobre el precio con IGV
    // daría 18 de margen “falso”.
    const r = margenDeDocumento(venta([{ id: 'gra', cantidad: 1, precioVenta: 118 }]), costos)
    assert.equal(r.ingreso, 100)
    assert.equal(r.margen, 0)
  })

  it('un ítem sin producto en el catálogo (Embalaje y Otros) no tiene costo: se informa', () => {
    const r = margenDeDocumento(venta([{ id: 'manual', cantidad: 1, precioVenta: 50 }]), costos)
    assert.equal(r.margen, 50, 'cuenta como ingreso con costo 0')
    assert.equal(r.itemsSinCosto, 1, 'y queda marcado: infla el margen')
  })

  it('un producto CON costo 0 también se marca (vale S/ 0 ⇒ margen del 100%)', () => {
    // 📌 El caso real de producción: productos sin costo cargado (WAFER NIK). Inflan el margen igual
    // que un ítem manual, así que el aviso tiene que salir por los dos.
    const sinCosto = new Map([['pobre', { costo: 0, afectacion: '20' }]])
    const r = margenDeDocumento(venta([{ id: 'pobre', cantidad: 3, precioVenta: 10 }]), sinCosto)
    assert.equal(r.margen, 30, 'se vende todo como ganancia')
    assert.equal(r.itemsSinCosto, 1)
  })

  it('una nota de crédito resta el ingreso Y el costo (la mercadería vuelve al stock)', () => {
    const r = margenDeDocumento(venta([{ id: 'exo', cantidad: 2, precioVenta: 10 }], { tipoDoc: 'NC' }), costos)
    assert.equal(r.ingreso, -20)
    assert.equal(r.costo, -12)
    assert.equal(r.margen, -8)
  })

  it('sin el mapa de costos el margen no se puede calcular: da 0 y no miente con un número', () => {
    const r = margenDeDocumento(venta([{ id: 'exo', cantidad: 2, precioVenta: 10 }]))
    assert.equal(r.ingreso, 20)
    assert.equal(r.costo, 0)
    assert.equal(r.itemsSinCosto, 1)
  })

  it('una línea sin cantidad no aporta nada', () => {
    const r = margenDeDocumento(venta([{ id: 'exo', cantidad: 0, precioVenta: 10 }]), costos)
    assert.equal(r.ingreso, 0)
    assert.equal(r.margen, 0)
  })
})

describe('mapaDeCostos — el costo sale de costoDeProducto (regla única)', () => {
  it('usa el promedio ponderado, y el último costo como respaldo', () => {
    const mapa = mapaDeCostos([
      { id: 'conPromedio', costoPromedio: 3.1667, precioCompra: 9 },
      { id: 'sinPromedio', precioCompra: 2.5 },
      { id: 'soloCostoViejo', costo: 1.75 },
    ])
    assert.equal(mapa.get('conPromedio')?.costo, 3.1667, 'el promedio manda sobre el último costo')
    assert.equal(mapa.get('sinPromedio')?.costo, 2.5)
    assert.equal(mapa.get('soloCostoViejo')?.costo, 1.75)
  })

  it('respeta la afectación del producto y no rompe con basura', () => {
    const mapa = mapaDeCostos([{ id: 'a', precioCompra: 1, tipoAfectacion: '10' }])
    assert.equal(mapa.get('a')?.afectacion, '10')
    assert.equal(mapaDeCostos(null).size, 0)
  })
})

describe('serieMensual — el margen por mes', () => {
  const conItems = (fecha: string, items: { id: string; cantidad: number; precioVenta: number }[], tipoDoc = 'NV'): DocDeVenta => ({
    tipoDoc,
    estado: 'pagado',
    fecha,
    venta: { total: 0, items },
  })
  const costos = new Map([['p', { costo: 6, afectacion: '20' }]])

  it('acumula ingreso, costo y margen por mes, y el margen del año', () => {
    const s = serieMensual(
      [
        conItems('2026-01-10T10:00:00.000Z', [{ id: 'p', cantidad: 10, precioVenta: 10 }]), // 100 / 60 / 40
        conItems('2026-03-10T10:00:00.000Z', [{ id: 'p', cantidad: 5, precioVenta: 10 }]), // 50 / 30 / 20
      ],
      2026,
      { costos },
    )
    assert.equal(s.meses[0].ingreso, 100)
    assert.equal(s.meses[0].costo, 60)
    assert.equal(s.meses[0].margen, 40)
    assert.equal(s.meses[2].margen, 20)
    assert.equal(s.ingreso, 150)
    assert.equal(s.costo, 90)
    assert.equal(s.margen, 60)
    assert.equal(s.margenPct, 40, '60 sobre 150 = 40%')
    assert.equal(s.maxMargen, 40, 'la escala de las barras de utilidad')
  })

  it('suma los ítems sin costo del año (para poder avisar que el margen está inflado)', () => {
    const s = serieMensual(
      [
        conItems('2026-01-10T10:00:00.000Z', [{ id: 'p', cantidad: 1, precioVenta: 10 }]),
        conItems('2026-02-10T10:00:00.000Z', [{ id: 'fantasma', cantidad: 1, precioVenta: 99 }]),
      ],
      2026,
      { costos },
    )
    assert.equal(s.itemsSinCosto, 1)
  })

  it('sin costos pasados, el margen queda en 0 (no se inventa una utilidad)', () => {
    const s = serieMensual([conItems('2026-01-10T10:00:00.000Z', [{ id: 'p', cantidad: 10, precioVenta: 10 }])], 2026)
    assert.equal(s.margen, 0)
    assert.equal(s.ingreso, 100, 'el ingreso sí se puede calcular siempre')
  })
})

describe('aniosParaSelector', () => {
  it('del año actual al del primer comprobante, más nuevo primero', () => {
    assert.deepEqual(aniosParaSelector(2024, 2026), [2026, 2025, 2024])
  })

  it('si nunca hubo ventas ofrece los últimos 5 años (el selector no queda vacío)', () => {
    assert.deepEqual(aniosParaSelector(0, 2026), [2026, 2025, 2024, 2023, 2022])
    assert.deepEqual(aniosParaSelector(Number.NaN, 2026), [2026, 2025, 2024, 2023, 2022])
  })

  it('un primer año absurdo (posterior al actual) no inventa años futuros', () => {
    assert.deepEqual(aniosParaSelector(2030, 2026), [2026, 2025, 2024, 2023, 2022])
  })

  it('un solo año de historia devuelve un solo año', () => {
    assert.deepEqual(aniosParaSelector(2026, 2026), [2026])
  })
})
