/**
 * **Comprobante en A4** — para cuando el cliente pide que se lo **envíen por correo o WhatsApp** (o
 * lo quieren imprimir en papel normal). Módulo nuevo e independiente del ticket de ticketera.
 *
 * 🔑 **El ticket de 72 mm (`lib/pdf.ts`) no se toca**: la ticketera sigue imprimiendo igual, con su
 * `@page { size:72mm auto }`, porque el POS de la tienda no cambia. Acá se genera **otro documento**
 * (un PDF A4 de verdad, vectorial y con el QR embebido) que se puede **ver, imprimir, descargar o
 * compartir** — y compartirlo es lo que permite mandarlo por WhatsApp o correo sin ninguna API: el
 * celular o la PC abren la hoja de compartir con el PDF adjunto.
 *
 * ⚠️ **Los números no se recalculan acá**: los totales SUNAT, el descuento, el valor unitario sin IGV,
 * el QR, la serie y los montos de una NC/ND salen de las mismas reglas que usa el ticket
 * (`lib/comprobante-comun.ts`, `lib/sunat-importes.ts`, `lib/pagos.ts`, `lib/personal.ts`). Si el A4
 * calculara por su cuenta, el cliente podría recibir un papel con otro importe que el que quedó
 * impreso en la ticketera.
 *
 * ⚠️ **jsPDF se carga con `import()` dinámico** para que no engorde el bundle inicial de la app: solo
 * pesa cuando alguien pide el A4.
 *
 * Módulo puro en su cálculo (`datosComprobanteA4`) y sin DOM salvo en las tres funciones de acción
 * (`abrir`, `descargar`, `compartir`), que es lo que se prueba con el runner nativo de Node.
 */

import { numeroALetras } from './numero-a-letras.ts'
import { etiquetaPago, formaPagoLabel, textoReferenciaPago } from './pagos.ts'
import { cantidadDe, descuentoDeVenta, importeBrutoDe, itemsConDescuento, valorUnitarioSunat } from './sunat-importes.ts'
import { lineasPersonal, personalDeVenta } from './personal.ts'
import { TITULOS, calcularTotales, construirQRData, generarQRDataUrl, normalizarMontosNota } from './comprobante-comun.ts'
import { etiquetaIgv, porcentajeDelDocumento, tasaDePorcentaje } from './igv.ts'

/** Documento tal como lo entrega Firestore (venta + campos que viven a nivel del documento). */
export type DocComprobante = {
  venta?: Record<string, any>
  tipoDoc?: string
  tipo?: string
  numero?: number | string
  correlativo?: number | string
  serieNumero?: string
  sunat?: Record<string, any> | null
  anulacion?: Record<string, any> | null
  cajero?: string
  vendedorNombre?: string
}

type Config = Record<string, any>

export type ItemA4 = {
  codigo: string
  descripcion: string
  unidad: string
  cantidad: number
  /** Valor unitario **sin IGV** (solo se divide en afectación gravada). */
  valorUnitario: number
  /** Precio unitario final, con IGV incluido si corresponde. */
  precioUnitario: number
  descuento: number
  importe: number
}

export type ModeloA4 = {
  tipoDoc: string
  titulo: string
  serieNumero: string
  fechaStr: string
  horaStr: string
  empresa: { nombre: string; ruc: string; direccion: string; contacto: string; sucursal: string; logoUrl: string }
  cliente: { etiquetaDoc: string; nombre: string; documento: string; direccion: string; envio: string }
  items: ItemA4[]
  totales: {
    opGravadas: number
    opExoneradas: number
    opInafectas: number
    igv: number
    descuento: number
    total: number
    sonLetras: string
    /** 🔑 La tasa del documento, para el título de la fila (`I.G.V. (18%)` / `I.G.V. (10%)`). */
    igvPorcentaje: number
  }
  pago: { formaPago: string; lineas: { etiqueta: string; monto: string }[]; recibido: number; vuelto: number; credito: boolean; cobrado: number; referencia: string }
  referencia: { documento: string; original: string; motivo: string; codigo: string } | null
  personal: string
  mensaje: string
  autorizacion: string
  validarEn: string
  esElectronico: boolean
  anulacion: { motivo: string } | null
  qrTexto: string
  /** Hash del CDR (va impreso junto al QR, igual que en la ticketera). */
  hash: string
}

