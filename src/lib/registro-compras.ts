/**
 * **Registro de Compras (SUNAT · RCE)** — módulo puro.
 *
 * Arma, a partir de las compras que ya están guardadas en el kardex, las filas del **Registro de Compras
 * Electrónico** que SUNAT pide en el **SIRE (RCE)**: un documento por cada comprobante del proveedor, con su
 * base imponible, su IGV, sus adquisiciones no gravadas y su importe total.
 *
 * 🔑 **De dónde sale cada regla** (no está inventado acá): *Anexo de la RS 040-2022/SUNAT* →
 * **Anexo 8.4 «Registro de Compras»** (estructura y reglas del archivo que complementa la propuesta del RCE):
 * <https://www.sunat.gob.pe/legislacion/superin/2022/anexo-040-2022.pdf>
 *   - **Tabla 11** (tipo de comprobante de pago o documento · RCE): los códigos `01`, `03`, `04`, `07`, `08`,
 *     `12`, `87`, `88`, `91`… que se usan acá.
 *   - **Tabla 7** (CAR SUNAT): el Código de Anotación de Registro son **27 caracteres** =
 *     `RUC del emisor (11) + tipo de comprobante (2) + serie (4) + número (10)`, con ceros a la izquierda; si
 *     el serie/número es más largo que su longitud, se toman los dígitos **desde la derecha**.
 *   - **Tabla 1** (tipo de documento de identidad): `6` = RUC, `1` = DNI, `0` = doc. tributario no domiciliado
 *     sin RUC.
 *   - ⚠️ **El signo**: las notas de crédito (`07`, `87`) van con los importes en **negativo** («valor negativo
 *     cuando campo 7 = '07','87'»); las notas de débito (`08`, `88`) en positivo.
 *   - 🔑 **Con derecho y sin derecho a crédito fiscal son columnas distintas**: las adquisiciones gravadas se
 *     declaran en **DG** (con derecho a crédito fiscal) o en **DGNG** (sin derecho). Cuál es, **no lo puede
 *     adivinar el sistema**: lo dice el negocio (`config.igvRecuperable`, que se guarda **en cada compra** para
 *     que el registro no cambie porque después se cambió la config).
 *
 * ⚠️ **El proveedor pone la base y el IGV, no el catálogo**: un producto puede venderse exonerado y comprarse
 * con una factura que **sí** trae IGV (es el caso real de esta región: se compra en Lima y se vende exonerado).
 * Por eso lo que manda es **lo que dice el comprobante de la compra** (`traeIgv`, que se marca al cargarla), no
 * la afectación del producto.
 *
 * Módulo puro (sin Firebase ni React): se prueba con el runner nativo de Node (`npm test`).
 */

import { redondear2 } from './dinero.ts'

/** IGV vigente en el Perú (18%). La base se despeja dividiendo por `1 + tasa`. */
export const IGV_RATE = 0.18

/**
 * **Tipos de comprobante de pago del proveedor** (Tabla 11 del RCE, RS 040-2022/SUNAT).
 * Están los que usa una tienda o un minimarket; cualquier otro va como `00 · Otros`.
 * ⚠️ `nota` marca las notas de crédito/débito, que son las que llevan **signo** en el registro.
 */
export const TIPOS_COMPROBANTE_COMPRA: { codigo: string; label: string; nota?: 'credito' | 'debito' }[] = [
  { codigo: '01', label: 'Factura' },
  { codigo: '03', label: 'Boleta de venta' },
  { codigo: '04', label: 'Liquidación de compra' },
  { codigo: '12', label: 'Ticket / Ticket POS' },
  { codigo: '02', label: 'Recibo por honorarios' },
  { codigo: '07', label: 'Nota de crédito', nota: 'credito' },
  { codigo: '08', label: 'Nota de débito', nota: 'debito' },
  { codigo: '87', label: 'Nota de crédito especial', nota: 'credito' },
  { codigo: '88', label: 'Nota de débito especial', nota: 'debito' },
  { codigo: '00', label: 'Otros' },
]

/** El rótulo de un código (para la pantalla y el Excel), con respaldo si viene uno que no está en la lista. */
export function labelTipoComprobante(codigo?: string): string {
  const c = String(codigo ?? '').trim()
  return TIPOS_COMPROBANTE_COMPRA.find((t) => t.codigo === c)?.label ?? (c ? `Otros (${c})` : 'Sin tipo')
}

