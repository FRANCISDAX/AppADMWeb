/**
 * **Términos y Condiciones que el ADMIN acepta dentro del app** (29/09/2026).
 *
 * 🔑 **Para qué existe**: el contrato con cada empresa es un **contrato de adhesión**
 * (`docs/legal/01-terminos-y-condiciones.md`) y antes había que hacer firmar una carilla por cliente.
 * Ahora el ADMIN los acepta **una vez** en su primer ingreso y queda **registrado en la base**: quién,
 * **qué versión**, cuándo y con qué huella del texto. Es mejor prueba que un papel: no se pierde, no se
 * puede cambiar la fecha y no hay que perseguir a nadie.
 *
 * ⚠️ **El texto vive acá a propósito** (y no en un archivo que se baja): así funciona **sin internet** y
 * el app no puede quedarse sin mostrar los términos. **Si cambia el texto, subí `VERSION_TERMINOS`** —
 * lo que se aceptó tiene que poder identificarse para siempre. La versión y el texto tienen que coincidir
 * con los del documento legal.
 *
 * ⚠️ Esto es un **resumen fiel** de las cláusulas (las 10 del documento): el texto completo, con los
 * anexos, es el documento que se entrega. La pantalla lo dice.
 */

/** Versión del texto que se acepta. **Subirla cada vez que cambie el texto.** */
export const VERSION_TERMINOS = '1.0'

/** Fecha de esta versión (la que se muestra y se registra). */
export const FECHA_TERMINOS = '29/09/2026'

/** Colección donde queda el registro de aceptación (una por usuario y versión). */
export const COLECCION_ACEPTACIONES = 'tblAceptaciones'

export type ClausulaTerminos = { n: string; titulo: string; texto: string }

/** Las cláusulas que se muestran y se aceptan (espejo de `docs/legal/01-terminos-y-condiciones.md`). */
export const CLAUSULAS_TERMINOS: ClausulaTerminos[] = [
  {
    n: '1',
    titulo: 'Objeto y licencia',
    texto:
      'Se otorga una licencia de uso no exclusiva, intransferible y revocable del software AppADM, en la modalidad de servicio en la nube, para uso interno del negocio. Es una licencia, no una venta: el código, la marca y el software son del proveedor. Los datos que se cargan (ventas, clientes, catálogo, movimientos) son del negocio.',
  },
  {
    n: '2',
    titulo: 'Alcance',
    texto:
      'Incluye los módulos del servicio, con las cajas, sucursales y usuarios del plan contratado. Cada persona usa su propia cuenta (la sesión es única). No incluye equipos, ticketera, lector, internet, energía, certificado digital ante SUNAT, cuenta de Yape ni el teléfono que captura sus avisos.',
  },
  {
    n: '3',
    titulo: 'Puesta en marcha, precio y pago',
    texto:
      'El proveedor implementa el sistema y capacita al personal. El negocio entrega la información correcta (RUC, series autorizadas, catálogo y costos) y verifica una venta completa de punta a punta antes de operar. La contraprestación es la del plan contratado, no incluye IGV; el retraso habilita la suspensión del servicio previo aviso.',
  },
  {
    n: '4',
    titulo: 'Plazo, terminación y salida',
    texto:
      'El plazo es el del plan contratado y se renueva salvo aviso en contrario. Al terminar, el proveedor exporta toda la información en formato abierto y la entrega, y luego elimina los datos y el proyecto dejando constancia escrita. El negocio debe descargar y conservar su información.',
  },
  {
    n: '5',
    titulo: 'Obligaciones del proveedor',
    texto:
      'Prestar el servicio con diligencia y con las medidas de seguridad del Anexo B; respaldar la información a diario conservando las copias 30 días; dar soporte en el canal y horario acordados; avisar los cambios que afecten el uso normal y, de inmediato, cualquier incidente de seguridad; y mantener la confidencialidad de la información, incluso después de terminado el contrato.',
  },
  {
    n: '6',
    titulo: 'Obligaciones del negocio',
    texto:
      'Usar el software conforme a la licencia y al manual, sin copiarlo, modificarlo, revenderlo, sublicenciarlo ni cederlo; usar cuentas nominales y cuidar las claves; contar con internet, energía, equipos, ticketera, certificado digital y series autorizadas; responder por la información que carga y por su cumplimiento tributario (el emisor electrónico es el negocio); e informar sin demora cualquier incidente (acceso no autorizado, pérdida de un dispositivo).',
  },
  {
    n: '7',
    titulo: 'Garantía y límite de responsabilidad',
    texto:
      'El software se entrega «tal cual» y «según disponibilidad», sin garantizar resultados comerciales. Los reportes, márgenes, utilidad y punto de equilibrio son referenciales: dependen de los costos y datos que carga el negocio y NO reemplazan la contabilidad ni el asesoramiento de un contador. No hay responsabilidad por lucro cesante, daño indirecto ni por la información que el negocio no haya descargado con las herramientas del sistema. La responsabilidad total del proveedor se limita a las contraprestaciones pagadas en los últimos 12 meses. No responde por fallas de Google, SUNAT, bancos, Yape/Plin, internet, energía ni fuerza mayor.',
  },
  {
    n: '8',
    titulo: 'Protección de datos personales',
    texto:
      'El negocio es el responsable de los datos personales de sus clientes y el proveedor su encargado; el tratamiento se rige por el Anexo B, que forma parte de estos Términos.',
  },
  {
    n: '9',
    titulo: 'Propiedad intelectual y confidencialidad',
    texto:
      'El software y su marca pertenecen al proveedor; los datos, al negocio. Ambas partes mantienen en reserva la información comercial y técnica a la que accedan, durante la vigencia y por los años siguientes que establece el contrato.',
  },
  {
    n: '10',
    titulo: 'Modificaciones, comunicaciones y ley aplicable',
    texto:
      'El proveedor puede actualizar estos Términos: la versión vigente es la publicada, con su fecha y número de versión, y los cambios que afecten el uso normal se avisan con anticipación. Las comunicaciones valen por correo electrónico a los domicilios informados. El contrato se rige por las leyes de la República del Perú.',
  },
]