/**
 * Limpia un texto para el PDF. La fuente estándar de jsPDF usa **WinAnsi**, que sí tiene acentos,
 * `ñ`, `°`, `×` y `·`, pero **no** emojis ni comillas tipográficas: si viajaran, el cliente vería
 * basura. Se reemplazan por su equivalente de teclado o se descartan.
 */
export function limpiarTextoA4(texto: unknown): string {
  return String(texto ?? '')
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, '...')
    .replace(/\u00a0/g, ' ')
    // Emojis, flechas y símbolos que WinAnsi no tiene (🚚, ✅, ⚠️…): se descartan. El selector de
    // variación (FE0F) va **fuera** de la clase de caracteres: dentro es una clase engañosa
    // (`no-misleading-character-class`) porque combina con el carácter anterior.
    .replace(/[\u{1F000}-\u{1FAFF}]/gu, '')
    .replace(/[\u{2190}-\u{2BFF}]/gu, '')
    .replace(/\uFE0F|\u2705|\u26A0/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * Arma el **modelo de datos** del A4 con las mismas reglas que el ticket: mismas series, mismos
 * totales, mismo descuento, mismas personas y misma normalización de NC/ND.
 */
export function datosComprobanteA4({ doc, correlativo, config, tipoDoc = 'NV', sunat = null, anulacion = null }: {
  doc: DocComprobante
  correlativo: any
  config: Config
  tipoDoc?: string
  sunat?: Record<string, any> | null
  anulacion?: Record<string, any> | null
}): ModeloA4 {
  const original = doc.venta || {}
  // Igual que el ticket: los nombres también pueden vivir a nivel del documento.
  const ventaBase: Record<string, any> = { ...original }
  if (!ventaBase.cajero && doc.cajero) ventaBase.cajero = doc.cajero
  if (!ventaBase.vendedor && doc.vendedorNombre) ventaBase.vendedor = doc.vendedorNombre

  const venta = normalizarMontosNota(ventaBase, tipoDoc)

  const fecha = new Date(venta.fecha || venta.createdAt || Date.now())
  const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`
  const horaStr = venta.hora || fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

  const itemsFuente: any[] = Array.isArray(venta.items) ? venta.items : []
  const descuentoDoc = descuentoDeVenta(venta)
  // 🔑 La tasa del documento (18% general, 10% restaurantes/hoteles): la misma que usa el XML y el ticket.
  const igvPorcentaje = porcentajeDelDocumento(venta, config)
  const tasaIgv = tasaDePorcentaje(igvPorcentaje)
  const totalesCalc = calcularTotales(itemsConDescuento(itemsFuente, descuentoDoc), { regionExonerada: config?.regionExonerada, tasaIgv })

  const items: ItemA4[] = itemsFuente.map((it) => {
    const cantidad = cantidadDe(it)
    const precioUnitario = Number(it.precioVenta || it.precio_unitario || 0)
    const afectacion = it.tipoAfectacion || (config?.regionExonerada ? '20' : '10')
    return {
      codigo: limpiarTextoA4(it.codigo || it.productoCodigo || it.id || ''),
      descripcion: limpiarTextoA4(it.nombre || it.descripcion || ''),
      unidad: limpiarTextoA4(it.unidad || it.presentacionNombre || '-'),
      cantidad,
      // 🔑 El valor unitario sin IGV sale de la **regla única** de SUNAT (solo divide en gravado), con la
      // tasa del documento (18% general, 10% restaurantes/hoteles).
      valorUnitario: valorUnitarioSunat(precioUnitario, afectacion, tasaIgv),
      precioUnitario,
      descuento: Number(it.descuento || 0),
      importe: Number(it.subtotal) > 0 ? Number(it.subtotal) : importeBrutoDe(it),
    }
  })

  const total = Number(venta.importe_total || venta.total || totalesCalc.total || 0)
  const sonLetras = limpiarTextoA4(venta.son_letras || numeroALetras(total)) || numeroALetras(total)

  const formaPago = limpiarTextoA4(venta.forma_pago || formaPagoLabel(venta.pagos ?? [], venta.tipoPago))
  const lineasPago: { etiqueta: string; monto: string }[] = []
  if (Array.isArray(venta.pagos) && venta.pagos.length > 1) {
    for (const p of venta.pagos) {
      lineasPago.push({
        etiqueta: `${limpiarTextoA4(etiquetaPago(p))}${p?.operacion ? ` · ${limpiarTextoA4(textoReferenciaPago(p.operacion))}` : ''}`,
        monto: Number(p?.monto || 0).toFixed(2),
      })
    }
  }

  const clienteNombre = limpiarTextoA4(venta.cliente_nombre || venta.cliente || 'Consumidor final')
  const clienteDoc = limpiarTextoA4(venta.cliente_dni || venta.clienteDoc || '-')
  const envioDoc = venta.envio || null
  const envioLinea = envioDoc && (envioDoc.direccion || envioDoc.notas)
    ? [
        envioDoc.direccion,
        envioDoc.referencia ? `Ref: ${envioDoc.referencia}` : '',
        envioDoc.notas,
        Number(envioDoc.costo) > 0 ? `Envío S/ ${Number(envioDoc.costo).toFixed(2)}` : '',
      ].filter(Boolean).map((x) => limpiarTextoA4(x)).join(' · ')
    : ''

  const referencia = (venta.docReferencia || venta.documentoReferencia || venta.motivo || venta.motivoNota)
    ? {
        documento: limpiarTextoA4(venta.docReferencia || venta.documentoReferencia || ''),
        original: limpiarTextoA4(venta.tipoDocOriginal || ''),
        motivo: limpiarTextoA4(venta.motivo || venta.motivoNota || ''),
        codigo: limpiarTextoA4(venta.codigoMotivo || ''),
      }
    : null

  const esElectronico = tipoDoc === 'BOLETA' || tipoDoc === 'FACTURA' || tipoDoc === 'NC' || tipoDoc === 'ND'
  const serieNumero = venta.serie_numero || doc.serieNumero
    || `${sunat?.serie || (tipoDoc === 'FACTURA' ? 'F001' : tipoDoc === 'BOLETA' ? 'B001' : 'NV')}-${String(correlativo).padStart(6, '0')}`

  return {
    tipoDoc,
    titulo: TITULOS[tipoDoc] || 'NOTA DE VENTA',
    serieNumero: limpiarTextoA4(serieNumero),
    fechaStr,
    horaStr,
    empresa: {
      nombre: limpiarTextoA4(config?.nombre || 'JorFel'),
      ruc: limpiarTextoA4(config?.ruc || ''),
      direccion: limpiarTextoA4(config?.direccion || ''),
      contacto: [config?.telefono ? `Cel: ${limpiarTextoA4(config.telefono)}` : '', limpiarTextoA4(config?.correo || '')].filter(Boolean).join('  ·  '),
      sucursal: limpiarTextoA4(venta.sucursal || ''),
      logoUrl: String(config?.logo_url || ''),
    },
    cliente: {
      etiquetaDoc: tipoDoc === 'FACTURA' ? 'RUC' : 'DNI',
      nombre: clienteNombre,
      documento: clienteDoc,
      direccion: limpiarTextoA4(venta.cliente_direccion || venta.clienteDireccion || ''),
      envio: envioLinea,
    },
    items,
    totales: {
      opGravadas: totalesCalc.opGravadas,
      opExoneradas: totalesCalc.opExoneradas,
      opInafectas: totalesCalc.opInafectas,
      igv: totalesCalc.igv,
      descuento: descuentoDoc,
      total,
      sonLetras,
      igvPorcentaje,
    },
    pago: {
      formaPago,
      lineas: lineasPago,
      recibido: Number(venta.montoRecibido || venta.efectivo || 0),
      vuelto: Number(venta.cambio || 0),
      credito: venta.tipoPago === 'credito' || formaPago.toLowerCase() === 'credito',
      cobrado: Number(venta.cobrado || 0),
      referencia: limpiarTextoA4(venta.referencia || ''),
    },
    referencia,
    personal: limpiarTextoA4(lineasPersonal(personalDeVenta({ cajero: venta.cajero, vendedor: venta.vendedor, vendedorNombre: venta.vendedorNombre }))
      .map((l) => `${l.etiqueta}: ${l.nombre}`)
      .join('  ·  ')),
    mensaje: limpiarTextoA4(venta.mensaje || '¡Gracias por su preferencia, vuelva pronto!'),
    autorizacion: limpiarTextoA4(venta.autorizacion || ''),
    validarEn: limpiarTextoA4(venta.validar_en || ''),
    esElectronico,
    anulacion: anulacion ? { motivo: limpiarTextoA4(anulacion.motivo || 'sin motivo') } : null,
    qrTexto: esElectronico && sunat
      ? `Representación impresa de la ${TITULOS[tipoDoc] || 'comprobante'}. Consúltela en www.sunat.gob.pe`
      : '',
    hash: limpiarTextoA4(sunat?.hash || ''),
  }
}

/** Nombre del archivo que se descarga o se comparte: el serie-número, que es lo que el cliente busca. */
export function nombreArchivoComprobante(doc: DocComprobante, tipoDoc?: string): string {
  const serie = String(doc.serieNumero || '').trim()
  const base = serie || `${tipoDoc || doc.tipoDoc || 'comprobante'}-${doc.numero || doc.correlativo || ''}`
  return `${base.replace(/[^\w.-]+/g, '_')}.pdf`
}

// ---------------------------------------------------------------------------------------------
// Dibujo del A4 (jsPDF). Coordenadas en milímetros: A4 = 210 x 297, márgenes de 15 mm.
// ---------------------------------------------------------------------------------------------

const M = 15
const ANCHO = 210 - M * 2
const LIMITE_Y = 258

/**
 * **Caja máxima del logo en el A4** (mm). ⚠️ El logo **nunca** se dibuja a su tamaño natural: un
 * banner de 400×100 px sin límite **tapaba el nombre de la empresa** (bug real del 21/09/2026, visto
 * en el PDF que mandó el usuario). Se encaja acá y, si sobra alto, el texto de la empresa baja.
 */
export const LOGO_CAJA = { ancho: 50, alto: 16 }

/**
 * **Encabezado del A4**: dónde va el logo (sin deformar, dentro de su caja) y en qué altura arranca el
 * texto de la empresa. Es una función pura para poder probar que **nunca se superponen**: el texto
 * empieza siempre por debajo del borde inferior del logo más un respiro.
 */
export function disposicionEncabezadoA4(natural: { width: number; height: number } | null): {
  logo: { x: number; y: number; w: number; h: number } | null
  textoY: number
} {
  const x = M
  const y = 12
  if (!natural || !(Number(natural.width) > 0) || !(Number(natural.height) > 0)) {
    return { logo: null, textoY: 18 }
  }
  const escala = Math.min(LOGO_CAJA.ancho / natural.width, LOGO_CAJA.alto / natural.height)
  const w = Math.round(natural.width * escala * 100) / 100
  const h = Math.round(natural.height * escala * 100) / 100
  return { logo: { x, y, w, h }, textoY: y + h + 5 }
}

/**
 * **Columnas de la tabla de ítems** (mm). El **código** tiene 25 mm porque un EAN-13
 * (`7750243077521`, 13 dígitos) o una referencia `P-1788835884480` miden ~20 mm a 6.8 pt: con los
 * 17 mm que tenía antes **se desbordaba sobre la descripción** (bug real del 21/09/2026).
 * Los dígitos en Helvetica miden 0.556 em, así que 15 caracteres ≈ 20 mm a 6.8 pt.
 */
export const COLUMNAS_A4 = {
  codigo: 16,
  codigoAncho: 25,
  fuenteCodigo: 6.8,
  descripcion: 43,
  descripcionAncho: 44,
  unidad: 96,
  cantidad: 116,
  valorUnitario: 133,
  precioUnitario: 151,
  descuento: 166,
  importe: M + ANCHO - 1,
}

/** Recorta un texto al ancho disponible a esa fuente, para que **nunca** invada la columna vecina. */
function recortarA(d: JSPDFDoc, texto: string, anchoMax: number, size: number): string {
  d.setFont('helvetica', 'normal')
  d.setFontSize(size)
  if (d.getTextWidth(texto) <= anchoMax) return texto
  let corte = texto
  while (corte.length > 1 && d.getTextWidth(corte + '…') > anchoMax) corte = corte.slice(0, -1)
  return corte + '…'
}

type JSPDFDoc = any

function texto(d: JSPDFDoc, s: string, x: number, y: number, opts?: { size?: number; bold?: boolean; align?: 'left' | 'right' | 'center'; color?: [number, number, number] }) {
  d.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
  d.setFontSize(opts?.size ?? 9)
  const c = opts?.color ?? [34, 34, 34]
  d.setTextColor(c[0], c[1], c[2])
  d.text(s, x, y, opts?.align ? { align: opts.align } : undefined)
}

function fila(d: JSPDFDoc, y: number, etiqueta: string, valor: string, opts?: { size?: number; bold?: boolean }) {
  texto(d, etiqueta, 120, y, { size: opts?.size ?? 9, bold: opts?.bold })
  texto(d, valor, M + ANCHO, y, { size: opts?.size ?? 9, bold: true, align: 'right' })
}

function encabezadoTabla(d: JSPDFDoc, y: number): number {
  d.setFillColor(238, 240, 244)
  d.rect(M, y, ANCHO, 7, 'F')
  texto(d, 'CÓDIGO', COLUMNAS_A4.codigo, y + 5, { size: 7.5, bold: true })
  texto(d, 'DESCRIPCIÓN', COLUMNAS_A4.descripcion, y + 5, { size: 7.5, bold: true })
  texto(d, 'UND', COLUMNAS_A4.unidad, y + 5, { size: 7.5, bold: true, align: 'center' })
  texto(d, 'CANT.', COLUMNAS_A4.cantidad, y + 5, { size: 7.5, bold: true, align: 'right' })
  texto(d, 'V. UNIT.', COLUMNAS_A4.valorUnitario, y + 5, { size: 7.5, bold: true, align: 'right' })
  texto(d, 'P. UNIT.', COLUMNAS_A4.precioUnitario, y + 5, { size: 7.5, bold: true, align: 'right' })
  texto(d, 'DESC.', COLUMNAS_A4.descuento, y + 5, { size: 7.5, bold: true, align: 'right' })
  texto(d, 'IMPORTE', COLUMNAS_A4.importe, y + 5, { size: 7.5, bold: true, align: 'right' })
  return y + 7
}

/**
 * Dibuja el modelo en un documento jsPDF (recibido ya instanciado, para no acoplar el import
 * dinámico) y devuelve cuántas páginas quedaron.
 */
export function dibujarComprobanteA4(d: JSPDFDoc, m: ModeloA4, qrDataUrl: string): void {
  let y = 18

  // ---- Empresa (izquierda) ----
  // 🔑 El logo se encaja en su **caja** (`disposicionEncabezadoA4`) y el texto arranca **debajo**: un
  // logo ancho dibujado a tamaño natural tapaba el nombre de la empresa.
  if (m.empresa.logoUrl.startsWith('data:image')) {
    try {
      const nat = d.getImageProperties(m.empresa.logoUrl)
      const disp = disposicionEncabezadoA4({ width: nat.width, height: nat.height })
      if (disp.logo) {
        d.addImage(m.empresa.logoUrl, disp.logo.x, disp.logo.y, disp.logo.w, disp.logo.h)
        y = disp.textoY
      }
    } catch {
      // Logo ilegible: se omite y el texto queda en su altura normal (nunca encima de nada).
      console.warn('⚠️ No se pudo leer el logo de la empresa para el A4')
    }
  }
  texto(d, m.empresa.nombre, M, y, { size: 13, bold: true })
  y += 6
  if (m.empresa.direccion) { texto(d, m.empresa.direccion, M, y, { size: 8.5 }); y += 4.5 }
  if (m.empresa.sucursal) { texto(d, m.empresa.sucursal, M, y, { size: 8.5 }); y += 4.5 }
  if (m.empresa.contacto) { texto(d, m.empresa.contacto, M, y, { size: 8.5 }); y += 4.5 }

  // ---- Caja del documento (derecha) ----
  const cajaY = 12
  const cajaAlto = 34
  d.setDrawColor(34, 34, 34)
  d.setLineWidth(0.3)
  d.rect(118, cajaY, 77, cajaAlto)
  texto(d, `RUC: ${m.empresa.ruc}`, 156.5, cajaY + 6, { size: 10, bold: true, align: 'center' })
  d.setFillColor(0, 0, 0)
  d.rect(118, cajaY + 8.5, 77, 8, 'F')
  texto(d, m.titulo, 156.5, cajaY + 14.2, { size: 9.5, bold: true, align: 'center', color: [255, 255, 255] })
  texto(d, m.serieNumero, 156.5, cajaY + 24, { size: 12, bold: true, align: 'center' })
  texto(d, `Fecha de emisión: ${m.fechaStr} ${m.horaStr}`, 156.5, cajaY + 30, { size: 8, align: 'center' })

  y = Math.max(y, cajaY + cajaAlto) + 6
  d.setDrawColor(180, 184, 190)
  d.line(M, y - 2, M + ANCHO, y - 2)

  // ---- Cliente ----
  const altoCliente = 8 + (m.cliente.direccion ? 4.5 : 0) + (m.cliente.envio ? 4.5 : 0)
  d.setDrawColor(34, 34, 34)
  d.rect(M, y, ANCHO, altoCliente)
  let cy = y + 5.5
  texto(d, `Señor(es): ${m.cliente.nombre}`, M + 2, cy, { size: 9, bold: true })
  texto(d, `${m.cliente.etiquetaDoc}: ${m.cliente.documento}`, M + ANCHO - 2, cy, { size: 9, align: 'right' })
  cy += 4.5
  if (m.cliente.direccion) { texto(d, `Dirección: ${m.cliente.direccion}`, M + 2, cy, { size: 8.5 }); cy += 4.5 }
  if (m.cliente.envio) { texto(d, `Envío: ${m.cliente.envio}`, M + 2, cy, { size: 8.5 }); cy += 4.5 }
  y += altoCliente + 5

  // ---- Ítems ----
  y = encabezadoTabla(d, y)
  if (m.items.length === 0) {
    texto(d, 'Sin ítems registrados', M + 2, y + 5, { size: 8.5 })
    y += 8
  }
  for (let i = 0; i < m.items.length; i++) {
    const it = m.items[i]
    const lineas: string[] = d.splitTextToSize(it.descripcion || '-', COLUMNAS_A4.descripcionAncho)
    const alto = Math.max(6, lineas.length * 4)
    if (y + alto > LIMITE_Y) {
      d.addPage()
      y = encabezadoTabla(d, 18)
    }
    if (i % 2 === 1) {
      d.setFillColor(248, 249, 250)
      d.rect(M, y, ANCHO, alto, 'F')
    }
    d.setDrawColor(226, 232, 240)
    d.line(M, y + alto, M + ANCHO, y + alto)
    const base = y + 4.2
    // El código se recorta al ancho de SU columna: nunca se mete en la descripción.
    texto(d, recortarA(d, it.codigo, COLUMNAS_A4.codigoAncho - 2, COLUMNAS_A4.fuenteCodigo), COLUMNAS_A4.codigo, base, { size: COLUMNAS_A4.fuenteCodigo })
    lineas.forEach((ln: string, k: number) => texto(d, ln, COLUMNAS_A4.descripcion, base + k * 4, { size: 8 }))
    texto(d, recortarA(d, it.unidad, 14, 7), COLUMNAS_A4.unidad, base, { size: 7, align: 'center' })
    texto(d, it.cantidad.toFixed(2), COLUMNAS_A4.cantidad, base, { size: 7.5, align: 'right' })
    texto(d, it.valorUnitario.toFixed(2), COLUMNAS_A4.valorUnitario, base, { size: 7.5, align: 'right' })
    texto(d, it.precioUnitario.toFixed(2), COLUMNAS_A4.precioUnitario, base, { size: 7.5, align: 'right' })
    texto(d, it.descuento > 0 ? it.descuento.toFixed(2) : '-', COLUMNAS_A4.descuento, base, { size: 7.5, align: 'right' })
    texto(d, it.importe.toFixed(2), COLUMNAS_A4.importe, base, { size: 7.5, bold: true, align: 'right' })
    y += alto
  }

  y += 3
  texto(d, `Items: ${m.items.length}`, M, y, { size: 8, color: [110, 116, 124] })
  y += 6

  // ---- Totales ----
  const filas: [string, string][] = []
  if (m.totales.descuento > 0) filas.push(['Descuento', `- S/ ${m.totales.descuento.toFixed(2)}`])
  const hayGravadas = Math.abs(m.totales.opGravadas) > 0
  if (hayGravadas) {
    filas.push(['Op. Gravadas', `S/ ${m.totales.opGravadas.toFixed(2)}`])
  } else if (Math.abs(m.totales.opExoneradas) > 0) {
    filas.push(['Op. Exonerada', `S/ ${m.totales.opExoneradas.toFixed(2)}`])
  } else if (Math.abs(m.totales.opInafectas) > 0) {
    filas.push(['Op. Inafecta', `S/ ${m.totales.opInafectas.toFixed(2)}`])
  } else {
    filas.push(['Op. Gratuita', 'S/ 0.00'])
  }
  filas.push([etiquetaIgv(m.totales.igvPorcentaje), `S/ ${m.totales.igv.toFixed(2)}`])
  filas.push(['I.C.B.P.E.R.', 'S/ 0.00'])
  filas.push(['Moneda', 'Soles'])

  if (y + filas.length * 5 + 22 > LIMITE_Y) { d.addPage(); y = 18 }
  for (const [etiqueta, valor] of filas) {
    fila(d, y, etiqueta, valor)
    y += 5
  }
  d.setFillColor(0, 0, 0)
  d.rect(118, y - 1, 77, 8, 'F')
  texto(d, 'TOTAL IMPORTE', 120, y + 4.4, { size: 9.5, bold: true, color: [255, 255, 255] })
  texto(d, `S/ ${m.totales.total.toFixed(2)}`, M + ANCHO - 1, y + 4.4, { size: 11, bold: true, align: 'right', color: [255, 255, 255] })
  y += 12

  // ---- Son letras + forma de pago ----
  texto(d, `SON: ${m.totales.sonLetras} SOLES`, M, y, { size: 8.5, bold: true })
  y += 6

  const pagos: string[] = [`Forma de pago: ${m.pago.formaPago}`]
  for (const l of m.pago.lineas) pagos.push(`${l.etiqueta}: S/ ${l.monto}`)
  if (m.pago.credito) pagos.push(m.pago.cobrado > 0 ? `Crédito (cobrado S/ ${m.pago.cobrado.toFixed(2)})` : 'Crédito')
  else if (m.pago.recibido > 0) pagos.push(`Efectivo recibido: S/ ${m.pago.recibido.toFixed(2)}  ·  Vuelto: S/ ${m.pago.vuelto.toFixed(2)}`)
  if (m.pago.referencia) pagos.push(`Referencia: ${m.pago.referencia}`)
  for (const linea of pagos) {
    texto(d, linea, M, y, { size: 8.5 })
    y += 4.5
  }

  // ---- Referencia de la NC/ND ----
  if (m.referencia && (m.referencia.documento || m.referencia.motivo)) {
    y += 1.5
    if (m.referencia.documento) { texto(d, `Documento que modifica: ${m.referencia.original ? m.referencia.original + ' ' : ''}${m.referencia.documento}`, M, y, { size: 8.5, bold: true }); y += 4.5 }
    if (m.referencia.codigo) { texto(d, `Código de motivo: ${m.referencia.codigo}`, M, y, { size: 8.5 }); y += 4.5 }
    if (m.referencia.motivo) { texto(d, `Motivo: ${m.referencia.motivo}`, M, y, { size: 8.5 }); y += 4.5 }
  }
  if (m.autorizacion) { texto(d, `Autorización: ${m.autorizacion}`, M, y, { size: 8 }); y += 4.5 }
  if (m.validarEn) { texto(d, `Validar en: ${m.validarEn}`, M, y, { size: 8 }); y += 4.5 }

  // ---- QR + hash + leyenda legal (igual que la representación impresa de la ticketera) ----
  if (m.esElectronico && qrDataUrl) {
    const altoQr = 30
    if (y + altoQr + 10 > LIMITE_Y) { d.addPage(); y = 18 }
    d.addImage(qrDataUrl, 'PNG', M, y, altoQr, altoQr)
    let qy = y + 6
    for (const ln of d.splitTextToSize(m.qrTexto, 108)) {
      texto(d, ln, M + altoQr + 4, qy, { size: 7.5, color: [90, 96, 104] })
      qy += 4
    }
    if (m.hash) {
      for (const ln of d.splitTextToSize(`Hash: ${m.hash}`, 108)) {
        texto(d, ln, M + altoQr + 4, qy, { size: 7, color: [110, 116, 124] })
        qy += 3.6
      }
    }
    y += altoQr + 4
  } else if (!m.esElectronico) {
    texto(d, 'Documento interno (no es comprobante de pago electrónico).', M, y, { size: 8, color: [110, 116, 124] })
    y += 5
  }

  // ---- Anulado ----
  if (m.anulacion) {
    if (y + 16 > LIMITE_Y) { d.addPage(); y = 18 }
    d.setFillColor(253, 236, 234)
    d.setDrawColor(211, 47, 47)
    d.rect(M, y, ANCHO, 13, 'FD')
    texto(d, 'ESTE DOCUMENTO HA SIDO ANULADO', M + 2, y + 5.5, { size: 9.5, bold: true, color: [211, 47, 47] })
    texto(d, `Motivo: ${m.anulacion.motivo}`, M + 2, y + 10.5, { size: 8.5, color: [183, 28, 28] })
    y += 17
  }

  // ---- Pie ----
  if (y + 14 > LIMITE_Y) { d.addPage(); y = 18 }
  d.setDrawColor(180, 184, 190)
  d.line(M, y, M + ANCHO, y)
  y += 4.5
  if (m.personal) { texto(d, m.personal, M, y, { size: 8 }); y += 4.5 }
  texto(d, `${m.fechaStr} ${m.horaStr}`, M, y, { size: 8, color: [110, 116, 124] })
  texto(d, m.mensaje, M + ANCHO, y, { size: 8, align: 'right', color: [110, 116, 124] })
  y += 4.5
  texto(d, 'AppAdm · Documento generado en formato A4', M, y, { size: 7.5, color: [140, 146, 154] })

  // Numeración al final (ya se sabe el total de páginas).
  const paginas = d.getNumberOfPages()
  for (let p = 1; p <= paginas; p++) {
    d.setPage(p)
    d.setFont('helvetica', 'normal')
    d.setFontSize(7.5)
    d.setTextColor(140, 146, 154)
    d.text(`Página ${p} de ${paginas}`, M + ANCHO, 288, { align: 'right' })
  }
}

/**
 * Construye el PDF A4 y devuelve el documento jsPDF, el nombre del archivo y el serie-número.
 * Se usa desde las tres acciones (`abrir`, `descargar`, `compartir`) y desde las pruebas.
 */
export async function construirPDFComprobanteA4(
  doc: DocComprobante,
  config: Config,
  opts?: { /** `false` deja el PDF sin comprimir: más grande, pero el texto se puede inspeccionar (lo usan las pruebas). */ comprimir?: boolean },
): Promise<{ pdf: JSPDFDoc; nombre: string; serieNumero: string }> {
  const tipoDoc = doc.tipoDoc || doc.tipo || 'NV'
  const correlativo = doc.numero || doc.correlativo || '000000'
  const modelo = datosComprobanteA4({ doc, correlativo, config, tipoDoc, sunat: doc.sunat, anulacion: doc.anulacion })

  let qrDataUrl = ''
  if (modelo.esElectronico && doc.sunat) {
    qrDataUrl = await generarQRDataUrl(construirQRData(doc.venta || {}, correlativo, config, tipoDoc, doc.sunat))
  }

  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: opts?.comprimir !== false })
  pdf.setProperties?.({
    title: `${modelo.titulo} ${modelo.serieNumero}`,
    subject: `${modelo.empresa.nombre} · ${modelo.serieNumero}`,
    creator: 'AppAdm',
  })
  dibujarComprobanteA4(pdf, modelo, qrDataUrl)
  return { pdf, nombre: nombreArchivoComprobante(doc, tipoDoc), serieNumero: modelo.serieNumero }
}

/** Abre el A4 en una pestaña (visor de PDF: imprimir o guardar desde ahí). */
export async function abrirPDFComprobanteA4(doc: DocComprobante, config: Config): Promise<void> {
  // La pestaña se abre **antes** de esperar (gesto del usuario): si no, el navegador bloquea el popup.
  const w = typeof window !== 'undefined' ? window.open('', '_blank') : null
  try {
    const { pdf, nombre } = await construirPDFComprobanteA4(doc, config)
    const url = URL.createObjectURL(pdf.output('blob'))
    if (w) {
      // El título se pone **antes** de navegar: después, la ventana ya es el visor de PDF.
      try { w.document.title = nombre } catch { /* el visor puede no exponer el documento */ }
      w.location.href = url
    } else {
      window.open(url, '_blank')
    }
    // El objeto URL se libera recién cuando el visor ya lo cargó.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    if (w) w.close()
    throw e
  }
}

/**
 * **Compartir el A4** por WhatsApp, correo o lo que tenga el dispositivo: usa la hoja de compartir
 * nativa con el PDF adjunto (`navigator.share` + `File`), que es la forma de mandarlo **sin ninguna
 * integración con WhatsApp**. Si el dispositivo no la soporta, descarga el archivo y avisa.
 */
export async function compartirPDFComprobanteA4(
  doc: DocComprobante,
  config: Config,
): Promise<'compartido' | 'descargado' | 'cancelado'> {
  const { pdf, nombre, serieNumero } = await construirPDFComprobanteA4(doc, config)
  const blob = pdf.output('blob') as Blob
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: unknown) => boolean }) : null
  const archivo = typeof File !== 'undefined' ? new File([blob], nombre, { type: 'application/pdf' }) : null

  if (nav?.share && archivo && (!nav.canShare || nav.canShare({ files: [archivo] }))) {
    try {
      await nav.share({
        files: [archivo],
        title: `${serieNumero}.pdf`,
        text: `Comprobante ${serieNumero} — ${config?.nombre || 'JorFel'}`,
      })
      return 'compartido'
    } catch (e) {
      // Cancelar la hoja de compartir no es un error: no se descarga nada a propósito.
      if ((e as Error)?.name === 'AbortError') return 'cancelado'
      console.warn('⚠️ No se pudo compartir el PDF, se descarga:', e)
    }
  }
  pdf.save(nombre)
  return 'descargado'
}