/** ¿Es una **nota de crédito**? Va con los importes en negativo (Tabla 12 del anexo). */
export function esNotaCredito(codigo?: string): boolean {
  return ['07', '87'].includes(String(codigo ?? '').trim())
}

/** ¿Es una **nota de débito**? Va en positivo (es una adquisición más). */
export function esNotaDebito(codigo?: string): boolean {
  return ['08', '88'].includes(String(codigo ?? '').trim())
}

/** El signo con el que van los importes de ese tipo de comprobante. */
export function signoDeComprobante(codigo?: string): 1 | -1 {
  return esNotaCredito(codigo) ? -1 : 1
}

/** El comprobante del proveedor **leído de la nota** de una compra vieja (texto libre). */
export type ComprobanteDeNota = {
  tipoComprobante: string
  serie: string
  numero: string
  /** El tipo salió de la **letra de la serie** (`F`/`B`) y no de una palabra escrita en la nota. */
  tipoPorSerie: boolean
}

/** Cómo se puede nombrar el tipo en la nota (gana la primera que aparezca: es lo que se escribió a mano). */
const TIPO_POR_PALABRA: { re: RegExp; codigo: string }[] = [
  { re: /\bNOTA\s+DE\s+CREDITO\b/, codigo: '07' },
  { re: /\bNOTA\s+DE\s+DEBITO\b/, codigo: '08' },
  { re: /\bLIQUIDACION\b/, codigo: '04' },
  { re: /\bFACTURA\b/, codigo: '01' },
  { re: /\bBOLETA\b/, codigo: '03' },
  { re: /\bTICKET\b/, codigo: '12' },
]

/**
 * **La letra con la que empieza la serie dice el tipo** (SUNAT: las facturas usan series que empiezan con `F`
 * y las boletas con `B`). Se usa **solo** para leer lo que ya estaba escrito en la nota: no decide nada de una
 * compra que trae su tipo declarado.
 */
const TIPO_POR_LETRA: Record<string, string> = { F: '01', B: '03' }

/**
 * **Lee el comprobante del proveedor de la nota de una compra vieja.**
 *
 * 🔑 **Por qué existe**: hasta el 26/09/2026 el ingreso de mercadería **no tenía campos** para el comprobante
 * del proveedor, así que ese dato se escribía a mano en la **nota** (el campo libre) y quedó guardado ahí —
 * casos reales: `FF02-553`, `F001-123`. El RCE necesita el tipo, la serie y el número (de ahí sale el CAR de
 * 27 dígitos), así que esta función **lee lo que la persona ya escribió** en vez de pedirle que lo vuelva a
 * tipear… y **no adivina**: si la nota no trae un `SERIE-NÚMERO` con una serie que SUNAT use (`F…` o `B…`) o
 * una palabra que diga el tipo, devuelve `null` y la compra sigue avisada como incompleta.
 *
 * ⚠️ Cuando el tipo sale de la **letra** de la serie, la fila se marca (`tipoPorSerie`) y la pantalla lo dice:
 * es una lectura de un texto libre, no un dato declarado — conviene que el contador la revise.
 */
