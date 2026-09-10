// Mismo enum de SUNAT que constants/Tributario.js en la app RN.
export type Afectacion = { codigo: string; label: string }

export const TIPO_AFECTACION: Afectacion[] = [
  { codigo: '10', label: 'Gravado - Operación Onerosa' },
  { codigo: '11', label: 'Gravado - Retiro por premio' },
  { codigo: '12', label: 'Gravado - Retiro por donación' },
  { codigo: '13', label: 'Gravado - Retiro entrega trabajadores' },
  { codigo: '14', label: 'Gravado - Retiro por publicidad' },
  { codigo: '15', label: 'Gravado - Retiro por muestras médicas' },
  { codigo: '16', label: 'Gravado - Retiro por convenio colectivo' },
  { codigo: '17', label: 'Gravado - Retiro por premio por sorteo' },
  { codigo: '18', label: 'Gravado - IVAP' },
  { codigo: '19', label: 'Gravado - IVAP retiro' },
  { codigo: '20', label: 'Exonerado - Operación Onerosa' },
  { codigo: '21', label: 'Exonerado - Transferencia Gratuita' },
  { codigo: '22', label: 'Exonerado - Retiro' },
  { codigo: '30', label: 'Inafecto - Operación Onerosa' },
  { codigo: '31', label: 'Inafecto - Retiro por Bonificación' },
  { codigo: '32', label: 'Inafecto - Retiro Muestras Médicas' },
  { codigo: '33', label: 'Inafecto - Retiro por publicidad' },
  { codigo: '34', label: 'Inafecto - Retiro entrega trabajadores' },
  { codigo: '35', label: 'Inafecto - Retiro por premio' },
  { codigo: '36', label: 'Inafecto - Retiro por convenio colectivo' },
  { codigo: '37', label: 'Inafecto - Retiro por premio por sorteo' },
  { codigo: '40', label: 'Exportación' },
]

export const AFECTACION_POR_DEFECTO = '10'

export const TIPOS_NOTA_SUNAT: { codigo: string; label: string; tipo: 'credito' | 'debito' }[] = [
  { codigo: '01', label: 'Anulación de la operación', tipo: 'credito' },
  { codigo: '02', label: 'Anulación por error en el RUC', tipo: 'credito' },
  { codigo: '03', label: 'Corrección por error en la descripción', tipo: 'credito' },
  { codigo: '04', label: 'Descuento global', tipo: 'credito' },
  { codigo: '05', label: 'Descuento por ítem', tipo: 'credito' },
  { codigo: '06', label: 'Devolución total', tipo: 'credito' },
  { codigo: '07', label: 'Devolución por ítem', tipo: 'credito' },
  { codigo: '08', label: 'Bonificación', tipo: 'credito' },
  { codigo: '09', label: 'Disminución en el valor', tipo: 'credito' },
  { codigo: '10', label: 'Otros conceptos', tipo: 'credito' },
  { codigo: '11', label: 'Ajustes de operaciones de exportación', tipo: 'credito' },
  { codigo: '12', label: 'Ajustes afectos al IVAP', tipo: 'credito' },
  { codigo: '13', label: 'Corrección del monto neto pendiente de pago y/o fechas de vencimiento', tipo: 'credito' },
  { codigo: '01', label: 'Intereses por mora', tipo: 'debito' },
  { codigo: '02', label: 'Aumento en el valor', tipo: 'debito' },
  { codigo: '03', label: 'Penalidades u otros conceptos', tipo: 'debito' },
]

export const TIPOS_REGIMEN: { id: string; label: string }[] = [
  { id: 'general', label: 'Régimen General / MYPE Tributario (RMT)' },
  { id: 'rus', label: 'Régimen Único Simplificado (RUS/NRUS)' },
  { id: 'especial', label: 'Régimen Especial (RER)' },
]

export const CONFIG_POR_DEFECTO = {
  nombre: 'AppADM',
  ruc: '20600000000',
  direccion: 'Av. Principal 123 - Lima',
  correo: 'contacto@appadm.pe',
  telefono: '999 888 777',
  sucursal: '',
  mensaje: '¡Gracias por su preferencia!',
  serie_prefijo: 'BB02',
  serieBoleta: 'B001',
  serieFactura: 'F001',
  logo_url: '',
  tipoRegimen: 'general',
  regionExonerada: false,
  sunatApiUrlProd: 'http://192.168.1.7:8000',
  sunatApiUrlTest: 'http://192.168.1.7:8000',
  consultaApiBase: '',
  serieBoletaNC: 'BC01',
  serieBoletaND: 'BD01',
  serieFacturaNC: 'FC01',
  serieFacturaND: 'FD01',
  topeBoletaDni: 700,
  servidor: '',
}

