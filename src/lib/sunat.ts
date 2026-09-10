// Configuración de conexión a la API SUNAT (SOLO helpers, nunca se llama a la API).
// El envío real lo hace el administrador desde la app móvil.
export function construirUrlApiSunat(base: string, tipo: 'invoices' | 'notes'): string {
  const limpia = String(base || '').trim().replace(/\/+$/, '')
  const sinPath = limpia.replace(/\/v1\/notes\/emitir$/i, '').replace(/\/v1\/invoices\/emitir$/i, '').replace(/\/+$/, '')
  return `${sinPath}${tipo === 'notes' ? '/v1/notes/emitir' : '/v1/invoices/emitir'}`
}

// Devuelve la URL base de la API según modo (producción por defecto).
export function endpointSunat(config: Record<string, any>, tipo: 'invoices' | 'notes', test = false) {
  const base = config.sunatApiUrlProd || config.sunatApiUrl || 'http://192.168.1.7:8000'
  return construirUrlApiSunat(test ? config.sunatApiUrlTest || base : base, tipo)
}

// Construye el payload de un comprobante para SUNAT (SOLO construcción; nunca se envía).
export function construirPayloadComprobante(doc: any, config: Record<string, any>) {
  const venta = doc.venta || {}
  const cliDni = (venta.cliente_dni || '') === '-' ? '' : venta.cliente_dni || ''
  const cliNombre = (venta.cliente_nombre || '') === '-' ? '' : venta.cliente_nombre || ''
  const tipoDocCliente = cliDni.length === 11 ? '6' : '1'
  const tipoComprobante = tipoDocCliente === '6' ? '01' : '03'
  const serie = doc.sunat?.serie || doc.serie || (tipoComprobante === '01' ? config.serieFactura || 'F001' : config.serieBoleta || 'B001')
  const numero = doc.sunat?.numero ?? doc.numero ?? doc.correlativo ?? 0

  let opGravadas = 0
  let opExoneradas = 0
  let opInafectas = 0
  const items = (venta.items || []).map((it: any) => {
    const importe = Number(it.subtotal ?? (it.precioVenta ?? 0) * (it.cantidad ?? 1))
    const af = it.tipoAfectacion || '10'
    if (af.startsWith('10') || af.startsWith('11')) opGravadas += importe
    else if (af.startsWith('2')) opExoneradas += importe
    else if (af.startsWith('3')) opInafectas += importe
    return {
      codigo: it.id || '',
      descripcion: it.nombre,
      cantidad: it.cantidad,
      unidad: it.unidad === 'KG' || it.unidad === 'KGM' ? 'KGM' : 'NIU',
      precio_unitario: it.precioVenta,
      tipo_afectacion: af,
    }
  })
  const igv = Math.round(opGravadas * 0.18 * 100) / 100
  const total = opGravadas + igv + opExoneradas + opInafectas

  return {
    venta_id: venta.id || '',
    tipo: tipoComprobante,
    serie,
    numero,
    fecha_emision: (() => {
      const d = new Date(venta.fecha || doc.fecha || new Date())
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })(),
    ruc_emisor: config.ruc || '',
    razon_social_emisor: config.nombre || '',
    direccion_emisor: config.direccion || '',
    cliente: { tipo_doc: tipoDocCliente, num_doc: cliDni || '00000000', razon_social: cliNombre || 'CLIENTE', direccion: venta.cliente_direccion || '' },
    items,
    totales: { op_gravadas: opGravadas, op_exoneradas: opExoneradas, op_inafectas: opInafectas, igv, total },
  }
}

// Construye el payload de una NOTA de crédito/débito para SUNAT (solo construcción; nunca se envía).
export function construirPayloadNota(doc: any, config: Record<string, any>) {
  const venta = doc.venta || {}
  const esCredito = doc.tipoDoc === 'NC'
  const tipoNotaApi = esCredito ? 'credito' : 'debito'
  const cliDni = (venta.cliente_dni || '') === '-' ? '' : venta.cliente_dni || ''
  const cliNombre = (venta.cliente_nombre || '') === '-' ? '' : venta.cliente_nombre || ''
  const tipoDocCliente = cliDni.length === 11 ? '6' : '1'
  const serie = doc.sunat?.serie || doc.serie || (esCredito ? (config.serieBoletaNC || config.serieFacturaNC || 'BC01') : (config.serieBoletaND || config.serieFacturaND || 'BD01'))
  const numero = doc.sunat?.numero ?? doc.numero ?? null

  // Referencia al comprobante modificado: "serie-numero" (p. ej. B001-000042).
  const refStr = venta.docReferencia || venta.documentoReferencia || `${serie}-${numero}`
  const refParts = refStr.split('-')
  const refSerie = refParts[0]
  const refNumero = refParts.slice(1).join('-')
  const refTipo = (venta.tipoDocOriginal || '').startsWith('F') ? '01' : '03'

  let opGravadas = 0
  let opExoneradas = 0
  let opInafectas = 0
  const items = (venta.items || []).map((it: any) => {
    const importe = Math.abs(Number(it.subtotal ?? (it.precioVenta ?? 0) * (it.cantidad ?? 1)))
    const af = it.tipoAfectacion || '10'
    if (af.startsWith('10') || af.startsWith('11')) opGravadas += importe
    else if (af.startsWith('2')) opExoneradas += importe
    else if (af.startsWith('3')) opInafectas += importe
    return {
      codigo: it.id || '',
      descripcion: it.nombre,
      cantidad: Math.abs(it.cantidad || 1),
      unidad: it.unidad === 'KG' || it.unidad === 'KGM' ? 'KGM' : 'NIU',
      precio_unitario: Math.abs(it.precio_unitario ?? it.precioVenta ?? 0),
      tipo_afectacion: af,
    }
  })
  const igv = Math.round(opGravadas * 0.18 * 100) / 100
  const total = opGravadas + igv + opExoneradas + opInafectas

  return {
    venta_id: venta.id || '',
    tipo_nota: tipoNotaApi,
    serie,
    numero,
    fecha_emision: (() => {
      const d = new Date(venta.fecha || doc.fecha || new Date())
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })(),
    ruc_emisor: config.ruc || '',
    razon_social_emisor: config.nombre || '',
    direccion_emisor: config.direccion || '',
    cliente: { tipo_doc: tipoDocCliente, num_doc: cliDni || '00000000', razon_social: cliNombre || 'CLIENTE' },
    referencia: { tipo_doc: refTipo, serie: refSerie, numero: refNumero ? parseInt(refNumero, 10) : null },
    motivo_codigo: venta.codigoMotivo || (esCredito ? '01' : '02'),
    motivo_descripcion: venta.motivoNota || venta.motivo || '',
    items,
    totales: { op_gravadas: Math.abs(opGravadas), op_exoneradas: Math.abs(opExoneradas), op_inafectas: Math.abs(opInafectas), igv: Math.abs(igv), total: Math.abs(total) },
  }
}
