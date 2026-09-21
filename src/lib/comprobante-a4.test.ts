/**
 * Pruebas del **comprobante en A4** (`lib/comprobante-a4.ts`) — el papel que se envía por correo o
 * WhatsApp cuando el cliente no tiene ticketera.
 *
 * Se genera el PDF de verdad (jsPDF sin navegador) y se inspecciona su contenido **sin comprimir**
 * (`comprimir: false`): así se puede comprobar que los datos están, que los acentos se codifican bien
 * y que el importe coincide con el que imprime la ticketera.
 *
 * Runner nativo de Node: `npm test`.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { construirPDFComprobanteA4, datosComprobanteA4, limpiarTextoA4, nombreArchivoComprobante } from './comprobante-a4.ts'

const CONFIG = {
  nombre: 'JorFel',
  ruc: '10459630789',
  direccion: 'Av. Los Álamos 123 · Iquitos',
  telefono: '965123456',
  correo: 'ventas@jorfel.pe',
  regionExonerada: true,
  serieBoletaNC: 'BC01',
}

/** Boleta real de JorFel (21/09/2026): 2 líneas exoneradas, cobrada en efectivo. */
const BOLETA = {
  tipoDoc: 'BOLETA',
  numero: 64,
  serieNumero: 'B001-000064',
  correlativo: 64,
  sunat: { hash: 'a1b2c3d4e5', serie: 'B001', numero: 64, cdr_code: '0' },
  venta: {
    items: [
      { nombre: 'HUEVOS', cantidad: 5, precioVenta: 0.6, subtotal: 3, unidad: 'UND', tipoAfectacion: '20', codigo: 'P-1788835884480' },
      { nombre: 'Inka Cola Pirañita 237ML', cantidad: 3, precioVenta: 1, subtotal: 3, unidad: 'UND', tipoAfectacion: '20', codigo: '7126' },
    ],
    total: 6, importe_total: 6, tipoPago: 'efectivo', montoRecibido: 10, cambio: 4,
    cliente_nombre: 'José Ñáñez', cliente_dni: '12345678',
    fecha: '2026-09-21T04:01:06.402Z', cajero: 'FRANCIS DAX',
  },
}

async function textoDelPDF(doc: Record<string, unknown>) {
  const { pdf } = await construirPDFComprobanteA4(doc, CONFIG, { comprimir: false })
  return { txt: Buffer.from(pdf.output('arraybuffer')).toString('latin1'), pdf }
}

describe('datosComprobanteA4 (modelo, sin PDF)', () => {
  it('arma los totales con la misma regla que el ticket', () => {
    const m = datosComprobanteA4({ doc: BOLETA, correlativo: 64, config: CONFIG, tipoDoc: 'BOLETA', sunat: BOLETA.sunat })
    assert.equal(m.totales.total, 6)
    assert.equal(m.totales.opExoneradas, 6)
    assert.equal(m.totales.igv, 0)
    assert.equal(m.items.length, 2)
    assert.equal(m.items[0].valorUnitario, 0.6, 'exonerado: valor unitario = precio unitario')
    assert.equal(m.titulo, 'BOLETA DE VENTA ELECTRÓNICA')
    assert.equal(m.serieNumero, 'B001-000064')
    assert.ok(m.totales.sonLetras.length > 0)
  })

  it('en un producto gravado el valor unitario sale sin IGV', () => {
    const doc = { ...BOLETA, venta: { ...BOLETA.venta, items: [{ nombre: 'Gravado', cantidad: 1, precioVenta: 11.8, subtotal: 11.8, tipoAfectacion: '10' }], total: 11.8, importe_total: 11.8 } }
    const m = datosComprobanteA4({ doc, correlativo: 64, config: { ...CONFIG, regionExonerada: false }, tipoDoc: 'BOLETA' })
    assert.equal(m.items[0].valorUnitario, 10)
    assert.equal(m.items[0].precioUnitario, 11.8)
  })

  it('toma los nombres del documento cuando la venta no los trae (pedidos y NC)', () => {
    const doc = { tipoDoc: 'NV', numero: 7, cajero: 'FRANCIS DAX', vendedorNombre: 'JOHAN REYNA', venta: { items: [], total: 0.5, importe_total: 0.5 } }
    const m = datosComprobanteA4({ doc, correlativo: 7, config: CONFIG, tipoDoc: 'NV' })
    assert.ok(m.personal.includes('FRANCIS DAX'))
    assert.ok(m.personal.includes('JOHAN REYNA'))
  })

  it('una NC guardada en negativo se muestra en positivo y con su documento de referencia', () => {
    const nc = {
      tipoDoc: 'NC', numero: 3, serieNumero: 'BC01-000003',
      venta: { items: [{ nombre: 'GAL SODA DIA', cantidad: 1, precioVenta: -1, subtotal: -1, tipoAfectacion: '20' }], total: -1, importe_total: -1, docReferencia: 'B001-000064', tipoDocOriginal: 'BOLETA', motivo: 'Devolución de mercadería', codigoMotivo: '01' },
    }
    const m = datosComprobanteA4({ doc: nc, correlativo: 3, config: CONFIG, tipoDoc: 'NC', sunat: { hash: 'zzz', serie: 'BC01', numero: 3 } })
    assert.equal(m.totales.total, 1)
    assert.equal(m.items[0].precioUnitario, 1)
    assert.equal(m.referencia?.documento, 'B001-000064')
    assert.equal(m.referencia?.motivo, 'Devolución de mercadería')
    assert.equal(m.titulo, 'NOTA DE CRÉDITO ELECTRÓNICA')
  })
})

