/**
 * Piezas **compartidas** por los dos formatos del comprobante: el **ticket de 72 mm** (ticketera, en
 * `lib/pdf.ts`) y el **A4** (para enviar por correo/WhatsApp o imprimir en papel normal, en
 * `lib/comprobante-a4.ts`).
 *
 * ⚠️ Acá vive **solo** lo que los dos formatos necesitan y tienen que dar **el mismo número**: los
 * totales SUNAT (`calcularTotales`), los datos del QR (`construirQRData`), la serie de una NC/ND
 * (`serieNota`) y la normalización de sus montos a positivo (`normalizarMontosNota`). Título del
 * documento y tasas de afectación también, porque el A4 tiene que decir exactamente lo mismo que el
 * ticket. Si una regla cambia, se cambia **acá** y los dos formatos cambian juntos: si estuviera
 * duplicada, el A4 y la ticketera podrían mostrar importes distintos del mismo documento.
 *
 * 🔑 **El diseño de cada papel no se toca desde acá**: el HTML de la ticketera sigue en `lib/pdf.ts`
 * (con su `@page { size:72mm auto }`) y el A4 es un PDF propio que se arma en `lib/comprobante-a4.ts`.
 *
 * ⚠️ Este módulo importa con **extensión `.ts` relativa**: el runner nativo de Node (`npm test`) no
 * resuelve el alias `@`. Es lo que permite probar las dos reglas sin navegador.
 */

import QRCode from 'qrcode'
import { afectacionDe, IGV_RATE } from './sunat-importes.ts'
import { tasaDelDocumento } from './igv.ts'

/** Título impreso de cada tipo de documento (lo usan el ticket, el A4 y el QR). */
export const TITULOS: Record<string, string> = {
  NV: 'NOTA DE VENTA',
  BOLETA: 'BOLETA DE VENTA ELECTRÓNICA',
  FACTURA: 'FACTURA ELECTRÓNICA',
  NC: 'NOTA DE CRÉDITO ELECTRÓNICA',
  ND: 'NOTA DE DÉBITO ELECTRÓNICA',
}

// Afectación: mismas tasas/tipos que constants/Tributario.js (RN).
// 🔑 **La tasa del gravado es un parámetro** (no siempre es 18%: restaurantes y hoteles van al 10%,
// `lib/igv.ts`). El IVAP (`'18'`/`'19'`) tiene su tasa propia y no depende del negocio.
export function obtenerInfoAfectacion(codigo: string, tasaGravado: number = IGV_RATE) {
  if (['10', '11', '12', '13', '14', '15', '16', '17'].includes(codigo)) {
    return { tasa: Number(tasaGravado) > 0 ? Number(tasaGravado) : IGV_RATE, tipo: 'gravado' }
  }
  if (['18', '19'].includes(codigo)) return { tasa: 0.04, tipo: 'gravado' }
  if (['20', '21', '22'].includes(codigo)) return { tasa: 0, tipo: 'exonerado' }
  return { tasa: 0, tipo: 'inafecto' }
}

export function calcularTotales(items: any[], opts?: { regionExonerada?: boolean; tasaIgv?: number }) {
  let opGravadas = 0
  let opExoneradas = 0
  let opInafectas = 0
  let igvTotal = 0
  for (const it of items || []) {
    const cod = afectacionDe(it, opts)
    const info = obtenerInfoAfectacion(cod, opts?.tasaIgv)
    const subtotal = (it.precioVenta || it.precio_unitario || 0) * (it.cantidad || it.quantity || 1)
    if (info.tasa > 0) {
      opGravadas += subtotal / (1 + info.tasa)
      igvTotal += subtotal - subtotal / (1 + info.tasa)
    } else if (info.tipo === 'exonerado') {
      opExoneradas += subtotal
    } else {
      opInafectas += subtotal
    }
  }
  return {
    opGravadas: Number(opGravadas.toFixed(2)),
    opExoneradas: Number(opExoneradas.toFixed(2)),
    opInafectas: Number(opInafectas.toFixed(2)),
    igv: Number(igvTotal.toFixed(2)),
    total: Number((opGravadas + opExoneradas + opInafectas + igvTotal).toFixed(2)),
  }
}

export function serieNota(config: Record<string, any>, venta: any, tipoDoc: string) {
  const ref = venta?.docReferencia || venta?.documentoReferencia || ''
  const esBoleta = ref.startsWith('B')
  if (tipoDoc === 'NC') return esBoleta ? config.serieBoletaNC || 'BC01' : config.serieFacturaNC || 'FC01'
  if (tipoDoc === 'ND') return esBoleta ? config.serieBoletaND || 'BD01' : config.serieFacturaND || 'FD01'
  return 'B001'
}

export function construirQRData(venta: any, correlativo: any, config: Record<string, any>, tipoDoc: string, sunat: any) {
  const cliDni = (venta.cliente_dni || '') === '-' ? '' : venta.cliente_dni || ''
  const tipoDocCliente = cliDni.length === 11 ? '6' : '1'
  const tipoComprobante = tipoDoc === 'FACTURA' ? '01' : tipoDoc === 'NC' ? '07' : tipoDoc === 'ND' ? '08' : '03'
  const serie = sunat?.serie || (tipoDoc === 'FACTURA' ? 'F001' : tipoDoc === 'BOLETA' ? 'B001' : serieNota(config, venta, tipoDoc))
  const numero = sunat?.numero || correlativo
  const totales = calcularTotales(venta.items || [], { regionExonerada: config?.regionExonerada, tasaIgv: tasaDelDocumento(venta, config) })
  const fecha = new Date(venta.fecha || venta.createdAt)
  const fechaStr = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  return [config.ruc || '', tipoComprobante, serie, String(numero), Math.abs(totales.igv).toFixed(2), Math.abs(totales.total).toFixed(2), fechaStr, tipoDocCliente, cliDni || '00000000', sunat?.hash || ''].join('|')
}

export async function generarQRDataUrl(data: string) {
  try {
    return await QRCode.toDataURL(data, { margin: 1, width: 200, color: { dark: '#000', light: '#fff' } })
  } catch (e) {
    console.warn('⚠️ Error generando QR:', e)
    return ''
  }
}

/**
 * **NC/ND: montos positivos (modelo SUNAT).** Una nota de crédito se guarda con el importe en
 * negativo (resta del día), pero el comprobante que se imprime o se envía se declara **en positivo**,
 * con el signo explicado por el tipo de documento. Se aplica **una sola vez** y lo usan los dos
 * formatos: si el ticket lo hiciera y el A4 no, el mismo documento mostraría dos importes distintos.
 */
export function normalizarMontosNota<T extends Record<string, any>>(venta: T, tipoDoc: string): T {
  if (tipoDoc !== 'NC' && tipoDoc !== 'ND') return venta
  const normalizada: Record<string, any> = {
    ...venta,
    items: ((venta.items || []) as any[]).map((it: any) => ({
      ...it,
      precioVenta: Math.abs(Number(it.precioVenta || 0)),
      precio_unitario: Math.abs(Number(it.precio_unitario || it.precioVenta || 0)),
      subtotal: Math.abs(Number(it.subtotal || it.total || 0)),
    })),
  }
  normalizada.total = Math.abs(Number(venta.total || 0))
  normalizada.importe_total = Math.abs(Number(venta.importe_total || venta.total || 0))
  normalizada.efectivo = Math.abs(Number(venta.efectivo || 0))
  normalizada.montoRecibido = Math.abs(Number(venta.montoRecibido || 0))
  normalizada.cambio = Math.abs(Number(venta.cambio || 0))
  return normalizada as T
}
