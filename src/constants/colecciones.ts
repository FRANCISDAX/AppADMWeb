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
  /** **Métricas por día**: un documento por fecha local (`YYYY-MM-DD`) con las sumas de Web Vitals, las
   *  visitas medidas y los errores del día. La escriben todos los equipos abiertos (`increment` para los
   *  contadores) y la lee **Auditoría → Observabilidad**. Ver `services/metricas.ts` y `lib/observabilidad.ts`. */
  METRICAS: 'tblMetricas',
  CAJAS: 'tblCajas',
  /** Avisos de pago de Yape: los **crea el puente** (notificación del celular o pasarela) y el
   *  POS solo los lee y avanza su estado. Ver `services/yape.ts`. */
  PAGOS_YAPE: 'tblPagosYape',
  /** **Latido del puente** (la señal de vida del celular del Yape), cada 5 min. El web solo lo
   *  lee para avisar si el puente se cayó. Ver `services/puente.ts`. */
  PUENTE_YAPE: 'tblPuenteYape',
  /** **Alertas proactivas**: qué alertas **pospuse** (y hasta cuándo) cada usuario, para no volver a
   *  verlas en la recarga siguiente. Un documento por usuario. Ver `services/alertas.ts`. */
  ALERTAS_VISTAS: 'tblAlertasVistas',
  /** **Latido del respaldo**: cuándo corrió por última vez la copia y cómo salió. Lo **escribe la
   *  herramienta** de respaldo (`appadm-backup`, con la cuenta de servicio); el app solo lo lee
   *  (Auditoría → Mis Datos y Estado del sistema). Ver `lib/respaldo-estado.ts`. */
  RESPALDO_ESTADO: 'tblRespaldoEstado',
} as const
