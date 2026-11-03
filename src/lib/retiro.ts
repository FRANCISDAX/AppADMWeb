/**
 * **Cortesía / retiro gratuito** — el módulo puro (sin Firebase ni React).
 *
 * 🔑 **Qué es**: sacar mercadería **sin cobrarla** (un regalo a un cliente, uso propio del negocio, una
 * muestra). Tributariamente **no es una venta con descuento del 100%**: para el IGV **es una venta**
 * (retiro de bienes, Ley del IGV art. 3, con la base fijada por el valor de las operaciones onerosas,
 * art. 14) y se documenta con un **comprobante de pago con la leyenda «Transferencia Gratuita»** y el
 * **valor de venta referencial** (Reglamento de Comprobantes de Pago, art. 8).
 *
 * 🔑 **Cómo se declara (decisión del usuario, 08/10/2026): la línea va como OPERACIÓN ONEROSA con la
 * afectación del propio bien** (`'10'` si el bien es gravado, `'20'` si es exonerado, `'30'` si es
 * inafecto) y el comprobante lleva el **valor referencial como importe**. La gratuidad la dicen la
 * **leyenda** y el valor referencial, no el código de afectación. Por qué: (a) el IGV que se paga se
 * calcula igual —art. 14 manda usar tu precio de venta— y así queda declarado en la **misma casilla que
 * las ventas**, al céntimo, sin depender de cómo el backend arme las operaciones gratuitas; (b) los
 * códigos de retiro del catálogo 07 (`'11'` premio, `'12'` donación, `'14'` publicidad, `'15'` muestras
 * médicas…) describen **una causa concreta** y ninguna calza con «le regalé una gaseosa a un cliente»;
 * (c) no hay que tocar el backend. ⚠️ **En un bien exonerado (el catálogo de esta región) no hay IGV que
 * pagar**: la misma regla sirve para los dos casos.
 *
 * ⚠️ **La NOTA DE VENTA no sirve para esto**: no es comprobante de pago (no acredita nada al receptor) y,
 * además, las NV del día se **consolidan** en una boleta diaria ⇒ un retiro metido como NV se declararía
 * como venta del día, sin leyenda y sin valor referencial. Por eso acá solo se permiten **BOLETA y
 * FACTURA**.
 *
 * ⚠️ **La caja no se mueve**: un retiro no tiene forma de pago ⇒ **no entra a ningún bolsillo**, no toca
 * el esperado ni la diferencia del arqueo (ver `lib/arqueo.ts`). Lo que se mueve es el **stock** (sale con
 * un movimiento propio `retiro`, valorizado) y el **valor referencial** queda en el documento como su
 * importe (que es lo que el contador declara: la venta existe para el IGV aunque nadie la pague).
 */

import { redondear2 } from './dinero.ts'

/** Los motivos que el usuario puede elegir. Cada uno trae **su leyenda** para el comprobante. */
export type MotivoRetiro = 'cortesia' | 'consumo' | 'muestra'

/**
 * 🔑 **Las DOS clases de operación** (SUNAT las trata como cosas distintas y el negocio también las quiere
 * separadas en los números):
 * - **`'cliente'`**: la mercadería **sale hacia un tercero** (cortesía/regalo, muestra) ⇒ *transferencia
 *   gratuita*. El código del catálogo 07 para la versión exonerada es `'21'`.
 * - **`'propio'`**: el propio negocio **se queda con el bien** (lo consume, lo usa) ⇒ *retiro de bienes*
 *   (Ley del IGV art. 3: el retiro es la operación gravada). Catálogo 07: `'13'` gravado / `'32'` inafecto.
 *
 * ⚠️ Bajo la opción A (decisión del usuario) las dos se declaran **igual** —línea onerosa con la afectación
 * del bien y la leyenda—, así que la clase **no cambia ningún importe ni el XML**: sirve para **reportar**
 * («cuánto regalé» contra «cuánto consumí yo») y para que el contador decida si algún día va la opción B.
 */
export type ClaseRetiro = 'cliente' | 'propio'

/** La clase, con su rótulo. Una sola implementación para las pantallas y los reportes. */
export type Clase = {
  id: ClaseRetiro
  /** El nombre corto de la clase (encabezado de tarjeta, columna). */
  label: string
  /** Para qué es, en una línea. */
  detalle: string
}

/** Las dos clases, en el orden en que se muestran. */
export const CLASES_RETIRO: readonly Clase[] = [
  { id: 'cliente', label: 'Transferencia gratuita', detalle: 'mercadería que se le regala a un cliente' },
  { id: 'propio', label: 'Retiro de bienes', detalle: 'mercadería que se queda el negocio para su uso' },
]

