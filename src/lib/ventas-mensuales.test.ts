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
