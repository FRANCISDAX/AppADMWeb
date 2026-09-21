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
import QRCode from 'qrcode'

import { construirPDFComprobanteA4, datosComprobanteA4, disposicionEncabezadoA4, limpiarTextoA4, nombreArchivoComprobante, COLUMNAS_A4, LOGO_CAJA } from './comprobante-a4.ts'

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

async function textoDelPDF(doc: Record<string, unknown>, config: Record<string, unknown> = CONFIG) {
  const { pdf } = await construirPDFComprobanteA4(doc, config, { comprimir: false })
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

describe('⚠️ el logo no puede tapar el nombre de la empresa', () => {
  // Bug real del 21/09/2026: el logo se dibujaba con ancho 0 (= tamaño natural de la imagen) y el
  // texto de la empresa salía ENCIMA. Ahora el logo se encaja en una caja y el texto baja.
  it('un logo tipo banner (400x100) se encaja en la caja y el texto arranca debajo', () => {
    const d = disposicionEncabezadoA4({ width: 400, height: 100 })
    assert.ok(d.logo, 'el logo tiene que dibujarse')
    assert.equal(d.logo.w, LOGO_CAJA.ancho, 'limitado por el ancho máximo')
    assert.equal(d.logo.h, 12.5, 'alto proporcional (400x100 → 50x12.5)')
    assert.ok(d.textoY >= d.logo.y + d.logo.h + 3, `el texto (${d.textoY}) tiene que quedar debajo del logo (${d.logo.y + d.logo.h})`)
  })

  it('un logo alto (100x400) se limita por el alto y deja libre el ancho', () => {
    const d = disposicionEncabezadoA4({ width: 100, height: 400 })
    assert.ok(d.logo)
    assert.equal(d.logo.h, LOGO_CAJA.alto)
    assert.ok(d.logo.w <= LOGO_CAJA.ancho)
    assert.ok(d.textoY >= d.logo.y + d.logo.h + 3)
  })

  it('sin logo el texto queda en su altura normal', () => {
    assert.deepEqual(disposicionEncabezadoA4(null), { logo: null, textoY: 18 })
    // Una imagen sin dimensiones útiles no puede romper el encabezado (ni dar NaN).
    assert.deepEqual(disposicionEncabezadoA4({ width: 0, height: 0 }), { logo: null, textoY: 18 })
  })

  it('el logo nunca invade la caja del RUC/documento (que empieza en x=118)', () => {
    const d = disposicionEncabezadoA4({ width: 1000, height: 100 })
    assert.ok(d.logo)
    assert.ok(d.logo.x + d.logo.w <= 118, 'el logo tiene que terminar antes de la caja del documento')
  })

  it('con un logo REAL (data URL, como el de producción) el PDF se arma y el nombre sigue visible', async () => {
    // El logo de JorFel es un banner ancho: acá se usa un PNG de verdad para ejercitar
    // `getImageProperties` + `addImage` (el camino que estaba roto con ancho 0).
    const logo = await QRCode.toDataURL('LOGO', { margin: 0, width: 400 })
    const { txt } = await textoDelPDF({ ...BOLETA }, { ...CONFIG, logo_url: logo })
    assert.ok(txt.startsWith('%PDF'))
    assert.ok(txt.includes('JorFel'), 'el nombre de la empresa tiene que seguir estando')
    assert.ok(txt.includes('/XObject'), 'el logo entra como imagen')
    assert.ok(BOLETA.venta.items.length > 0 && txt.includes('HUEVOS'), 'y los ítems siguen imprimiéndose')
  })

  it('si el logo viene roto, el A4 se genera igual y sin superponer nada', async () => {
    const { txt } = await textoDelPDF({ ...BOLETA }, { ...CONFIG, logo_url: 'data:image/png;base64,ESTO-NO-ES-UNA-IMAGEN' })
    assert.ok(txt.startsWith('%PDF'))
    assert.ok(txt.includes('JorFel'))
  })
})

describe('⚠️ el código del producto no puede pisar la descripción', () => {
  // Bug real del 21/09/2026: la columna tenía 17 mm y un EAN-13 o una referencia `P-1788…` se
  // desbordaba sobre el nombre del producto.
  const PT_A_MM = 0.3528 // 1 pt = 0.3528 mm
  const anchoDigito = 0.556 // dígitos en Helvetica (em)

  it('la columna del código entra un EAN-13 y una referencia larga a la fuente de la columna', () => {
    const mmPorEm = COLUMNAS_A4.fuenteCodigo * PT_A_MM
    const ean13 = 13 * anchoDigito * mmPorEm
    const referencia = 15 * anchoDigito * mmPorEm // P-1788835884480
    assert.ok(ean13 < COLUMNAS_A4.codigoAncho, `EAN-13 (${ean13.toFixed(1)} mm) tiene que entrar`)
    assert.ok(referencia < COLUMNAS_A4.codigoAncho, `referencia (${referencia.toFixed(1)} mm) tiene que entrar`)
  })

  it('las columnas no se solapan y la descripción empieza después del código', () => {
    assert.ok(COLUMNAS_A4.descripcion - COLUMNAS_A4.codigo >= COLUMNAS_A4.codigoAncho, 'el hueco del código tiene que ser al menos su ancho útil')
    assert.ok(COLUMNAS_A4.descripcion + COLUMNAS_A4.descripcionAncho < COLUMNAS_A4.unidad - 4, 'la descripción no puede tocar la columna UND')
    assert.ok(COLUMNAS_A4.cantidad < COLUMNAS_A4.valorUnitario && COLUMNAS_A4.valorUnitario < COLUMNAS_A4.precioUnitario && COLUMNAS_A4.precioUnitario < COLUMNAS_A4.descuento && COLUMNAS_A4.descuento < COLUMNAS_A4.importe, 'el orden de las columnas numéricas')
  })

  it('un código larguísimo se recorta en vez de desbordarse (el PDF sigue siendo válido)', async () => {
    const { txt } = await textoDelPDF({
      ...BOLETA,
      venta: { ...BOLETA.venta, items: [{ nombre: 'Producto con referencia larga', cantidad: 1, precioVenta: 1, subtotal: 1, unidad: 'UND', tipoAfectacion: '20', codigo: 'P-1788835884480123456789' }], total: 1, importe_total: 1 },
    })
    assert.ok(txt.includes('Producto con referencia larga'))
    assert.ok(!txt.includes('P-1788835884480123456789'), 'el código se recorta antes de invadir la descripción')
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