export type Motivo = {
  id: MotivoRetiro
  /** Lo que se elige en la pantalla. */
  label: string
  /** Lo que sale impreso en el comprobante (leyenda), exigido por el art. 8 del RCP. */
  leyenda: string
  /** A cuál de las dos clases de operación pertenece (ver `ClaseRetiro`). */
  clase: ClaseRetiro
}

/**
 * Los motivos de fábrica. La **leyenda** es lo único que distingue un retiro de una venta en el papel: el
 * comprobante no lleva código de operación gratuita (ver la cabecera del módulo).
 */
export const MOTIVOS_RETIRO: readonly Motivo[] = [
  { id: 'cortesia', label: 'Cortesía / regalo a un cliente', leyenda: 'Transferencia gratuita', clase: 'cliente' },
  { id: 'consumo', label: 'Uso propio del negocio', leyenda: 'Retiro para uso propio', clase: 'propio' },
  // Una muestra también **sale hacia un tercero**: se declara como transferencia gratuita, no como retiro.
  { id: 'muestra', label: 'Muestra', leyenda: 'Muestra', clase: 'cliente' },
]

/** **Los únicos comprobantes que valen para un retiro**: boleta (consumidor final) o factura (con RUC). */
export const TIPOS_COMPROBANTE_RETIRO = ['BOLETA', 'FACTURA'] as const
export type TipoComprobanteRetiro = (typeof TIPOS_COMPROBANTE_RETIRO)[number]

/** ¿Ese comprobante puede documentar un retiro? (la NV **no**: no es comprobante de pago). */
export function comprobanteValidoParaRetiro(tipoDoc: string | null | undefined): boolean {
  return (TIPOS_COMPROBANTE_RETIRO as readonly string[]).includes(String(tipoDoc ?? ''))
}

/**
 * **Qué comprobante sugiere el documento del receptor**: un **RUC** (11 dígitos) ⇒ Factura; cualquier otra
 * cosa (un DNI de 8, o nada) ⇒ Boleta. Es la misma regla con la que el PDV elige Boleta/Factura al tipear el
 * documento, en un solo lugar, para que el retiro **no vuelva a preguntar** lo que ya se cargó en la venta.
 */
export function comprobanteSugeridoParaRetiro(documento: string | null | undefined): TipoComprobanteRetiro {
  return String(documento ?? '').trim().length === 11 ? 'FACTURA' : 'BOLETA'
}

/**
 * **El documento del receptor de un retiro, validado y normalizado** (`doc: ''` = consumidor final).
 *
 * 🔑 Solo se aceptan **8 (DNI) o 11 (RUC) dígitos**, o nada. No es capricho: el backend (`appadm-sunat`,
 * Pydantic `ClienteIn`) exige `num_doc` de **8 a 11** caracteres y **rechaza el envío** si no llega; y un
 * comprobante que ya tiene número **no se puede corregir**, así que un DNI a medio tipear dejaría el retiro
 * **sin poder mandarse nunca** (el único documento que no se arregla con una nota de crédito).
 */
export function documentoDelReceptor(
  tipoDoc: string | null | undefined,
  documento: string | null | undefined,
): { ok: boolean; doc: string; error?: string } {
  const esFactura = String(tipoDoc ?? '') === 'FACTURA'
  const faltante = esFactura
    ? 'La Factura del retiro necesita el RUC (11 dígitos) del receptor.'
    : ''
  const limpio = String(documento ?? '').trim()
  if (!limpio || limpio === '-') return esFactura ? { ok: false, doc: '', error: faltante } : { ok: true, doc: '' }
  if (!/^\d+$/.test(limpio)) return { ok: false, doc: '', error: 'El documento del receptor tiene que ser solo números.' }
  if (limpio.length === 11) return { ok: true, doc: limpio }
  if (esFactura) return { ok: false, doc: '', error: faltante }
  if (limpio.length === 8) return { ok: true, doc: limpio }
  return { ok: false, doc: '', error: 'El DNI son 8 dígitos (o el RUC, 11). Dejalo vacío para consumidor final.' }
}

/** El motivo pedido, o `null` si no es uno de los válidos (nunca inventa uno). */
export function motivoDe(id: string | null | undefined): Motivo | null {
  return MOTIVOS_RETIRO.find((m) => m.id === id) ?? null
}

/** **La clase de operación de un motivo** (`null` si el id no es válido: nunca se inventa una clase). */
export function claseDeMotivo(id: string | null | undefined): ClaseRetiro | null {
  return motivoDe(id)?.clase ?? null
}

/** La clase con su rótulo (`null` si no se conoce). */
export function claseInfo(id: ClaseRetiro | null | undefined): Clase | null {
  return CLASES_RETIRO.find((c) => c.id === id) ?? null
}

