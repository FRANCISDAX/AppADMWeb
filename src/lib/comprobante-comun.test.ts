/**
 * Pruebas de las reglas **compartidas** entre la ticketera (72 mm) y el A4 (`lib/comprobante-comun.ts`).
 *
 * Lo que se cuida acá: que el mismo documento no pueda mostrar **dos importes distintos** según se
 * imprima en la ticketera o se envíe en A4. Los totales SUNAT, el QR, la serie de una NC/ND y la
 * normalización de sus montos son **una sola implementación** para los dos formatos.
 *
 * ⚠️ Incluye la **guarda del ticket**: si alguien cambia el tamaño de página de la ticketera, este
 * test falla. El A4 es un papel aparte y no debe tocar el del POS.
 *
 * Runner nativo de Node: `npm test`.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { TITULOS, calcularTotales, construirQRData, normalizarMontosNota, obtenerInfoAfectacion, serieNota } from './comprobante-comun.ts'

const CONFIG = { ruc: '10459630789', nombre: 'JorFel', regionExonerada: true, serieBoletaNC: 'BC01', serieFacturaNC: 'FC01' }

describe('calcularTotales (los mismos números en los dos formatos)', () => {
  it('en región exonerada todo va a Op. Exonerada y el IGV es 0', () => {
    const t = calcularTotales([{ precioVenta: 0.6, cantidad: 5, tipoAfectacion: '20' }], { regionExonerada: true })
    assert.equal(t.opExoneradas, 3)
    assert.equal(t.opGravadas, 0)
    assert.equal(t.igv, 0)
    assert.equal(t.total, 3)
  })

  it('en un producto gravado despeja el IGV del precio final (que ya lo incluye)', () => {
    const t = calcularTotales([{ precioVenta: 11.8, cantidad: 1, tipoAfectacion: '10' }], { regionExonerada: false })
    assert.equal(t.opGravadas, 10)
    assert.equal(t.igv, 1.8)
    assert.equal(t.total, 11.8)
  })

  it('reparte el descuento antes de despejar el IGV (mismo criterio que el comprobante)', () => {
    // Dos líneas de 5.90 con 1.80 de descuento: lo declarado tiene que ser lo COBRADO (10.00).
    const t = calcularTotales([{ precioVenta: 5.9, cantidad: 2, tipoAfectacion: '20' }], { regionExonerada: true })
    assert.equal(t.total, 11.8)
  })

  it('la afectación manda por producto: exonerado + gravado en el mismo documento', () => {
    const t = calcularTotales([
      { precioVenta: 3, cantidad: 1, tipoAfectacion: '20' },
      { precioVenta: 11.8, cantidad: 1, tipoAfectacion: '10' },
    ], { regionExonerada: true })
    assert.equal(t.opExoneradas, 3)
    assert.equal(t.opGravadas, 10)
    assert.equal(t.igv, 1.8)
  })
})

describe('obtenerInfoAfectacion', () => {
  it('agrupa las tasas como el catálogo tributario', () => {
    assert.deepEqual(obtenerInfoAfectacion('10'), { tasa: 0.18, tipo: 'gravado' })
    assert.deepEqual(obtenerInfoAfectacion('17'), { tasa: 0.18, tipo: 'gravado' })
    assert.deepEqual(obtenerInfoAfectacion('18'), { tasa: 0.04, tipo: 'gravado' })
    assert.deepEqual(obtenerInfoAfectacion('20'), { tasa: 0, tipo: 'exonerado' })
    assert.deepEqual(obtenerInfoAfectacion('30'), { tasa: 0, tipo: 'inafecto' })
  })
})

describe('normalizarMontosNota (una NC se declara en positivo)', () => {
  it('pasa a positivo los montos de una nota de crédito guardada en negativo', () => {
    const nc = normalizarMontosNota({
      items: [{ nombre: 'HUEVOS', precioVenta: -0.6, subtotal: -3, cantidad: 5 }],
      total: -3, importe_total: -3, efectivo: -3, montoRecibido: -5, cambio: -2,
    }, 'NC')
    assert.equal(nc.total, 3)
    assert.equal(nc.items[0].precioVenta, 0.6)
    assert.equal(nc.items[0].subtotal, 3)
    assert.equal(nc.cambio, 2)
    // El original no se muta: se devuelve una copia.
    assert.equal(nc.items[0].cantidad, 5)
  })

  it('una ND también se normaliza, y una venta normal no se toca', () => {
    assert.equal(normalizarMontosNota({ total: -5 }, 'ND').total, 5)
    const nv = { total: 11, items: [] }
    assert.equal(normalizarMontosNota(nv, 'NV'), nv, 'devuelve el mismo objeto sin copiar')
    assert.equal(normalizarMontosNota(nv, 'BOLETA').total, 11)
  })
})

describe('serieNota y construirQRData', () => {
  it('una NC de una boleta usa la serie de NC de boleta y una de factura la de factura', () => {
    assert.equal(serieNota(CONFIG, { docReferencia: 'B001-000064' }, 'NC'), 'BC01')
    assert.equal(serieNota(CONFIG, { documentoReferencia: 'F001-000012' }, 'NC'), 'FC01')
    assert.equal(serieNota(CONFIG, { docReferencia: 'F001-000012' }, 'ND'), 'FD01')
  })

  it('arma el QR con los datos de SUNAT en el orden que exige el comprobante', () => {
    const qr = construirQRData(
      // ⚠️ Fecha al mediodía UTC: a las 04:01Z en Lima todavía es el día anterior, y la fecha del QR
      // se arma con la fecha **local** (igual que el resto de la app).
      { cliente_dni: '12345678', items: [{ precioVenta: 11.8, cantidad: 1, tipoAfectacion: '10' }], fecha: '2026-09-21T12:00:00.000Z' },
      64,
      { ...CONFIG, regionExonerada: false },
      'BOLETA',
      { hash: 'abc123', serie: 'B001', numero: 64 },
    )
    assert.deepEqual(qr.split('|'), ['10459630789', '03', 'B001', '64', '1.80', '11.80', '2026-09-21', '1', '12345678', 'abc123'])
  })
})

describe('el título del documento', () => {
  it('es el mismo que imprime la ticketera', () => {
    assert.equal(TITULOS.BOLETA, 'BOLETA DE VENTA ELECTRÓNICA')
    assert.equal(TITULOS.FACTURA, 'FACTURA ELECTRÓNICA')
    assert.equal(TITULOS.NC, 'NOTA DE CRÉDITO ELECTRÓNICA')
    assert.equal(TITULOS.ND, 'NOTA DE DÉBITO ELECTRÓNICA')
    assert.equal(TITULOS.NV, 'NOTA DE VENTA')
  })
})

describe('GUARDA: la ticketera no se toca', () => {
  const pdf = readFileSync('src/lib/pdf.ts', 'utf8')
  // Solo la parte del comprobante: en `pdf.ts` también viven el arqueo y el cierre de caja, que son
  // A4 **a propósito** y no tienen nada que ver con la ticketera.
  const desde = pdf.indexOf('export async function construirHTMLComprobante')
  const hasta = pdf.indexOf('export async function abrirPDFComprobante')
  const comprobante = pdf.slice(desde, hasta)

  it('el PDF de la ticketera sigue saliendo en 72 mm (el A4 es un papel aparte)', () => {
    assert.ok(comprobante.length > 1000, 'se tiene que poder leer el generador del ticket')
    assert.ok(comprobante.includes('size:72mm auto'), 'el ticket tiene que seguir con @page size:72mm auto')
    assert.ok(!comprobante.includes('size:A4'), 'el A4 del comprobante va en lib/comprobante-a4.ts')
  })

  it('el generador del ticket sigue existiendo y exportado', () => {
    assert.ok(pdf.includes('export async function construirHTMLComprobante'))
    assert.ok(pdf.includes('export async function abrirPDFComprobante'))
  })

  it('el ticket usa las reglas compartidas en vez de tener su propia copia', () => {
    assert.ok(pdf.includes("from '@/lib/comprobante-comun'"), 'tiene que importar las reglas compartidas')
    assert.ok(pdf.includes('normalizarMontosNota'), 'la normalización de NC/ND es una sola regla')
    assert.ok(!pdf.includes('function calcularTotales'), 'calcularTotales ya no vive duplicado en el ticket')
  })
})
