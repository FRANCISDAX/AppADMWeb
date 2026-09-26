// Mismo enum de SUNAT que constants/Tributario.js en la app RN.
import {
  ALERTA_ANULACIONES_DIA_POR_DEFECTO,
  ALERTA_DESCUENTO_PORCENTAJE_POR_DEFECTO,
  ALERTA_DIFERENCIA_CAJA_POR_DEFECTO,
  ALERTA_STOCK_POR_DEFECTO,
  ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO,
  ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO,
} from '@/lib/alertas'
import {
  DIAS_VENCIMIENTO_POR_DEFECTO,
  INTERVALO_AUTO_MINUTOS_POR_DEFECTO,
  MAX_POR_PASADA_POR_DEFECTO,
} from '@/lib/sunat-auto'

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
  // 🔑 **¿El IGV de las compras es un crédito fiscal?** (empresa de Lima que compra **y** vende
  // gravado). Si está prendido, el **ingreso de mercadería** le separa el IGV al costo que se carga:
  // se escribe el total de la factura (S/ 118) y el costo que se guarda es el neto (S/ 100), que es la
  // base con la que se mide el margen y se valoriza el inventario (`lib/precio-venta.ts` →
  // `costoDeCompra`).
  // ⚠️ **Apagado = el IGV es COSTO** (por defecto): es el caso de esta región, donde los productos son
  // exonerados y el IGV de una compra hecha afuera **no se recupera**, así que lo que se escribe es lo
  // que vale la mercadería. Con esto apagado **nada cambia** (medido el 25/09/2026).
  // ⚠️ Es una decisión **fiscal**: la confirma el contador, no la app.
  igvRecuperable: false,
  /** Conteo ciego: al cerrar el turno NO se muestra el "Debería haber" hasta que el cajero
   *  registre lo que contó (control anti-fraude; apagado por defecto). */
  conteoCiego: false,
  sunatApiUrlProd: 'http://192.168.1.7:8000',
  sunatApiUrlTest: 'http://192.168.1.7:8000',
  consultaApiBase: '',
  serieBoletaNC: 'BC01',
  serieBoletaND: 'BD01',
  serieFacturaNC: 'FC01',
  serieFacturaND: 'FD01',
  // Afectación con la que se declaran los items manuales del PDV ("Embalaje y
  // Otros": hielo, bolsas, embalaje). **Tiene que coincidir con la afectación del
  // catálogo**: si los productos son exonerados ('20') y el item manual va como
  // gravado ('10'), el comprobante suma 18% de IGV y declara más de lo cobrado.
  tipoAfectacionManual: '20',
  // Código de establecimiento anexo (catálogo 22) del emisor. '0000' = casa
  // matriz. Va dentro del XML que se firma, así que entra al hash SUNAT.
  puntoEmision: '0000',
  topeBoletaDni: 700,
  // Tope del **descuento manual** que carga una persona en el PDV (porcentaje).
  // ⚠️ `0` = **sin tope** (misma convención que `limiteCredito = 0` = sin límite): al revés,
  // ningún negocio que no lo configure podría descontar nada. No afecta a las promociones ni a
  // los descuentos configurados (volumen, producto, cliente), que se aplican siempre.
  descuentoMaximoPorcentaje: 0,
  servidor: '',
  envioHabilitado: false,
  zonasEnvio: [
    { id: 'centro', nombre: 'Centro', costo: 3 },
    { id: 'norte', nombre: 'Norte', costo: 5 },
    { id: 'sur', nombre: 'Sur', costo: 5 },
    { id: 'este', nombre: 'Este', costo: 7 },
    { id: 'fuera', nombre: 'Fuera de la ciudad', costo: 10 },
  ],
  // 🔑 **Receptor de la BOLETA CONSOLIDADA** (la que agrupa las notas de venta del día): no hay un
  // cliente real, así que el nombre es un rótulo que se imprime en el papel y se declara a SUNAT.
  // Estaba fijo en 'CONSUMIDOR FINAL' (el consolidador ya leía estos campos, pero no había dónde
  // configurarlos). Ahora se editan en **Configuración → SUNAT**; vacío vuelve al valor por defecto
  // (`lib/consolidado.ts` es la regla única). ⚠️ El documento del receptor es `00000000`
  // (doc. no domina): cambiarlo es una decisión fiscal, hablarlo con el contador.
  clienteDefaultNombre: 'CONSUMIDOR FINAL',
  clienteDefaultDni: '00000000',
  // 🔑 **Avisos de pago de Yape** (ver `lib/yape.ts` y `services/yape.ts`): cuando el cliente
  // yapea, el negocio recibe el aviso y el cajero tiene que enterarse **en el PDV**, sin mirar
  // el teléfono. Los avisos los escribe el **puente** (el que lee el aviso real: la notificación
  // del celular o, más adelante, el webhook de una pasarela); este app solo los lee y los marca
  // como usados. `yapeAvisoActivo` **apagado** = el PDV no muestra el panel.
  yapeAvisoActivo: true,
  // Minutos que un aviso sirve para usarse. ⚠️ Acá 0 **no** significa "sin tope" (esa convención
  // es de `descuentoMaximoPorcentaje` y `limiteCredito`): una vigencia de 0 dejaría todos los
  // avisos vencidos y el panel vacío sin explicación, así que se ignora y se usa el valor por
  // defecto de `lib/yape.ts`.
  yapeVigenciaMinutos: 10,
  /** Sonar en el PDV cuando llega un aviso nuevo. */
  yapeSonido: true,
  /** Número de Yape del negocio: se muestra en el aviso para dictárselo al cliente. */
  yapeNumero: '',
  plantillasManuales: [] as { id: string; nombre: string; precio: number }[],
  listasPrecios: [
    { id: 'general', nombre: 'General', defecto: true },
    { id: 'mayorista', nombre: 'Mayorista', defecto: false },
    { id: 'preferencial', nombre: 'Preferencial', defecto: false },
  ] as { id: string; nombre: string; defecto: boolean }[],
  // 🔑 **Alertas proactivas** (`lib/alertas.ts` es la regla única): el tablero avisa de lo que ya
  // está mal sin que nadie tenga que ir a buscarlo (el puente caído, un turno de otro día sin
  // cerrar, stock agotado, avisos de Yape sin usar, diferencias de caja, anulaciones y descuentos).
  // ⚠️ **`0` = regla APAGADA** (misma convención que `descuentoMaximoPorcentaje` y `limiteCredito`);
  // `alertaStockBajo` es un interruptor. Los valores iniciales salen del propio módulo de alertas
  // para que no existan dos listas de números que se puedan contradecir.
  alertaStockBajo: ALERTA_STOCK_POR_DEFECTO,
  alertaYapeSinUsarMinutos: ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO,
  alertaTurnoAbiertoHoras: ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO,
  alertaDiferenciaCaja: ALERTA_DIFERENCIA_CAJA_POR_DEFECTO,
  alertaAnulacionesDia: ALERTA_ANULACIONES_DIA_POR_DEFECTO,
  alertaDescuentoPorcentaje: ALERTA_DESCUENTO_PORCENTAJE_POR_DEFECTO,
  // 🔑 **Envío automático a SUNAT** (`lib/sunat-auto.ts` es la regla única): un comprobante
  // electrónico **no tiene calidad de factura** hasta que SUNAT devuelve el CDR, y hasta hoy el envío
  // dependía de que alguien entrara a `Reportes → Registro SUNAT` y apretara *Enviar* documento por
  // documento. Con esto se manda solo; **el botón manual sigue funcionando igual**, esté el automático
  // prendido o apagado (y es la salida para lo que el automático ya no manda: lo vencido y lo
  // rechazado).
  // ⚠️ **`sunatAutoDiasVencimiento` es un solo número para todo lo que va a SUNAT**: las facturas
  // vencen a los 3 días calendario (RS 000003-2023/SUNAT) y las boletas a los 7; se usa el más
  // estricto. Sirve para **avisar** (alerta de comprobantes por vencer) y para **frenar** el envío
  // automático de lo vencido. El plazo legal de cada documento no cambia por configurarlo.
  sunatAutoEnvio: true,
  sunatAutoDiasVencimiento: DIAS_VENCIMIENTO_POR_DEFECTO,
  sunatAutoIntervaloMinutos: INTERVALO_AUTO_MINUTOS_POR_DEFECTO,
  sunatAutoMaxPorPasada: MAX_POR_PASADA_POR_DEFECTO,
}

