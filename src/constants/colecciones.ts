// Mismas colecciones que constants/Colecciones.js de la app RN.
export const COL = {
  PRODUCTOS: 'tblProductos',
  MOVIMIENTOS: 'tblMovimientos',
  DOCUMENTOS: 'tblDocumentos',
  CONTADORES: 'tblContadores',
  TURNOS: 'tblTurnos',
  CIERRES: 'tblCierresCaja',
  CLIENTES: 'tblClientes',
  USUARIO: 'tblUsuarios',
  PROVEEDOR: 'tblProveedores',
  EGRESOS: 'tblEgresos',
  HISTORIAL_PRECIOS: 'tblHistorialPrecios',
  PROMOCIONES_VOLUMEN: 'tblPromocionesVolumen',
  CONFIGURACION: 'tblConfiguracion',
  CATEGORIAS: 'tblCategorias',
  ERRORES: 'tblErrores',
  CAJAS: 'tblCajas',
  /** Avisos de pago de Yape: los **crea el puente** (notificación del celular o pasarela) y el
   *  POS solo los lee y avanza su estado. Ver `services/yape.ts`. */
  PAGOS_YAPE: 'tblPagosYape',
  /** **Latido del puente** (la señal de vida del celular del Yape), cada 5 min. El web solo lo
   *  lee para avisar si el puente se cayó. Ver `services/puente.ts`. */
  PUENTE_YAPE: 'tblPuenteYape',
} as const
