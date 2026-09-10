export type TipoCausa = 'error_cambio' | 'pago_no_registrado' | 'gasto_no_registrado' | 'diferencia_conteo' | 'otro'

export type Causa = {
  tipo: TipoCausa
  descripcion: string
  ventaId?: string
  monto?: number
  hora?: string
}

export type ResultadoAuditoria = {
  efectivoEsperado: number
  efectivoReal: number
  diferencia: number
  causas: Causa[]
  recomendaciones: string[]
}

export function analizarCierre(opts: {
  montoInicial: number
  totalEfectivo: number
  totalGastosEfectivo: number
  ventasDelTurno: any[]
  efectivoReal: number
}): ResultadoAuditoria {
  const { montoInicial, totalEfectivo, totalGastosEfectivo, ventasDelTurno, efectivoReal } = opts

  const efectivoEsperado = montoInicial + totalEfectivo - totalGastosEfectivo
  const diferencia = efectivoReal - efectivoEsperado

  const causas = detectarCausas(ventasDelTurno, totalGastosEfectivo, diferencia)
  const recomendaciones = generarRecomendaciones(causas, diferencia)

  return { efectivoEsperado, efectivoReal, diferencia, causas, recomendaciones }
}

function detectarCausas(ventasDelTurno: any[], totalGastosEfectivo: number, diferencia: number): Causa[] {
  const causas: Causa[] = []

  const ventasEfectivo = ventasDelTurno.filter(
    (v) => v.tipoPago === 'efectivo' && v.estado !== 'anulada'
  )

  for (const v of ventasEfectivo) {
    const total = v.total ?? 0
    if (total > 50 && total % 5 === 0) {
      causas.push({
        tipo: 'error_cambio',
        descripcion: `Venta ${v.serie_numero || v.serieNumero || ''} (S/ ${total.toFixed(2)}) — posible error de cambio`,
        ventaId: v.id,
        monto: total,
        hora: v.hora || v.fecha,
      })
    }
  }

  if (totalGastosEfectivo > 0) {
    const gastos = ventasDelTurno.filter((v) => v.tipoDoc === 'gasto' || v.esGasto)
    if (gastos.length === 0) {
      causas.push({
        tipo: 'gasto_no_registrado',
        descripcion: `Hay S/ ${totalGastosEfectivo.toFixed(2)} en gastos de efectivo sin detalle registrado`,
      })
    }
  }

  if (Math.abs(diferencia) > 10 && causas.length === 0) {
    causas.push({
      tipo: 'diferencia_conteo',
      descripcion: 'Diferencia no explicada — revisar movimientos manualmente',
    })
  }

  return causas
}

function generarRecomendaciones(causas: Causa[], diferencia: number): string[] {
  const recs: string[] = []

  if (diferencia < -20) {
    recs.push('Revisar cámaras de seguridad')
    recs.push('Verificar ventas de efectivo en el turno')
  }

  if (diferencia > 10) {
    recs.push('Verificar si algún pago digital se registró como efectivo')
  }

  const causasCambio = causas.filter((c) => c.tipo === 'error_cambio')
  if (causasCambio.length > 0) {
    recs.push(`Revisar vuelto de ${causasCambio.length} venta(s) con montos redondos`)
  }

  const causasGasto = causas.filter((c) => c.tipo === 'gasto_no_registrado')
  if (causasGasto.length > 0) {
    recs.push('Registrar todos los gastos en efectivo con comprobante')
  }

  if (recs.length === 0) {
    recs.push('Diferencia menor — probable error de conteo')
  }

  return recs
}