export function comprobanteDeNota(nota?: string): ComprobanteDeNota | null {
  const texto = String(nota ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  // `FF02-553`, `F001 123`, `B001-00000123`, `B001/45`…
  const m = texto.match(/\b([A-Z]{1,2}\d{2,4})\s*[-–—/ ]\s*(\d{1,12})\b/)
  if (!m) return null

  const serie = m[1]
  // Sin ceros a la izquierda: el CAR los vuelve a poner (y `ajustar` corta por la derecha si sobra).
  const numero = String(Number(m[2]))
  const palabra = TIPO_POR_PALABRA.find((t) => t.re.test(texto))
  const codigo = palabra?.codigo ?? TIPO_POR_LETRA[serie[0]]
  if (!codigo) return null

  return { tipoComprobante: codigo, serie, numero, tipoPorSerie: !palabra }
}

/**
 * **Tipo de documento de identidad** del proveedor (Tabla 1 del RVIE/RCE): `6` = RUC (11 dígitos),
 * `1` = DNI (8), `0` = doc. tributario no domiciliado sin RUC (cualquier otro caso).
 */
export function tipoDocIdentidad(documento?: string): string {
  const doc = String(documento ?? '').replace(/\D/g, '')
  if (doc.length === 11) return '6'
  if (doc.length === 8) return '1'
  return '0'
}

/** Rellena con ceros a la izquierda, o se queda con los dígitos de la derecha si es más largo (Tabla 7). */
function ajustar(valor: unknown, largo: number): string {
  const limpio = String(valor ?? '').replace(/[^0-9A-Za-z]/g, '')
  if (limpio.length === largo) return limpio.toUpperCase()
  if (limpio.length > largo) return limpio.slice(limpio.length - largo).toUpperCase()
  return limpio.padStart(largo, '0').toUpperCase()
}

/**
 * **CAR SUNAT**: el Código de Anotación de Registro de un comprobante, **27 caracteres**
 * (`RUC 11 + tipo 2 + serie 4 + número 10`, Tabla 7 del anexo). Es con lo que SUNAT identifica cada
 * comprobante en el registro, así que va en el export y en la pantalla.
 */
export function carSunat({
  documento,
  tipoComprobante,
  serie,
  numero,
}: {
  documento?: string
  tipoComprobante?: string
  serie?: string
  numero?: string | number
}): string {
  return (
    ajustar(String(documento ?? '').replace(/\D/g, ''), 11) +
    ajustar(tipoComprobante, 2) +
    ajustar(serie, 4) +
    ajustar(numero, 10)
  )
}

/** Un ítem de una compra, tal como se guarda en el kardex (lo que el registro necesita de cada uno). */
export type ItemCompraRegistro = {
  /** Importe de la línea **tal como dice el comprobante** (precio × cantidad, con IGV si lo trae). */
  importe: number
  /** ¿El comprobante del proveedor trae IGV? (se marca al cargar la compra). */
  traeIgv?: boolean
  /** ¿Ese IGV es **crédito fiscal**? (el negocio lo recupera). Decide DG vs DGNG. */
  igvConCredito?: boolean
}

/** Una compra ya agrupada (un comprobante del proveedor). */
export type CompraRegistro = {
  compraId: string
  fecha: string
  proveedor?: string
  proveedorId?: string
  tipoComprobante?: string
  serie?: string
  numero?: string
  /** Fecha de emisión del comprobante del proveedor (si no se cargó, se usa la de la compra). */
  fechaEmision?: string
  nota?: string
  items: ItemCompraRegistro[]
  /** `true` cuando quien cargó la compra marcó que ese IGV es crédito fiscal (respaldo histórico). */
  igvRecuperable?: boolean
}

/** Una fila del registro: un comprobante del proveedor con sus importes ya separados. */
export type FilaRegistroCompras = {
  compraId: string
  fecha: string
  tipoComprobante: string
  tipoComprobanteLabel: string
  serie: string
  numero: string
  /** 27 caracteres (Tabla 7). Vacío si no hay documento del proveedor. */
  car: string
  proveedor: string
  proveedorDocumento: string
  tipoDocIdentidad: string
  /** Base imponible de las adquisiciones gravadas — **DG** (con derecho a crédito fiscal). */
  baseConCredito: number
  /** IGV de esas adquisiciones. */
  igvConCredito: number
  /** Base imponible de las adquisiciones gravadas — **DGNG** (sin derecho a crédito fiscal). */
  baseSinCredito: number
  /** IGV de esas adquisiciones (el que no se usa como crédito). */
  igvSinCredito: number
  /** Valor de las adquisiciones **no gravadas** (exoneradas/inafectas: sin IGV en el comprobante). */
  noGravadas: number
  /** Importe total de las adquisiciones (lo que se pagó). */
  total: number
  /** `-1` en las notas de crédito: los importes ya vienen con ese signo aplicado. */
  signo: 1 | -1
  /** El comprobante salió de la **nota** de la compra (texto libre): es una compra anterior a los campos nuevos. */
  leidoDeNota: boolean
  /** El tipo salió de la **letra de la serie** de la nota (`F`/`B`), no de un dato declarado. */
  tipoPorSerie: boolean
  items: number
}

export type AvisoRegistroCompras = {
  compraId: string
  proveedor: string
  /** Qué le falta a esa compra para que la fila sirva en el registro. */
  falta: string[]
}

export type RegistroCompras = {
  filas: FilaRegistroCompras[]
  totales: {
    comprobantes: number
    baseConCredito: number
    igvConCredito: number
    baseSinCredito: number
    igvSinCredito: number
    noGravadas: number
    /** Suma de los importes de todos los comprobantes (con signo). */
    total: number
    /** Lo que hay que pagar a SUNAT por estas compras si el IGV es crédito: informativo. */
    igvCreditoFiscal: number
    /** Cuántas filas sacaron el comprobante de la **nota** (compras anteriores a los campos nuevos). */
    comprobantesDeNota: number
  }
  avisos: AvisoRegistroCompras[]
}

/**
 * **Arma el registro de compras de un periodo**: una fila por comprobante del proveedor.
 *
 * Reglas (las del anexo):
 * - Las líneas se reparten según **lo que dice el comprobante**: si trae IGV, la base se despeja
 *   (`importe ÷ 1,18`) y el resto es IGV; si no lo trae, todo el importe va a **no gravadas**.
 * - Ese IGV va a la columna **DG** (con derecho a crédito) o **DGNG** (sin derecho), según
 *   `traeIgv`/`igvConCredito` de cada ítem (y, si la compra es vieja y no tiene el dato, según la config).
 * - Las **notas de crédito** van con los importes en negativo.
 *
 * ⚠️ Los importes se redondean a 2 decimales **por línea** (como cualquier libro contable) y los totales se
 * suman de las filas ya redondeadas: así el total del registro **siempre** coincide con la suma de las filas.
 */
export function armarRegistroCompras(
  compras: readonly CompraRegistro[],
  opts?: { igvRecuperable?: boolean },
): RegistroCompras {
  const filas: FilaRegistroCompras[] = []
  const avisos: AvisoRegistroCompras[] = []

  for (const c of compras ?? []) {
    const tipoDeclarado = String(c.tipoComprobante ?? '').trim()
    const serieDeclarada = String(c.serie ?? '').trim()
    const numeroDeclarado = String(c.numero ?? '').trim()
    // 🔑 **El comprobante se lee de la nota SOLO si faltan los campos nuevos**: hasta el 26/09/2026 el modal de
    // compra no los tenía y ese dato se escribía a mano en la nota (`FF02-553`). Una compra de ahora ya trae
    // tipo/serie/número propios, así que su nota no se interpreta nunca.
    const deNota = !tipoDeclarado || !serieDeclarada || !numeroDeclarado ? comprobanteDeNota(c.nota) : null
    const tipo = tipoDeclarado || deNota?.tipoComprobante || ''
    const serie = serieDeclarada || deNota?.serie || ''
    const numero = numeroDeclarado || deNota?.numero || ''
    const leidoDeNota = Boolean(deNota) && (!tipoDeclarado || !serieDeclarada || !numeroDeclarado)
    const signo = signoDeComprobante(tipo)
    const documento = String(c.proveedorId ?? '').replace(/\D/g, '')
    // El respaldo para las compras anteriores a este cambio: la config de hoy.
    const creditoPorDefecto = c.igvRecuperable ?? opts?.igvRecuperable ?? false

    let baseConCredito = 0
    let igvConCredito = 0
    let baseSinCredito = 0
    let igvSinCredito = 0
    let noGravadas = 0

    for (const it of c.items ?? []) {
      const importe = redondear2(Number(it.importe) || 0)
      if (importe === 0) continue
      if (it.traeIgv) {
        const base = redondear2(importe / (1 + IGV_RATE))
        const igv = redondear2(importe - base)
        const conCredito = it.igvConCredito ?? creditoPorDefecto
        if (conCredito) {
          baseConCredito += base
          igvConCredito += igv
        } else {
          baseSinCredito += base
          igvSinCredito += igv
        }
      } else {
        noGravadas += importe
      }
    }

    const aplicar = (n: number) => redondear2(n * signo)
    const total = redondear2(baseConCredito + igvConCredito + baseSinCredito + igvSinCredito + noGravadas)

    const falta: string[] = []
    if (!tipo) falta.push('tipo de comprobante')
    if (!serie || !numero) falta.push('serie y número')
    if (!documento) falta.push('RUC/DNI del proveedor')
    if (!(c.items ?? []).some((i) => i.importe > 0)) falta.push('importes')
    if (falta.length > 0) avisos.push({ compraId: c.compraId, proveedor: c.proveedor ?? '', falta })

    filas.push({
      compraId: c.compraId,
      fecha: c.fechaEmision || c.fecha,
      tipoComprobante: tipo,
      tipoComprobanteLabel: labelTipoComprobante(tipo),
      serie,
      numero,
      car: tipo && documento && serie && numero
        ? carSunat({ documento, tipoComprobante: tipo, serie, numero })
        : '',
      proveedor: String(c.proveedor ?? '').trim(),
      proveedorDocumento: documento,
      tipoDocIdentidad: tipoDocIdentidad(documento),
      baseConCredito: aplicar(baseConCredito),
      igvConCredito: aplicar(igvConCredito),
      baseSinCredito: aplicar(baseSinCredito),
      igvSinCredito: aplicar(igvSinCredito),
      noGravadas: aplicar(noGravadas),
      total: aplicar(total),
      signo,
      leidoDeNota,
      tipoPorSerie: Boolean(deNota?.tipoPorSerie) && leidoDeNota,
      items: (c.items ?? []).length,
    })
  }

  // Más viejo primero (como se anota un libro), y lo demás por comprobante.
  filas.sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)) || a.compraId.localeCompare(b.compraId))

  const sumar = (f: (x: FilaRegistroCompras) => number) => redondear2(filas.reduce((s, x) => s + f(x), 0))
  const baseConCreditoTotal = sumar((x) => x.baseConCredito)
  const igvConCreditoTotal = sumar((x) => x.igvConCredito)

  return {
    filas,
    totales: {
      comprobantes: filas.length,
      baseConCredito: baseConCreditoTotal,
      igvConCredito: igvConCreditoTotal,
      baseSinCredito: sumar((x) => x.baseSinCredito),
      igvSinCredito: sumar((x) => x.igvSinCredito),
      noGravadas: sumar((x) => x.noGravadas),
      total: sumar((x) => x.total),
      igvCreditoFiscal: igvConCreditoTotal,
      comprobantesDeNota: filas.filter((f) => f.leidoDeNota).length,
    },
    avisos,
  }
}