describe('limpiarTextoA4 (lo que la fuente del PDF no puede mostrar)', () => {
  it('saca emojis y comillas tipográficas, y conserva los acentos', () => {
    assert.equal(limpiarTextoA4('🚚 Envío a domicilio'), 'Envío a domicilio')
    assert.equal(limpiarTextoA4('“Nota” — fin'), '"Nota" - fin')
    assert.equal(limpiarTextoA4('Señor(es): José Ñáñez'), 'Señor(es): José Ñáñez')
    assert.equal(limpiarTextoA4(undefined), '')
  })
})

describe('nombreArchivoComprobante', () => {
  it('usa el serie-número, que es lo que el cliente busca en su correo', () => {
    assert.equal(nombreArchivoComprobante({ serieNumero: 'B001-000064' }), 'B001-000064.pdf')
    assert.equal(nombreArchivoComprobante({ tipoDoc: 'NC', numero: 3 }, 'NC'), 'NC-3.pdf')
  })
})

describe('el PDF A4 generado', () => {
  it('lleva la empresa, el RUC, el comprobante, el cliente y los ítems', async () => {
    const { txt } = await textoDelPDF(BOLETA)
    assert.ok(txt.startsWith('%PDF'), 'es un PDF de verdad')
    assert.ok(txt.includes('%%EOF'), 'el PDF tiene que cerrar con %%EOF (no truncado)')
    assert.ok(txt.includes('/Type /Page'), 'con al menos una página declarada')
    assert.ok(txt.includes('JorFel'))
    assert.ok(txt.includes('10459630789'))
    assert.ok(txt.includes('BOLETA DE VENTA ELECTRÓNICA'))
    assert.ok(txt.includes('B001-000064'))
    assert.ok(txt.includes('HUEVOS'))
    assert.ok(txt.includes('Inka Cola Pira'))
    assert.ok(txt.includes('TOTAL IMPORTE'))
    assert.ok(txt.includes('6.00'), 'el total tiene que estar')
    assert.ok(txt.includes('SON:'))
  })

  it('los acentos y la ñ se codifican en WinAnsi (no sale "SeÃ±or")', async () => {
    const { txt } = await textoDelPDF(BOLETA)
    // ⚠️ jsPDF escapa los paréntesis del texto en el stream (`Señor\(es\)`): se busca así.
    assert.ok(txt.includes('Señor\\(es\\)'), 'la ñ tiene que verse como 0xF1, no rota')
    assert.ok(!txt.includes('SeÃ'), 'no puede aparecer la ñ mal codificada')
    assert.ok(Buffer.from(txt, 'latin1').includes(Buffer.from([0xf1])), 'byte 0xF1 de la ñ presente')
    assert.ok(txt.includes('Álamos'), 'la dirección con acento también viaja bien')
  })

  it('lleva el QR, el hash y la leyenda de representación impresa', async () => {
    const { txt } = await textoDelPDF(BOLETA)
    assert.ok(txt.includes('Representación impresa de la BOLETA DE VENTA ELECTRÓNICA'))
    assert.ok(txt.includes('a1b2c3d4e5'), 'el hash del CDR va impreso')
    assert.ok(txt.includes('/XObject'), 'el QR va embebido como imagen')
  })

  it('una nota de venta no lleva leyenda de SUNAT, sino que avisa que es interna', async () => {
    const { txt } = await textoDelPDF({ tipoDoc: 'NV', numero: 180, serieNumero: 'NV01-000180', venta: { items: [{ nombre: 'Cigarro Hamilton', cantidad: 1, precioVenta: 0.5, subtotal: 0.5, tipoAfectacion: '20' }], total: 0.5, importe_total: 0.5, tipoPago: 'efectivo' } })
    assert.ok(txt.includes('Documento interno'))
    assert.ok(!txt.includes('Representación impresa'))
  })

  it('muestra la fila de descuento cuando la venta tiene promoción', async () => {
    const conDescuento = {
      ...BOLETA,
      venta: { ...BOLETA.venta, descuentoTotal: 1, items: [{ nombre: 'GAL SODA DIA', cantidad: 2, precioVenta: 1, subtotal: 2, tipoAfectacion: '20' }], total: 1, importe_total: 1 },
    }
    const { txt } = await textoDelPDF(conDescuento)
    assert.ok(txt.includes('Descuento'))
    assert.ok(txt.includes('- S/ 1.00'))
    assert.ok(txt.includes('S/ 1.00'), 'el total cobrado, no el de lista')
  })

  it('una NC sale en positivo (mismo importe que la ticketera)', async () => {
    const { txt } = await textoDelPDF({
      tipoDoc: 'NC', numero: 3, serieNumero: 'BC01-000003',
      sunat: { hash: 'zzz', serie: 'BC01', numero: 3 },
      venta: { items: [{ nombre: 'GAL SODA DIA', cantidad: 1, precioVenta: -1, subtotal: -1, tipoAfectacion: '20' }], total: -1, importe_total: -1, docReferencia: 'B001-000064', motivo: 'Devolución' },
    })
    assert.ok(txt.includes('NOTA DE CRÉDITO ELECTRÓNICA'))
    assert.ok(!txt.includes('-1.00'), 'no puede imprimir el importe en negativo')
    assert.ok(txt.includes('Documento que modifica'))
  })

  it('marca el documento anulado', async () => {
    const { txt } = await textoDelPDF({ ...BOLETA, anulacion: { motivo: 'Error en el monto' } })
    assert.ok(txt.includes('ESTE DOCUMENTO HA SIDO ANULADO'))
    assert.ok(txt.includes('Error en el monto'))
  })

  it('pagina una venta larga y numera las páginas', async () => {
    const items = Array.from({ length: 70 }, (_, i) => ({ nombre: `Producto de prueba con nombre largo ${i + 1}`, cantidad: 1, precioVenta: 1, subtotal: 1, unidad: 'UND', tipoAfectacion: '20' }))
    const { pdf } = await textoDelPDF({ ...BOLETA, venta: { ...BOLETA.venta, items, total: 70, importe_total: 70 } })
    assert.ok(pdf.getNumberOfPages() >= 2, 'una venta de 70 líneas tiene que pasar a la segunda página')
    const txt = Buffer.from(pdf.output('arraybuffer')).toString('latin1')
    assert.ok(txt.includes('Página 1 de'))
  })

  it('el formato es A4 (210 x 297 mm), no el de la ticketera', async () => {
    const { pdf } = await textoDelPDF(BOLETA)
    const ancho = pdf.internal.pageSize.getWidth()
    const alto = pdf.internal.pageSize.getHeight()
    assert.equal(Math.round(ancho), 210)
    assert.equal(Math.round(alto), 297)
  })
})