/** El rótulo corto de una clase (`''` si no se conoce), para encabezados y columnas. */
export function etiquetaDeClase(id: ClaseRetiro | null | undefined): string {
  return claseInfo(id)?.label ?? ''
}

/**
 * **La afectación de la línea de un retiro: el código del catálogo 07 que le corresponde.**
 *
 * 🔑 **Tabla de SUNAT** (catálogo 07 «Tipo de afectación del IGV», con su tributo):
 * | operación | exonerado | inafecto | gravado |
 * |---|---|---|---|
 * | **transferencia gratuita** (a un cliente) | **`21`** | **`37`** | `15` (bonificaciones) |
 * | **retiro de bienes** (uso propio) | — | **`32`** | `13` |
 * Todos los códigos gratuitos van con el tributo **`9996` (GRATUITO)** y sin IGV.
 *
 * ⚠️ **No existe un «Exonerado – Retiro»**: para un bien **exonerado** (todo el catálogo de esta región)
 * el retiro propio se declara **`32` (Inafecto – Retiro)**, que es el único código de retiro que aplica; el
 * efecto es que ese documento cae en la columna **inafecta** del Registro de Ventas. `21` lo dejaría en
 * exonerada: si el contador lo prefiere así, se cambia **esta línea**.
 *
 * ⚠️ **Un bien GRAVADO se queda como operación onerosa (`'10'`)**: el catálogo no tiene un «gravado –
 * transferencia gratuita» genérico y declararlo `15`/`13` **perdería el IGV** que el art. 14 manda pagar
 * sobre el valor referencial. En este catálogo no hay bienes gravados; queda anotado para cuando los haya.
 *
 * ⚠️ El motivo **tiene que ser válido**: se valida acá para que un id inventado no termine guardado en un
 * documento que después hay que declarar.
 */
export function afectacionDelRetiro(motivoId: string | null | undefined, afectacionDelBien: string | null | undefined): string {
  const m = motivoDe(motivoId)
  if (!m) throw new Error(`Motivo de retiro inválido: ${String(motivoId)}`)
  const af = String(afectacionDelBien ?? '').trim()
  // Solo la afectación '10' es gravada (misma regla que `esGravado`, `lib/sunat-importes.ts`).
  if (af === '10') return '10'
  const esInafecto = af.startsWith('3')
  if (m.clase === 'cliente') return esInafecto ? '37' : '21'
  return '32'
}

/** Los ítems de un retiro, en lo mínimo que hace falta para valorarlo. */
export type ItemRetiro = {
  id?: string | null
  nombre?: string | null
  /** Precio final al público de **una unidad base** (lo que se habría cobrado). */
  precioVenta?: number | null
  /** Cantidad en unidades base. */
  cantidad?: number | null
  tipoAfectacion?: string | null
}

/**
 * **El valor referencial del retiro**: lo que la mercadería **habría costado** al precio de hoy. Es lo que
 * el comprobante tiene que anotar (art. 8 del RCP) y lo que el contador usa para el IGV de un retiro
 * gravado. ⚠️ **No es el total a cobrar**: el cliente no paga nada.
 */
export function valorReferencialDe(items: readonly ItemRetiro[] | null | undefined): number {
  let total = 0
  for (const it of items ?? []) {
    const precio = Number(it?.precioVenta) || 0
    const cantidad = Number(it?.cantidad) || 0
    if (precio <= 0 || cantidad <= 0) continue
    total += precio * cantidad
  }
  return Math.round(total * 100) / 100
}

/** ¿Este documento es un retiro? (no es una venta: `esDocumentoDeVenta` tiene que decir que no). */
export function esRetiro(doc: unknown): boolean {
  return String((doc as { tipoDoc?: unknown } | null | undefined)?.tipoDoc ?? '') === 'RETIRO'
}

/** El tipo de documento con el que se guarda un retiro en `tblDocumentos`. */
export const TIPO_DOC_RETIRO = 'RETIRO'

/**
 * **El comprobante REAL de un documento**: en un retiro es la boleta o la factura que se emitió (nunca
 * `'RETIRO'`, que es el tipo interno para no contarlo como venta). Lo usan los dos PDF, el XML y el
 * Registro de Ventas: una sola regla para que el papel, lo que se manda y lo que se declara coincidan.
 */
export function comprobanteDeDocumento(tipoDoc: string | null | undefined, comprobante: string | null | undefined): string {
  if (tipoDoc !== TIPO_DOC_RETIRO) return String(tipoDoc ?? '')
  return comprobante === 'FACTURA' ? 'FACTURA' : 'BOLETA'
}

/**
 * **La leyenda que va impresa** en el comprobante de un retiro (`''` si el documento no lo es). El art. 8
 * del Reglamento de Comprobantes la exige: es lo único que distingue un retiro de una venta cobrada.
 */