/** `AAAA-MM` → `AAAAMM` (el periodo como lo pide SUNAT). */
export function periodoDe(anioMes?: string): string {
  return String(anioMes ?? '').replace(/[^0-9]/g, '').slice(0, 6)
}

/** Una fecha ISO (o Date) → `DD/MM/AAAA` (como lo pide el registro). */
export function fechaRegistro(fecha?: string | Date): string {
  const d = fecha instanceof Date ? fecha : new Date(String(fecha ?? ''))
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

/** `1.234,56`? No: el registro va con punto decimal y sin separador de miles (`1234.56`). */
const monto = (n: number) => (Number(n) || 0).toFixed(2)

/**
 * **Las filas pipe-delimited del export**, con los nombres de campo del RCE en la cabecera (mismo estilo que
 * el export de ventas que ya tiene la pantalla). ⚠️ **No pretende ser el archivo plano oficial** con las
 * posiciones fijas de SUNAT —ese lo genera/valida el SIRE con su propuesta y el CAR lo asigna SUNAT—: es la
 * información de cada comprobante con **todos** los campos que el registro pide, para cargarla o revisarla.
 */
export function filasExportCompras(
  registro: RegistroCompras,
  empresa?: { ruc?: string; nombre?: string },
): string[] {
  return registro.filas.map((f) =>
    [
      periodoDe(String(f.fecha).slice(0, 10)),
      String(empresa?.ruc ?? '').replace(/\D/g, ''),
      String(empresa?.nombre ?? ''),
      f.car,
      fechaRegistro(f.fecha),
      f.tipoComprobante,
      f.serie,
      f.numero,
      f.tipoDocIdentidad,
      f.proveedorDocumento,
      f.proveedor,
      monto(f.baseConCredito),
      monto(f.igvConCredito),
      monto(f.baseSinCredito),
      monto(f.igvSinCredito),
      monto(f.noGravadas),
      '0.00',
      '0.00',
      monto(f.total),
      'PEN',
    ].join('|'),
  )
}

/** La cabecera del export (en el mismo orden que `filasExportCompras`). */
export const CABECERA_EXPORT_COMPRAS = [
  'Periodo',
  'RucGenerador',
  'RazonSocialGenerador',
  'CarSunat',
  'FechaEmision',
  'TipoComprobante',
  'SerieComprobante',
  'NumeroComprobante',
  'TipoDocIdentidadProveedor',
  'NumeroDocProveedor',
  'RazonSocialProveedor',
  'BaseImponibleGravadaConCredito',
  'IgvConCredito',
  'BaseImponibleGravadaSinCredito',
  'IgvSinCredito',
  'ValorAdquisicionesNoGravadas',
  'Isc',
  'OtrosTributos',
  'ImporteTotal',
  'Moneda',
].join('|')
