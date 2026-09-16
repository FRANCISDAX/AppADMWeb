export type Diagnostico = {
  icono: string
  texto: string
  tipo: 'pista' | 'alerta' | 'ok'
}

/**
 * Genera diagnósticos inteligentes cuando hay diferencia entre efectivo contado y esperado.
 */
export function diagnosticarDiferencia(turno: {
  montoInicial: number
  totalEfectivo: number
  totalTransferencia: number
  totalGastosEfectivo: number
  efectivoEsperado: number
  efectivoContado: number
  comprobantes: { tipoPago: string; total: number; esCobro: boolean }[]
  gastosDelTurno: { monto: number; tipoPago: string }[]
}): Diagnostico[] {
  const diff = Math.round((turno.efectivoContado - turno.efectivoEsperado) * 100) / 100
  const diags: Diagnostico[] = []

  if (Math.abs(diff) < 0.01) {
    diags.push({ icono: '✅', texto: 'El efectivo cuadra perfecto. Sin diferencias.', tipo: 'ok' })
    return diags
  }

  const falta = diff < 0
  const montoFalta = Math.abs(diff)

  // 1. Buscar si la diferencia coincide con alguna venta individual
  const ventasEfectivo = turno.comprobantes.filter((c) => c.tipoPago === 'efectivo' && !c.esCobro)
  const ventaMatch = ventasEfectivo.find((v) => Math.abs(v.total - montoFalta) < 0.01)
  if (ventaMatch) {
    diags.push({
      icono: '🔍',
      texto: falta
        ? `Podría faltar el registro de la venta ${ventaMatch.total.toFixed(2)} (efectivo no contabilizado).`
        : `Podría haber un registro duplicado de la venta ${ventaMatch.total.toFixed(2)}.`,
      tipo: 'pista',
    })
  }

  // 2. Buscar si la diferencia coincide con una venta por transferencia (confusión de tipo)
  const ventasTransf = turno.comprobantes.filter((c) => c.tipoPago === 'transferencia' && !c.esCobro)
  const transfMatch = ventasTransf.find((v) => Math.abs(v.total - montoFalta) < 0.01)
  if (transfMatch && !ventaMatch) {
    diags.push({
      icono: '🔍',
      texto: falta
        ? `La diferencia (${montoFalta.toFixed(2)}) coincide con una venta por transferencia. ¿Se registró como efectivo?`
        : `La diferencia (${montoFalta.toFixed(2)}) coincide con una venta por transferencia. ¿Se contó de más?`,
      tipo: 'pista',
    })
  }

  // 3. Detectar confusión efectivo/transferencia general
  const totalVentas = ventasEfectivo.reduce((s, v) => s + v.total, 0) + ventasTransf.reduce((s, v) => s + v.total, 0)
  if (ventasTransf.length > 0 && Math.abs(diff) > 0 && Math.abs(diff) < totalVentas * 0.15) {
    const candidatas = ventasTransf.filter((v) => Math.abs(v.total - montoFalta) <= montoFalta * 0.1 || montoFalta <= v.total * 0.1)
    if (candidatas.length > 0 && !ventaMatch && !transfMatch) {
      diags.push({
        icono: '💡',
        texto: `Hay ${ventasTransf.length} venta(s) por transferencia (${fmtList(ventasTransf)}). Revise si alguna se confundió con efectivo.`,
        tipo: 'pista',
      })
    }
  }

  // 4. Gastos en efectivo vs efectivo disponible
  const gastosEfectivo = turno.gastosDelTurno.filter((g) => g.tipoPago === 'caja')
  const totalGastosReg = gastosEfectivo.reduce((s, g) => s + g.monto, 0)
  if (falta && totalGastosReg > 0) {
    const gastosNoRegistrados = montoFalta - totalGastosReg
    if (Math.abs(gastosNoRegistrados) < 0.5) {
      diags.push({
        icono: '🔍',
        texto: `El faltante (${montoFalta.toFixed(2)}) se aproxima a los gastos registrados (${totalGastosReg.toFixed(2)}). ¿Falta registrar un gasto?`,
        tipo: 'pista',
      })
    }
  }

  // 5. Cambio excesivo o vuelto no descontado
  if (falta && montoFalta <= 5 && montoFalta > 0) {
    diags.push({
      icono: '💡',
      texto: `El faltante es menor a S/ 5.00. Podría ser cambio olvidado o error de redondeo.`,
      tipo: 'pista',
    })
  }

  // 6. Sobra significativa
  if (!falta && montoFalta > 5) {
    diags.push({
      icono: '⚠️',
      texto: `Hay S/ ${montoFalta.toFixed(2)} de sobrante. Verifique si se registraron pagos de más o si el monto inicial estaba mal.`,
      tipo: 'alerta',
    })
  }

  // 7. Diferencia redonda (posible error de monto inicial)
  if (Math.abs(diff) >= 10 && Math.abs(diff) % 10 === 0) {
    diags.push({
      icono: '💡',
      texto: `La diferencia es exacta (S/ ${montoFalta.toFixed(2)}). Podría tratarse de un error en el monto inicial o un billete no contado.`,
      tipo: 'pista',
    })
  }

  // 8. Sin ventas en efectivo pero hay diferencia
  if (ventasEfectivo.length === 0 && falta) {
    diags.push({
      icono: '⚠️',
      texto: `No hay ventas registradas en efectivo, pero falta S/ ${montoFalta.toFixed(2)}. Verifique el monto inicial.`,
      tipo: 'alerta',
    })
  }

  // 9. Diferencia = monto inicial
  if (Math.abs(diff - turno.montoInicial) < 0.01 && turno.montoInicial > 0) {
    diags.push({
      icono: '⚠️',
      texto: `La diferencia coincide con el monto inicial (${fmt(turno.montoInicial)}). Parece que no se contabilizaron las ventas en efectivo.`,
      tipo: 'alerta',
    })
  }

  // Si no se generó ninguna pista específica
  if (diags.length === 0) {
    diags.push({
      icono: '🔍',
      texto: falta
        ? `Falta S/ ${montoFalta.toFixed(2)}. Revise las ventas en efectivo y los gastos registrados.`
        : `Sobra S/ ${montoFalta.toFixed(2)}. Verifique los montos recibidos.`,
      tipo: 'pista',
    })
  }

  return diags
}

function fmt(n: number) {
  return 'S/ ' + n.toFixed(2)
}

function fmtList(items: { total: number }[]) {
  if (items.length <= 3) return items.map((v) => fmt(v.total)).join(', ')
  return `${items.length} ventas (${items.slice(0, 2).map((v) => fmt(v.total)).join(', ')}…)`
}