export function leyendaDeRetiro(venta: { motivoRetiro?: { leyenda?: string } | null } | null | undefined): string {
  return String(venta?.motivoRetiro?.leyenda ?? '').trim()
}

/** Lo mínimo de un documento para saber su clase (los reportes ya tienen el resto). */
export type DocConMotivo = {
  tipoDoc?: string | null
  venta?: { motivoRetiro?: { id?: string | null } | null } | null
}

/**
 * **La clase de operación de un documento ya guardado** (`null` si no es un retiro o si el motivo no se
 * reconoce: un documento viejo no se adivina). Es la lectura de `venta.motivoRetiro.id`, la única fuente.
 */
export function claseDeDocumento(doc: DocConMotivo | null | undefined): ClaseRetiro | null {
  if (!esRetiro(doc)) return null
  return claseDeMotivo(doc?.venta?.motivoRetiro?.id)
}

/** Un total agrupado por clase de operación. */
export type ResumenRetiro = {
  /** La clase (o `null` si los documentos son retiros sin motivo reconocible). */
  clase: ClaseRetiro | null
  /** El rótulo de la clase (`Retiros sin motivo` cuando no se reconoce). */
  etiqueta: string
  /** Para qué es, en una línea. */
  detalle: string
  cantidad: number
  /** El importe declarado por esos documentos (el valor referencial, ya con el signo del documento). */
  total: number
}

/**
 * **Cuánto se retiró de cada clase** — «transferencia gratuita a un cliente» contra «retiro de bienes
 * propio». Es lo que el dueño y el contador quieren ver separado, y el dato sale del motivo que ya está
 * guardado en el documento (no de una columna nueva ni de una migración).
 *
 * ⚠️ No cambia **ningún importe**: las dos clases se declaran igual (opción A). Solo agrupa.
 */
export function resumenRetiros(docs: readonly (DocConMotivo & { total?: number | null })[] | null | undefined): ResumenRetiro[] {
  const acumulado = new Map<ClaseRetiro | null, { cantidad: number; total: number }>()
  for (const d of docs ?? []) {
    if (!esRetiro(d)) continue
    const clase = claseDeDocumento(d)
    const prev = acumulado.get(clase) ?? { cantidad: 0, total: 0 }
    acumulado.set(clase, {
      cantidad: prev.cantidad + 1,
      total: redondear2(prev.total + (Number(d?.total) || 0)),
    })
  }
  const filas: ResumenRetiro[] = []
  for (const c of CLASES_RETIRO) {
    const a = acumulado.get(c.id)
    if (a) filas.push({ clase: c.id, etiqueta: c.label, detalle: c.detalle, ...a })
  }
  const sinClase = acumulado.get(null)
  if (sinClase) {
    filas.push({
      clase: null,
      etiqueta: 'Retiros sin motivo',
      detalle: 'documentos sin el motivo guardado (no se adivina la clase)',
      ...sinClase,
    })
  }
  return filas
}

/**
 * **El texto que se imprime** en el comprobante de un retiro: la leyenda + el valor referencial + el
 * aviso de que no se cobró. Una sola implementación para la pantalla, el ticket y el reporte.
 */
export function textoRetiro({ leyenda, valorReferencial }: { leyenda: string; valorReferencial: number }): string {
  return `**${leyenda}** — no se cobra. Valor referencial: S/ ${(Number(valorReferencial) || 0).toFixed(2)}`
}

/**
 * 🔑 **La leyenda que se DECLARA en el XML** (art. 8 del Reglamento de Comprobantes): texto plano, en
 * mayúsculas y sin markdown, porque va dentro de un `<cbc:Note>` y es lo único que dice, en el
 * comprobante electrónico, que la mercadería **no se cobró**. El PDF ya la imprime; sin esto, el XML que
 * guarda SUNAT sería indistinguible del de una venta normal.
 *
 * Ejemplo: `TRANSFERENCIA GRATUITA - NO SE COBRA. Valor referencial: S/ 12.00`.
 */
export function leyendaParaSunat(
  venta:
    | { motivoRetiro?: { leyenda?: string } | null; valorReferencial?: number | null; total?: number | null }
    | null
    | undefined,
): string {
  // Sin motivo guardado se cae a la leyenda genérica: nunca se manda una nota vacía.
  const leyenda = (leyendaDeRetiro(venta) || 'Transferencia gratuita').toUpperCase()
  const valor = Number(venta?.valorReferencial ?? venta?.total ?? 0)
  return `${leyenda} - NO SE COBRA. Valor referencial: S/ ${(Number.isFinite(valor) ? valor : 0).toFixed(2)}`
}