/** Lo que la pantalla aclara al pie (y también queda aceptado). */
export const NOTA_TERMINOS =
  'Este es el texto de las cláusulas (versión ' +
  VERSION_TERMINOS +
  ' del ' +
  FECHA_TERMINOS +
  '). El documento completo, con los anexos de servicio, datos personales y soporte, es el que te entregó el proveedor.'

/**
 * **Huella del texto aceptado** (FNV-1a, estable y sin dependencias).
 * ⚠️ No es una firma criptográfica: sirve para **detectar si el texto cambió** sin subir la versión y
 * para dejar registrado qué texto exacto se mostró. Con la misma versión, la huella tiene que ser igual.
 */
export function huellaTerminos(clausulas: readonly ClausulaTerminos[] = CLAUSULAS_TERMINOS): string {
  const texto = clausulas.map((c) => `${c.n}. ${c.titulo}: ${c.texto}`).join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * **Id del documento de aceptación**: uno por usuario y versión, así aceptar dos veces no crea dos
 * registros (y la regla prohíbe editarlos: la constancia no se toca).
 */
export function idAceptacion(uid: string, version: string = VERSION_TERMINOS): string {
  return `terminos_${version}_${String(uid || '').trim()}`
}

/** El texto en plano (para copiar, imprimir o guardar junto al contrato). */
export function textoPlanoTerminos(): string {
  const cabecera = `TÉRMINOS Y CONDICIONES DE USO — AppADM · versión ${VERSION_TERMINOS} (${FECHA_TERMINOS})`
  const cuerpo = CLAUSULAS_TERMINOS.map((c) => `${c.n}. ${c.titulo}\n${c.texto}`).join('\n\n')
  return `${cabecera}\n\n${cuerpo}\n\n${NOTA_TERMINOS}`
}
