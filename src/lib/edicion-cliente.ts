/**
 * **Cambiarle el cliente a una nota de venta** — módulo puro (sin Firebase ni React).
 *
 * 🔑 **El caso real** (decisión del usuario, 09/10/2026): el cliente compra sin dar su nombre y, con la
 * nota ya emitida, pide *«esa nota pero con mi nombre»*. La nota de venta **no es comprobante de pago** y
 * **no se declara a SUNAT**, así que corregirle el cliente es un dato **operativo**, no fiscal.
 *
 * ⚠️ **La consolidación NO usa el cliente de la nota**: la boleta consolidada del día declara el receptor
 * de la configuración (`nombreClienteConsolidado`/`documentoClienteConsolidado`, `lib/consolidado.ts`), no
 * el de cada NV. Por eso editar el cliente **no cambia** lo que se declara… mientras la nota **no se haya
 * consolidado**. Una vez consolidada, el importe ya entró a un comprobante declarado con el receptor
 * genérico: se corrige con nota de crédito, **no** editando (ver `revisionEdicionCliente`).
 *
 * ⚠️ **Lo que esta función NO resuelve**: si el cliente necesita el nombre para **sustentar un gasto o
 * crédito fiscal**, la nota de venta no le sirve aunque diga su nombre — para eso hace falta **boleta**
 * (con DNI) o **factura** (con RUC).
 */

/** Lo que hace falta saber de un documento para decidir si su cliente se puede editar. */
export type DocumentoConCliente = {
  tipoDoc?: string | null
  estado?: string | null
  /** El bloque `sunat`; `consolidado: true` cuando la NV ya entró a la boleta del día. */
  sunat?: { consolidado?: boolean | null } | null
  venta?: { tipoPago?: string | null } | null
}

export type RevisionEdicionCliente = {
  /** `true` si se puede abrir el formulario y guardar. */
  permitido: boolean
  /** Por qué **no** se puede (o `null`). */
  motivo: string | null
  /** Aviso que hay que mostrar aunque se pueda (o `null`). Ej.: la nota está a crédito. */
  aviso: string | null
}

/**
 * **¿Se le puede cambiar el cliente a este documento?** Es la regla única: la usan la pantalla (para
 * mostrar el botón) y el servicio (para rechazar el guardado) — así no pueden contradecirse.
 */
export function revisionEdicionCliente(doc: DocumentoConCliente | null | undefined): RevisionEdicionCliente {
  if (!doc) return { permitido: false, motivo: 'No se encontró el documento.', aviso: null }
  if (String(doc.tipoDoc ?? '') !== 'NV') {
    return { permitido: false, motivo: 'Solo se le puede cambiar el cliente a una nota de venta.', aviso: null }
  }
  if (String(doc.estado ?? '') === 'anulada') {
    return { permitido: false, motivo: 'La nota de venta está anulada: no se puede editar.', aviso: null }
  }
  if (doc.sunat?.consolidado) {
    return {
      permitido: false,
      motivo:
        'Esta nota ya entró a la boleta consolidada del día: su importe ya está declarado. Se corrige con nota de crédito, no editando el cliente.',
      aviso: null,
    }
  }
  const aviso =
    String(doc.venta?.tipoPago ?? '') === 'credito'
      ? 'Esta nota está a crédito: al cambiar el cliente, la deuda pasa a la cuenta del nuevo documento.'
      : null
  return { permitido: true, motivo: null, aviso }
}

/**
 * **Validación del documento de identidad** de una nota de venta. Vacío **es válido** (consumidor final:
 * se guarda `'-'`), 8 dígitos es DNI y 11 es RUC. Un RUC exige razón social: sin nombre, el papel no sirve
 * para nada.
 */
export function revisionDocumentoCliente(
  documento: string | null | undefined,
  nombre: string | null | undefined,
): { valido: boolean; motivo: string | null } {
  const doc = String(documento ?? '').trim()
  if (doc === '' || doc === '-') return { valido: true, motivo: null }
  if (!/^\d+$/.test(doc)) return { valido: false, motivo: 'El documento solo lleva números (DNI de 8 o RUC de 11).' }
  if (doc.length !== 8 && doc.length !== 11) return { valido: false, motivo: 'Poné un DNI de 8 dígitos o un RUC de 11.' }
  if (doc.length === 11 && String(nombre ?? '').trim() === '') {
    return { valido: false, motivo: 'Con RUC hace falta la razón social del cliente.' }
  }
  return { valido: true, motivo: null }
}

/** El cliente tal como se guarda en la venta (el vacío va como `'-'`, igual que al emitir). */
export function clienteParaGuardar({
  nombre,
  documento,
  direccion,
  telefono,
}: {
  nombre: string | null | undefined
  documento: string | null | undefined
  direccion?: string | null
  telefono?: string | null
}): { cliente_nombre: string; cliente_dni: string; cliente_direccion: string; cliente_telefono: string } {
  const limpio = (v: string | null | undefined) => String(v ?? '').trim()
  return {
    cliente_nombre: limpio(nombre) || 'CLIENTE',
    cliente_dni: limpio(documento) || '-',
    cliente_direccion: limpio(direccion),
    cliente_telefono: limpio(telefono),
  }
}
