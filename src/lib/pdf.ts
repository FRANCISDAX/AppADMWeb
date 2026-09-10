import QRCode from 'qrcode'
import { numeroALetras } from '@/lib/numero-a-letras'
import { esc } from '@/lib/ui-utils'

const TITULOS: Record<string, string> = {
  NV: 'NOTA DE VENTA',
  BOLETA: 'BOLETA DE VENTA ELECTRÓNICA',
  FACTURA: 'FACTURA ELECTRÓNICA',
  NC: 'NOTA DE CRÉDITO ELECTRÓNICA',
  ND: 'NOTA DE DÉBITO ELECTRÓNICA',
}

// Afectación: mismas tasas/tipos que constants/Tributario.js (RN).
function obtenerInfoAfectacion(codigo: string) {
  if (['10', '11', '12', '13', '14', '15', '16', '17'].includes(codigo)) return { tasa: 0.18, tipo: 'gravado' }
  if (['18', '19'].includes(codigo)) return { tasa: 0.04, tipo: 'gravado' }
  if (['20', '21', '22'].includes(codigo)) return { tasa: 0, tipo: 'exonerado' }
  return { tasa: 0, tipo: 'inafecto' }
}

export function calcularTotales(items: any[]) {
  let opGravadas = 0
  let opExoneradas = 0
  let opInafectas = 0
  let igvTotal = 0
  for (const it of items || []) {
    const cod = it.tipoAfectacionEfectivo || it.tipoAfectacion || '10'
    const info = obtenerInfoAfectacion(cod)
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

function serieNota(config: Record<string, any>, venta: any, tipoDoc: string) {
  const ref = venta?.docReferencia || venta?.documentoReferencia || ''
  const esBoleta = ref.startsWith('B')
  if (tipoDoc === 'NC') return esBoleta ? config.serieBoletaNC || 'BC01' : config.serieFacturaNC || 'FC01'
  if (tipoDoc === 'ND') return esBoleta ? config.serieBoletaND || 'BD01' : config.serieFacturaND || 'FD01'
  return 'B001'
}

function construirQRData(venta: any, correlativo: any, config: Record<string, any>, tipoDoc: string, sunat: any) {
  const cliDni = (venta.cliente_dni || '') === '-' ? '' : venta.cliente_dni || ''
  const tipoDocCliente = cliDni.length === 11 ? '6' : '1'
  const tipoComprobante = tipoDoc === 'FACTURA' ? '01' : tipoDoc === 'NC' ? '07' : tipoDoc === 'ND' ? '08' : '03'
  const serie = sunat?.serie || (tipoDoc === 'FACTURA' ? 'F001' : tipoDoc === 'BOLETA' ? 'B001' : serieNota(config, venta, tipoDoc))
  const numero = sunat?.numero || correlativo
  const totales = calcularTotales(venta.items || [])
  const fecha = new Date(venta.fecha || venta.createdAt)
  const fechaStr = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
  return [config.ruc || '', tipoComprobante, serie, String(numero), Math.abs(totales.igv).toFixed(2), Math.abs(totales.total).toFixed(2), fechaStr, tipoDocCliente, cliDni || '00000000', sunat?.hash || ''].join('|')
}

async function generarQRDataUrl(data: string) {
  try {
    return await QRCode.toDataURL(data, { margin: 1, width: 200, color: { dark: '#000', light: '#fff' } })
  } catch (e) {
    console.warn('⚠️ Error generando QR:', e)
    return ''
  }
}

export async function construirHTMLComprobante({ venta, correlativo, config, tipoDoc = 'NV', sunat = null, anulacion = null }: { venta: any; correlativo: any; config: Record<string, any>; tipoDoc?: string; sunat?: any; anulacion?: any }) {
  // NC/ND: montos positivos (modelo SUNAT).
  if (tipoDoc === 'NC' || tipoDoc === 'ND') {
    venta = {
      ...venta,
      items: (venta.items || []).map((it: any) => ({
        ...it,
        precioVenta: Math.abs(Number(it.precioVenta || 0)),
        precio_unitario: Math.abs(Number(it.precio_unitario || it.precioVenta || 0)),
        subtotal: Math.abs(Number(it.subtotal || it.total || 0)),
      })),
    }
    venta.total = Math.abs(Number(venta.total || 0))
    venta.importe_total = Math.abs(Number(venta.importe_total || venta.total || 0))
    venta.efectivo = Math.abs(Number(venta.efectivo || 0))
    venta.montoRecibido = Math.abs(Number(venta.montoRecibido || 0))
    venta.cambio = Math.abs(Number(venta.cambio || 0))
  }

  const fecha = new Date(venta.fecha || venta.createdAt)
  const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()}`
  const horaStr = venta.hora || fecha.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

  if (!venta.items || !Array.isArray(venta.items)) venta.items = []
  // Ítem apilado: nombre en una sola línea y debajo cantidad/unidad/precio/total.
  const itemsRows = venta.items
    .map((it: any) => {
      const desc = it.nombre || it.descripcion || ''
      const cant = Number(it.cantidad) || 0
      const und = it.unidad || ''
      const pUnit = Number(it.precioVenta || it.precio_unitario || 0).toFixed(2)
      const descuento = Number(it.descuento || 0)
      const total = Number(it.subtotal || it.total || 0).toFixed(2)
      const descRow = descuento > 0 ? `<div class="item-desc">Descuento: -S/ ${descuento.toFixed(2)}</div>` : ''
      return `<div class="item"><div class="item-nombre">${esc(desc)}</div><table class="item-num"><tr><td></td><td>${cant.toFixed(2)}</td><td>${esc(und || '-')}</td><td>${pUnit}</td><td class="r">${total}</td></tr></table>${descRow}</div>`
    })
    .join('')

  const totalStr = Number(venta.importe_total || venta.total || 0).toFixed(2)
  const formaPago = venta.forma_pago || (venta.tipoPago === 'efectivo' ? 'Efectivo' : venta.tipoPago === 'credito' ? 'Crédito' : 'Transferencia')
  // Pago mixto (efectivo + transferencia, etc.): muestra el desglose.
  const pagoHTML =
    Array.isArray(venta.pagos) && venta.pagos.length > 1
      ? venta.pagos.map((p: any) => `<tr><td class="td-l" colspan="3">${p.tipo === 'efectivo' ? '💵 Efectivo' : p.tipo === 'transferencia' ? '📲 Transferencia' : '💳 Crédito'} S/ ${Number(p.monto || 0).toFixed(2)}</td></tr>`).join('')
        + (Number(venta.cambio || 0) > 0
          ? (Number(venta.montoRecibido || 0) > 0
            ? `<tr><td class="td-l" colspan="2">Efectivo recibido S/ ${Number(venta.montoRecibido || 0).toFixed(2)}</td><td class="td-r">Vuelto S/ ${Number(venta.cambio || 0).toFixed(2)}</td></tr>`
            : `<tr><td class="td-l" colspan="3">Vuelto (efectivo) S/ ${Number(venta.cambio || 0).toFixed(2)}</td></tr>`)
          : '')
      : venta.tipoPago === 'efectivo' || formaPago.toLowerCase() === 'efectivo'
      ? `<tr><td class="td-l" colspan="2">Efectivo S/ ${Number(venta.montoRecibido || venta.efectivo || 0).toFixed(2)}</td><td class="td-r">Vuelto S/ ${Number(venta.cambio || 0).toFixed(2)}</td></tr>`
      : venta.tipoPago === 'credito' || formaPago.toLowerCase() === 'credito'
      ? `<tr><td class="td-l" colspan="3">Crédito</td></tr>${venta.cobrado ? `<tr><td class="td-l s" colspan="3">Cobrado: S/ ${Number(venta.cobrado).toFixed(2)}</td></tr>` : ''}`
      : `<tr><td class="td-l" colspan="3">Transferencia S/ ${totalStr}</td></tr>${venta.referencia ? `<tr><td class="td-l s" colspan="3">Ref: ${esc(venta.referencia)}</td></tr>` : ''}`

  const clienteNombre = venta.cliente_nombre || venta.cliente || '-'
  const clienteDni = venta.cliente_dni || venta.clienteDoc || '-'
  const clienteDireccion = venta.cliente_direccion || venta.clienteDireccion || ''
  const sucursal = venta.sucursal || ''
  const autorizacion = venta.autorizacion || ''
  const validarEn = venta.validar_en || ''
  const mensaje = venta.mensaje || ''
  const sonLetras = venta.son_letras || numeroALetras(Number(venta.importe_total || venta.total || 0))
  const serieNumero = venta.serie_numero || `${tipoDoc === 'FACTURA' ? 'F001' : tipoDoc === 'BOLETA' ? 'B001' : 'NV'}-${correlativo}`
  const docLabel = tipoDoc === 'FACTURA' ? 'RUC' : 'DNI'

  const totalesCalc = calcularTotales(venta.items || [])
  const tieneGravadas = Math.abs(totalesCalc.opGravadas) > 0
  const tieneExoneradas = Math.abs(totalesCalc.opExoneradas) > 0
  const tieneInafectas = Math.abs(totalesCalc.opInafectas) > 0
  const hayIGV = tieneGravadas
  // Filas de totales (modelo SUNAT): exonerada/gravada + gratuita + IGV + ICBPER + moneda.
  const filasTotales = hayIGV
    ? `<tr><td class="td-r tot-l">Op. Gravadas</td><td class="td-r tot-v">S/ ${totalesCalc.opGravadas.toFixed(2)}</td></tr><tr><td class="td-r tot-l">I.G.V.</td><td class="td-r tot-v">S/ ${totalesCalc.igv.toFixed(2)}</td></tr>`
    : tieneExoneradas
    ? `<tr><td class="td-r tot-l">Op. Exonerada</td><td class="td-r tot-v">S/ ${totalesCalc.opExoneradas.toFixed(2)}</td></tr><tr><td class="td-r tot-l">I.G.V.</td><td class="td-r tot-v">S/ 0.00</td></tr>`
    : tieneInafectas
    ? `<tr><td class="td-r tot-l">Op. Inafecta</td><td class="td-r tot-v">S/ ${totalesCalc.opInafectas.toFixed(2)}</td></tr><tr><td class="td-r tot-l">I.G.V.</td><td class="td-r tot-v">S/ 0.00</td></tr>`
    : `<tr><td class="td-r tot-l">Op. Gratuita</td><td class="td-r tot-v">S/ 0.00</td></tr><tr><td class="td-r tot-l">I.G.V.</td><td class="td-r tot-v">S/ 0.00</td></tr>`

  const esElectronico = tipoDoc === 'BOLETA' || tipoDoc === 'FACTURA' || tipoDoc === 'NC' || tipoDoc === 'ND'
  let qrSvg = ''
  let hashText = ''
  if (esElectronico && sunat) {
    const qrData = construirQRData(venta, correlativo, config, tipoDoc, sunat)
    qrSvg = await generarQRDataUrl(qrData)
    hashText = sunat.hash || ''
  }

  const logo = config.logo_url || ''

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size:72mm auto; margin:0; }
  @media print { html,body { width:72mm; margin:0; } body { padding:3mm 4mm; } }
  body { font-family:'Helvetica','Arial',sans-serif; font-size:10px; width:72mm; padding:3mm 4mm; color:#222; font-weight:700; }
  .c { text-align:center; } .b { font-weight:700; } .s { font-size:8px; color:#555; } .s2 { font-size:13px; }
  .sep { border:0; border-top:2px dashed #222; margin:1mm 0; }
  .tbl { width:100%; border-collapse:collapse; font-size:10px; }
  .tbl th { background:transparent; padding:4px 2px; font-size:9.5px; text-transform:uppercase; color:#555; }
  .tbl td { padding:3px 2px; border-bottom:1px solid #eee; vertical-align:top; }
  .td-l { text-align:left; } .td-r { text-align:right; }
  .tbl .th-p { text-align:left; }
  .tbl .tot-l { font-size:10px; color:#444; } .tbl .tot-v { font-size:10px; font-weight:700; }
  .items { margin:1mm 0; }
  .item { padding:1.5mm 0; border-bottom:1px solid #eee; }
  .item-nombre { font-size:10px; font-weight:700; text-align:left; }
  .item-num { width:100%; border-collapse:collapse; font-size:10px; color:#222; font-weight:700; margin-top:0.5mm; }
  .item-num td { padding:0; }
  .item-num td.r { text-align:right; color:#222; font-weight:700; }
  .tbl thead th:nth-child(2), .item-num td:nth-child(2) { width:36px; text-align:center; }
  .tbl thead th:nth-child(3), .item-num td:nth-child(3) { width:46px; text-align:center; }
  .tbl thead th:nth-child(4), .item-num td:nth-child(4) { width:50px; text-align:right; }
  .tbl thead th:nth-child(5), .item-num td:nth-child(5) { width:50px; text-align:right; }
  .item-desc { font-size:8.5px; color:#b71c1c; padding-left:2mm; }
  .ff { text-align:center; font-size:8px; color:#888; margin-top:3mm; }
  .header-logo { max-width:55mm; max-height:16mm; display:block; margin:0 auto 2mm auto; object-fit:contain; }
  .brand { font-size:12px; font-weight:700; text-transform:uppercase; line-height:1.25; }
  .doc-titulo { background:#000; color:#fff; font-size:11.5px; font-weight:700; text-align:center; padding:1.5mm 0; }
  .encabezado-box { background:transparent; border:1px solid #222; border-radius:3px; padding:2mm 1.5mm; margin:1mm 0; }
  .tbl.cabecera { background:transparent; border:1px solid #222; }
  .tbl.cabecera th { background:transparent; }
  .cinfo { font-size:9.5px; color:#222; font-weight:700; }
  .serie { font-size:12px; font-weight:700; letter-spacing:1px; }
  .tot-total { font-size:12px; }
  .qr-row { width:100%; border-collapse:collapse; margin:2mm 0; }
  .qr-row img { width:30mm; height:30mm; }
  .qr-row td.qr-txt { padding-left:2.5mm; font-size:8px; color:#555; word-break:break-all; vertical-align:middle; line-height:1.3; }
  .anulado-box { background:#FDECEA; border:1px solid #D32F2F; border-radius:4px; padding:2mm; margin:2mm 0; }
  .anulado-titulo { color:#D32F2F; font-weight:700; font-size:10px; } .anulado-texto { color:#B71C1C; font-size:8px; }
  </style></head><body>
  ${logo ? `<img class="header-logo" src="${logo}" alt="Logo" />` : ''}
  <div class="c brand">${esc(config.nombre)}</div>
  <div class="c cinfo">${esc(config.direccion)}</div>
  ${sucursal ? `<div class="c cinfo">${esc(sucursal)}</div>` : ''}
  <div class="c cinfo">${config.telefono ? 'Celular: ' + esc(config.telefono) : ''}${config.telefono && config.correo ? '  |  ' : ''}${esc(config.correo || '')}</div>
  <div class="encabezado-box">
    <div class="c" style="font-size:11.5px;font-weight:700;">RUC: ${esc(config.ruc)}</div>
    <div class="c b doc-titulo">${TITULOS[tipoDoc] || 'NOTA DE VENTA'}</div>
    <div class="c serie">${esc(serieNumero)}</div>
  </div>
  <table class="tbl">
  <tr><td class="td-l">Fecha E:</td><td class="td-l">${esc(fechaStr)}</td><td class="td-r">Pago: <span class="b">${esc(formaPago)}</span></td></tr>
  <tr><td class="td-l">${docLabel}:</td><td class="td-l" colspan="2"><span class="b">${esc(clienteDni)}</span></td></tr>
  <tr><td class="td-l">Cliente:</td><td class="td-l" colspan="2"><span class="b">${esc(clienteNombre)}</span></td></tr>
  ${clienteDireccion ? `<tr><td class="td-l">Dirección:</td><td class="td-l" colspan="2">${esc(clienteDireccion)}</td></tr>` : ''}
  </table>
  <table class="tbl cabecera"><thead><tr><th class="th-p">Producto</th><th>Cant.</th><th>Und.</th><th>Precio</th><th>Total</th></tr></thead></table>
  <div class="items">${itemsRows}</div>
  <div class="c" style="margin-top:1.5mm;font-size:9.5px;color:#555;">Items: ${venta.items.length}</div>
  <hr class="sep">
  <table class="tbl">
  ${filasTotales}
  <tr><td class="td-r tot-l">I.C.B.P.E.R.</td><td class="td-r tot-v">S/ 0.00</td></tr>
  <tr><td class="td-l" style="padding-top:2mm">Moneda: <span class="b">Soles</span></td><td class="td-r tot-total b">TOTAL IMPORTE S/ ${totalStr}</td></tr>
  </table>
  ${sonLetras ? `<div class="c s" style="margin:2mm 0;font-size:9.5px;">Son: ${esc(sonLetras)} SOLES</div>` : ''}
  ${(venta.docReferencia || venta.documentoReferencia || venta.motivo || venta.motivoNota) ? `
  <table class="tbl">
  ${venta.docReferencia || venta.documentoReferencia ? `<tr><td class="td-l">Documento relacionado:</td><td class="td-l" colspan="2"><span class="b">${esc(venta.tipoDocOriginal ? venta.tipoDocOriginal + ' ' : '')}${esc(venta.docReferencia || venta.documentoReferencia)}</span></td></tr>` : ''}
  ${(venta.motivo || venta.motivoNota) ? `<tr><td class="td-l">Motivo de emisión:</td><td class="td-l" colspan="2">${esc(venta.motivo || venta.motivoNota)}</td></tr>` : ''}
  </table>` : ''}
  <hr class="sep">
  <table class="tbl">${pagoHTML}</table>
  ${autorizacion ? `<div class="c s" style="margin-top:2mm;">Autorización: ${esc(autorizacion)}</div>` : ''}
  ${validarEn ? `<div class="c s">Validar en: ${esc(validarEn)}</div>` : ''}
  ${esElectronico && qrSvg ? `<hr class="sep"><table class="qr-row"><tr><td><img src="${qrSvg}" /></td><td class="qr-txt">Representación impresa de la ${TITULOS[tipoDoc] || 'comprobante'}. consúltelo en www.sunat.gob.pe${hashText ? '<br>' + hashText : ''}</td></tr></table>` : ''}
  ${anulacion ? `<div class="anulado-box"><div class="anulado-titulo">ESTE DOCUMENTO HA SIDO ANULADO</div><div class="anulado-texto">Motivo: ${esc(anulacion.motivo || 'sin motivo')}</div></div>` : ''}
  <hr class="sep">
  <div class="c s">Usuario: ${esc(venta.cajero || '-')}  ${esc(fechaStr)} ${esc(horaStr)}</div>
  <div class="c s">${esc(mensaje || '¡Gracias por su preferencia, vuelva pronto!')}</div>
  <div class="c s">AppAdm</div>
  </body></html>`
  return html
}

// Espera a que las imágenes (logo/QR) del documento terminen de cargar.
function esperarImagenes(doc: Document) {
  const imgs = Array.from(doc.querySelectorAll('img'))
  const pendientes = imgs.filter((i) => i.complete === false)
  if (!pendientes.length) return Promise.resolve()
  return Promise.all(
    pendientes.map((img) => new Promise<void>((res) => {
      img.onload = () => res()
      img.onerror = () => res()
      setTimeout(res, 2500) // evita colgarse si alguna imagen no carga
    }))
  )
}

// Abre el comprobante (HTML 72mm) y dispara el diálogo de impresión del
// navegador (window.print) → colores reales (el fondo gris se ve) y texto
// vectorial. Creaba un PDF rasterizado (html2canvas+jsPDF) que binarizaba a
// negro/blanco; con la impresión nativa el gris se conserva.
export async function abrirPDFComprobante(doc: any, config: Record<string, any>) {
  // Abrimos la ventana primero (gesto del usuario) para que el navegador no bloquee el popup.
  const w = window.open('', '_blank', 'width=400,height=700')
  if (!w) return
  const venta = doc.venta || {}
  const tipoDoc = doc.tipoDoc || doc.tipo || 'NV'
  const correlativo = doc.numero || doc.correlativo || '000000'
  const html = await construirHTMLComprobante({ venta, correlativo, config, tipoDoc, sunat: doc.sunat, anulacion: doc.anulacion })

  w.document.open()
  w.document.write(html)
  w.document.close()
  w.document.title = doc.serieNumero || tipoDoc
  // Espera a que pinte y carguen imágenes (logo/QR) antes de imprimir.
  setTimeout(async () => {
    try { await esperarImagenes(w.document) } catch { /* ignora */ }
    w.focus()
    w.print()
  }, 500)
}

export type TurnoArqueo = {
  id: string
  tipoTurno: string
  usuarioNombre: string
  estado: 'abierto' | 'cerrado'
  fechaApertura?: string
  fechaCierre?: string
  montoInicial: number
  totalVentas: number
  totalEfectivo: number
  totalTransferencia: number
  totalGastos: number
  totalGastosEfectivo: number
  totalGastosTransferencia: number
  efectivoEsperado: number
  efectivoContado: number
  diferencia: number
  observaciones?: string
  numVentas: number
  gastosDelTurno: { descripcion: string; monto: number; categoria: string; tipoPago: string; fecha?: string }[]
  comprobantes: { id?: string; serieNumero: string; tipoPago: string; esCobro: boolean; total: number; fecha?: string; clienteNombre: string }[]
}

export async function abrirPDFArqueo({ fecha, turnos, resumen }: { fecha: Date; turnos: TurnoArqueo[]; resumen: { totalVentas: number; totalEfectivo: number; totalTransferencia: number; totalGastos: number; totalNeto: number; numTurnos: number; numTransacciones: number; montoInicialTotal: number; efectivoEsperadoTotal: number; efectivoContadoTotal: number; diferenciaTotal: number } }) {
  const w = window.open('', '_blank', 'width=500,height=800')
  if (!w) return

  const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)
  const fechaStr = fecha.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const horaImpresion = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })

  const turnosHTML = turnos.map(turno => {
    const esAbierto = turno.estado === 'abierto'
    const estadoLabel = esAbierto ? 'ABIERTO' : turno.tipoTurno === 'mañana' ? 'MAÑANA' : 'TARDE'
    const diffOk = Math.abs(turno.diferencia) < 0.01
    const gastosCajaHTML = turno.gastosDelTurno.filter(g => g.tipoPago === 'caja').length > 0
      ? `<div style="margin-top:6px;padding:6px;background:#f5f5f5;border-radius:4px;font-size:9px;">
          <b>Detalle gastos (caja):</b><br/>
          ${turno.gastosDelTurno.filter(g => g.tipoPago === 'caja').map(g => `<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>${esc(g.descripcion)} (${esc(g.categoria)})</span><b style="color:#dc2626;">- ${fmt(g.monto)}</b></div>`).join('')}
        </div>`
      : ''
    const comprobantesHTML = turno.comprobantes.length > 0
      ? `<div style="margin-top:6px;font-size:9px;"><b>Comprobantes (${turno.comprobantes.length}):</b><br/>
          ${turno.comprobantes.map(c => `<div style="display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px dashed #ddd;"><span>${esc(c.serieNumero || 'S/C')} · ${esc(c.clienteNombre)}</span><b>${fmt(c.total)}</b></div>`).join('')}</div>`
      : ''

    return `<div style="border:1px solid #ddd;border-radius:6px;padding:10px;margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span style="background:${esAbierto ? '#f59e0b' : '#22c55e'};color:white;padding:2px 8px;border-radius:4px;font-size:9px;font-weight:bold;">${estadoLabel}</span>
        <span style="font-size:9px;color:#666;">${turno.usuarioNombre}</span>
      </div>
      <div style="font-size:9px;color:#666;margin-bottom:6px;">
        ${turno.fechaApertura ? 'Apertura: ' + new Date(turno.fechaApertura).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
        ${turno.fechaCierre ? ' · Cierre: ' + new Date(turno.fechaCierre).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }) : ''}
      </div>
      <table style="width:100%;font-size:9px;border-collapse:collapse;">
        <tr><td style="padding:3px 0;">Monto inicial</td><td style="text-align:right;font-weight:bold;">${fmt(turno.montoInicial)}</td></tr>
        <tr><td style="padding:3px 0;">Ventas efectivo</td><td style="text-align:right;color:#16a34a;font-weight:bold;">+ ${fmt(turno.totalEfectivo)}</td></tr>
        <tr><td style="padding:3px 0;">Ventas transferencia</td><td style="text-align:right;font-weight:bold;">${fmt(turno.totalTransferencia)}</td></tr>
        <tr><td style="padding:3px 0;">Gastos en efectivo</td><td style="text-align:right;color:#dc2626;font-weight:bold;">- ${fmt(turno.totalGastosEfectivo)}</td></tr>
        <tr style="border-top:2px solid #222;"><td style="padding:3px 0;font-weight:bold;color:#2563eb;">Efectivo esperado</td><td style="text-align:right;font-weight:bold;color:#2563eb;">${fmt(turno.efectivoEsperado)}</td></tr>
        ${!esAbierto ? `<tr><td style="padding:3px 0;">Efectivo contado</td><td style="text-align:right;font-weight:bold;">${fmt(turno.efectivoContado)}</td></tr>
        <tr><td style="padding:3px 0;font-weight:bold;color:${diffOk ? '#16a34a' : '#dc2626'};">Diferencia</td><td style="text-align:right;font-weight:bold;color:${diffOk ? '#16a34a' : '#dc2626'};">${diffOk ? 'S/ 0.00' : (turno.diferencia > 0 ? '+ ' : '') + fmt(turno.diferencia)}</td></tr>` : ''}
      </table>
      ${gastosCajaHTML}
      ${turno.observaciones ? `<div style="margin-top:6px;font-size:9px;color:#666;"><b>Observaciones:</b> ${esc(turno.observaciones)}</div>` : ''}
      ${comprobantesHTML}
    </div>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4; margin:15mm; }
  body { font-family:'Helvetica','Arial',sans-serif; font-size:11px; color:#222; padding:15mm; }
  .header { text-align:center; border-bottom:3px solid #2563eb; padding-bottom:10px; margin-bottom:15px; }
  .title { font-size:22px; font-weight:bold; color:#2563eb; }
  .subtitle { font-size:12px; color:#666; margin-top:4px; }
  .summary { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:8px; margin-bottom:15px; }
  .kpi { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center; }
  .kpi-label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; }
  .kpi-value { font-size:16px; font-weight:bold; margin-top:4px; }
  .section-title { font-size:14px; font-weight:bold; margin:15px 0 10px; border-bottom:2px solid #e2e8f0; padding-bottom:4px; }
  .footer { margin-top:20px; padding-top:10px; border-top:2px solid #e2e8f0; font-size:9px; color:#999; text-align:center; }
  </style></head><body>
  <div class="header">
    <div class="title">ARQUEO DE CAJA</div>
    <div class="subtitle">${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}</div>
  </div>
  <div class="summary">
    <div class="kpi"><div class="kpi-label">Ventas Totales</div><div class="kpi-value" style="color:#2563eb;">${fmt(resumen.totalVentas)}</div></div>
    <div class="kpi"><div class="kpi-label">Efectivo</div><div class="kpi-value" style="color:#16a34a;">${fmt(resumen.totalEfectivo)}</div></div>
    <div class="kpi"><div class="kpi-label">Transferencia</div><div class="kpi-value" style="color:#8b5cf6;">${fmt(resumen.totalTransferencia)}</div></div>
    <div class="kpi"><div class="kpi-label">Gastos</div><div class="kpi-value" style="color:#dc2626;">${fmt(resumen.totalGastos)}</div></div>
  </div>
  <div class="summary" style="grid-template-columns:1fr 1fr 1fr 1fr;">
    <div class="kpi"><div class="kpi-label">Neto</div><div class="kpi-value" style="color:#2563eb;">${fmt(resumen.totalNeto)}</div></div>
    <div class="kpi"><div class="kpi-label">Turnos</div><div class="kpi-value">${resumen.numTurnos}</div></div>
    <div class="kpi"><div class="kpi-label">Transacciones</div><div class="kpi-value">${resumen.numTransacciones}</div></div>
    <div class="kpi"><div class="kpi-label">Diferencia Total</div><div class="kpi-value" style="color:${Math.abs(resumen.diferenciaTotal) < 0.01 ? '#16a34a' : '#dc2626'};">${resumen.diferenciaTotal > 0 ? '+ ' : ''}${fmt(resumen.diferenciaTotal)}</div></div>
  </div>
  <div class="section-title">Detalle por Turno</div>
  ${turnosHTML || '<div style="text-align:center;color:#999;padding:20px;">No hay turnos registrados este día.</div>'}
  <div class="footer">Generado el ${new Date().toLocaleDateString('es-PE')} a las ${horaImpresion}</div>
  </body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
  w.document.title = `Arqueo ${fecha.toISOString().split('T')[0]}`
  setTimeout(() => {
    w.focus()
    w.print()
  }, 500)
}

export type CierreCajaPDF = {
  id: string
  usuarioNombre?: string
  tipoTurno?: string
  fechaApertura?: string
  fechaCierre?: string
  montoInicial?: number
  totalVentas?: number
  totalEfectivo?: number
  totalTransferencia?: number
  totalGastos?: number
  totalGastosEfectivo?: number
  totalGastosTransferencia?: number
  efectivoEsperado?: number
  montoFinalEfectivo?: number
  diferencia?: number
  observaciones?: string
  analisis?: {
    causas: { tipo: string; descripcion: string; ventaId?: string; monto?: number; hora?: string }[]
    recomendaciones: string[]
  }
}

export function abrirPDFCierreCaja(cierre: CierreCajaPDF) {
  const w = window.open('', '_blank', 'width=500,height=800')
  if (!w) return

  const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)
  const fechaCierre = cierre.fechaCierre ? new Date(cierre.fechaCierre) : new Date()
  const fechaStr = fechaCierre.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const horaImpresion = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
  const diffOk = Math.abs(cierre.diferencia ?? 0) < 0.01
  const diff = cierre.diferencia ?? 0

  const causasHTML = cierre.analisis?.causas && cierre.analisis.causas.length > 0
    ? `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:bold;margin-bottom:5px;">POSIBLES CAUSAS</div>
        ${cierre.analisis.causas.map(c => `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:6px 8px;margin-bottom:4px;font-size:9px;"><b style="color:#92400e;">${esc(c.descripcion)}</b>${c.hora ? ` <span style="color:#666;">— ${esc(c.hora)}</span>` : ''}</div>`).join('')}</div>`
    : ''

  const recomendacionesHTML = cierre.analisis?.recomendaciones && cierre.analisis.recomendaciones.length > 0
    ? `<div style="margin-top:10px;"><div style="font-size:11px;font-weight:bold;margin-bottom:5px;">RECOMENDACIONES</div>
        <ul style="margin:0;padding-left:18px;font-size:9px;color:#555;">
          ${cierre.analisis.recomendaciones.map(r => `<li style="margin-bottom:3px;">${esc(r)}</li>`).join('')}
        </ul></div>`
    : ''

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4; margin:15mm; }
  body { font-family:'Helvetica','Arial',sans-serif; font-size:11px; color:#222; padding:15mm; }
  .header { text-align:center; border-bottom:3px solid ${diffOk ? '#2563eb' : '#dc2626'}; padding-bottom:10px; margin-bottom:15px; }
  .title { font-size:20px; font-weight:bold; color:${diffOk ? '#2563eb' : '#dc2626'}; }
  .subtitle { font-size:11px; color:#666; margin-top:4px; }
  .summary { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:15px; }
  .kpi { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px; text-align:center; }
  .kpi-label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; }
  .kpi-value { font-size:14px; font-weight:bold; margin-top:4px; }
  .section-title { font-size:12px; font-weight:bold; margin:12px 0 8px; border-bottom:2px solid #e2e8f0; padding-bottom:4px; }
  .footer { margin-top:20px; padding-top:10px; border-top:2px solid #e2e8f0; font-size:9px; color:#999; text-align:center; }
  .diff-banner { text-align:center; padding:12px; border-radius:8px; margin-bottom:15px; font-size:14px; font-weight:bold; }
  </style></head><body>
  <div class="header">
    <div class="title">CIERRE DE CAJA</div>
    <div class="subtitle">${fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1)}</div>
    <div class="subtitle" style="margin-top:2px;">Turno: ${cierre.tipoTurno === 'tarde' ? '🌙 Tarde' : '🌅 Mañana'} · Cajero: ${esc(cierre.usuarioNombre ?? '—')}</div>
  </div>

  <div class="diff-banner" style="background:${diffOk ? '#dcfce7' : diff > 0 ? '#fef3c7' : '#fee2e2'}; color:${diffOk ? '#16a34a' : diff > 0 ? '#92400e' : '#dc2626'};">
    ${diffOk ? '✅ CAJA CUADRADA' : diff > 0 ? `⚠️ SOBRANTE: ${fmt(diff)}` : `🔴 FALTANTE: ${fmt(Math.abs(diff))}`}
  </div>

  <div class="summary">
    <div class="kpi"><div class="kpi-label">Fondo Inicial</div><div class="kpi-value">${fmt(cierre.montoInicial ?? 0)}</div></div>
    <div class="kpi"><div class="kpi-label">Efectivo Vendido</div><div class="kpi-value" style="color:#16a34a;">${fmt(cierre.totalEfectivo ?? 0)}</div></div>
    <div class="kpi"><div class="kpi-label">Transferencia</div><div class="kpi-value" style="color:#8b5cf6;">${fmt(cierre.totalTransferencia ?? 0)}</div></div>
  </div>
  <div class="summary">
    <div class="kpi"><div class="kpi-label">Gastos Efectivo</div><div class="kpi-value" style="color:#dc2626;">-${fmt(cierre.totalGastosEfectivo ?? 0)}</div></div>
    <div class="kpi"><div class="kpi-label">Esperado</div><div class="kpi-value" style="color:#2563eb;">${fmt(cierre.efectivoEsperado ?? 0)}</div></div>
    <div class="kpi"><div class="kpi-label">Contado</div><div class="kpi-value">${fmt(cierre.montoFinalEfectivo ?? 0)}</div></div>
  </div>

  <div class="section-title">Resumen Financiero</div>
  <table style="width:100%;font-size:10px;border-collapse:collapse;">
    <tr style="border-bottom:1px solid #eee;"><td style="padding:5px 0;">Monto inicial</td><td style="text-align:right;font-weight:bold;">${fmt(cierre.montoInicial ?? 0)}</td></tr>
    <tr style="border-bottom:1px solid #eee;"><td style="padding:5px 0;">Ventas en efectivo</td><td style="text-align:right;color:#16a34a;font-weight:bold;">+ ${fmt(cierre.totalEfectivo ?? 0)}</td></tr>
    <tr style="border-bottom:1px solid #eee;"><td style="padding:5px 0;">Ventas en transferencia</td><td style="text-align:right;font-weight:bold;">${fmt(cierre.totalTransferencia ?? 0)}</td></tr>
    <tr style="border-bottom:1px solid #eee;"><td style="padding:5px 0;">Gastos en efectivo</td><td style="text-align:right;color:#dc2626;font-weight:bold;">- ${fmt(cierre.totalGastosEfectivo ?? 0)}</td></tr>
    ${cierre.totalGastosTransferencia ? `<tr style="border-bottom:1px solid #eee;"><td style="padding:5px 0;">Gastos en transferencia</td><td style="text-align:right;color:#dc2626;font-weight:bold;">- ${fmt(cierre.totalGastosTransferencia)}</td></tr>` : ''}
    <tr style="border-top:2px solid #222;"><td style="padding:5px 0;font-weight:bold;color:#2563eb;">Efectivo esperado</td><td style="text-align:right;font-weight:bold;color:#2563eb;">${fmt(cierre.efectivoEsperado ?? 0)}</td></tr>
    <tr><td style="padding:5px 0;font-weight:bold;">Efectivo contado</td><td style="text-align:right;font-weight:bold;">${fmt(cierre.montoFinalEfectivo ?? 0)}</td></tr>
    <tr style="border-top:2px solid #222;"><td style="padding:5px 0;font-weight:bold;color:${diffOk ? '#16a34a' : '#dc2626'};">Diferencia</td><td style="text-align:right;font-weight:bold;color:${diffOk ? '#16a34a' : '#dc2626'};">${diffOk ? 'S/ 0.00' : (diff > 0 ? '+ ' : '') + fmt(diff)}</td></tr>
  </table>

  ${causasHTML}
  ${recomendacionesHTML}

  ${cierre.observaciones ? `<div style="margin-top:10px;padding:8px;background:#f1f5f9;border-radius:4px;font-size:9px;"><b>Observaciones:</b> ${esc(cierre.observaciones)}</div>` : ''}

  <div style="margin-top:12px;font-size:9px;color:#999;">
    <div>Apertura: ${cierre.fechaApertura ? new Date(cierre.fechaApertura).toLocaleString('es-PE') : '—'}</div>
    <div>Cierre: ${cierre.fechaCierre ? new Date(cierre.fechaCierre).toLocaleString('es-PE') : '—'}</div>
    <div>ID: ${cierre.id}</div>
  </div>

  <div class="footer">Generado el ${new Date().toLocaleDateString('es-PE')} a las ${horaImpresion}</div>
  </body></html>`

  w.document.open()
  w.document.write(html)
  w.document.close()
  w.document.title = `Cierre ${cierre.usuarioNombre ?? ''} ${fechaCierre.toISOString().split('T')[0]}`
  setTimeout(() => {
    w.focus()
    w.print()
  }, 500)
}
