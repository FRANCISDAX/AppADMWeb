import { desglosarTurno, efectivoEsperadoDe, mediosDelTurno } from './arqueo.ts'
import { bolsillosDeVenta } from './pagos.ts'
import { redondear2 } from './dinero.ts'

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
  /** Vuelto pagado por transferencia: **sale** del cajón (fórmula única en `lib/arqueo.ts`). */
  vueltoTransferencia?: number
  ventasDelTurno: any[]
  efectivoReal: number
}): ResultadoAuditoria {
  const { totalGastosEfectivo, ventasDelTurno, efectivoReal } = opts
  const efectivoEsperado = efectivoEsperadoDe(opts)
  const diferencia = efectivoReal - efectivoEsperado

  const causas = detectarCausas(ventasDelTurno, totalGastosEfectivo, diferencia)
  const recomendaciones = generarRecomendaciones(causas, diferencia)

  return { efectivoEsperado, efectivoReal, diferencia, causas, recomendaciones }
}

function detectarCausas(ventasDelTurno: any[], totalGastosEfectivo: number, diferencia: number): Causa[] {
  const causas: Causa[] = []

  // Ventas con **parte en efectivo** (no `tipoPago === 'efectivo'`: una venta MIXTA
  // también deja efectivo en el cajón y antes se salteaba esta revisión).
  const ventasEfectivo = ventasDelTurno.filter(
    (v) => v.estado !== 'anulada' && bolsillosDeVenta({ tipoPago: v.tipoPago, pagos: v.pagos, total: v.total }).efectivo > 0
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

function generarRecomendaciones(causas: Causa[], diferencia: number): string[] {  const recs: string[] = []

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

/**
 * **Totales por rubro de las cajas cerradas** — para el seguimiento (Auditoría de caja).
 *
 * 🔑 **Por qué por rubro y no un solo número**: el efectivo **se cuenta** (esperado vs contado, y ahí duele la
 * diferencia) y las transferencias **no pasan por el cajón**: se cruzan contra la app/el banco, medio por medio
 * (Yape, Plin, tarjeta, transferencia). Mezclarlos en un total esconde justo lo que se quiere auditar.
 *
 * ⚠️ **Lo que no se inventa**: si un cierre no declaró la conciliación (es **opcional** desde el 16/09) o es
 * anterior al `medio` fino, el medio queda **sin conciliar** (`declarado: null`) en vez de un cero que parezca
 * «cuadra». Igual que en el arqueo: *Transferencia (sin detalle)*.
 */
export type CierreParaResumen = {
  montoInicial?: number
  totalVentas?: number
  totalEfectivo?: number
  totalTransferencia?: number
  totalGastos?: number
  totalGastosEfectivo?: number
  totalGastosTransferencia?: number
  efectivoEsperado?: number
  montoFinalEfectivo?: number
  diferencia?: number
  /** Los items del turno tal como los guarda el cierre (`ventas` en `tblCierresCaja`). */
  ventas?: readonly any[]
  /** Lo que el cajero declaró al cerrar, por billetera. */
  conciliacion?: Record<string, { sistema?: number; declarado?: number; diferencia?: number }>
}

export type RubroEfectivo = {
  cierres: number
  fondo: number
  ventas: number
  gastos: number
  esperado: number
  contado: number
  diferencia: number
  /** Cuántos cierres quedaron con diferencia (|diferencia| > 0.01). */
  conDiferencia: number
}

export type RubroMedio = {
  medio: string
  label: string
  icono: string
  /** Lo que el sistema dice que entró por ese medio. */
  sistema: number
  /** Lo declarado al cerrar (`null` = ningún cierre lo concilió ⇒ no hay contra qué comparar). */
  declarado: number | null
  /** `declarado − sistema` (solo si hay algo declarado). */
  diferencia: number | null
}

export type RubroTransferencia = {
  total: number
  gastos: number
  medios: RubroMedio[]
  /** ¿Algún cierre del período declaró la conciliación? */
  conciliado: boolean
}

export type ResumenPorRubro = {
  cierres: number
  efectivo: RubroEfectivo
  transferencia: RubroTransferencia
  ventas: { total: number; tickets: number }
}

/** El nombre y el ícono de cada billetera, en el orden en que se muestra. */
const MEDIOS: { medio: string; label: string; icono: string }[] = [
  { medio: 'yape', label: 'Yape', icono: '📲' },
  { medio: 'plin', label: 'Plin', icono: '💜' },
  { medio: 'tarjeta', label: 'Tarjeta', icono: '💳' },
  { medio: 'transferencia', label: 'Transferencia', icono: '🏦' },
]

export function resumenPorRubro(cierres: readonly CierreParaResumen[] | null | undefined): ResumenPorRubro {
  const lista = cierres ?? []
  const r: ResumenPorRubro = {
    cierres: lista.length,
    efectivo: { cierres: lista.length, fondo: 0, ventas: 0, gastos: 0, esperado: 0, contado: 0, diferencia: 0, conDiferencia: 0 },
    transferencia: { total: 0, gastos: 0, medios: [], conciliado: false },
    ventas: { total: 0, tickets: 0 },
  }
  const sistema = new Map<string, number>()
  const declarado = new Map<string, number>()
  let algunConciliado = false

  for (const c of lista) {
    r.efectivo.fondo += Number(c.montoInicial) || 0
    r.efectivo.ventas += Number(c.totalEfectivo) || 0
    r.efectivo.gastos += Number(c.totalGastosEfectivo) || 0
    r.efectivo.esperado += Number(c.efectivoEsperado) || 0
    r.efectivo.contado += Number(c.montoFinalEfectivo) || 0
    const dif = Number(c.diferencia) || 0
    r.efectivo.diferencia += dif
    if (Math.abs(dif) > 0.01) r.efectivo.conDiferencia += 1

    r.transferencia.total += Number(c.totalTransferencia) || 0
    r.transferencia.gastos += Number(c.totalGastosTransferencia) || 0
    r.ventas.total += Number(c.totalVentas) || 0
    r.ventas.tickets += Array.isArray(c.ventas) ? c.ventas.length : 0

    // 🔑 El sistema se **recalcula** de los items (la misma regla que el arqueo), así el rubro no depende de
    // que el turno haya guardado bien su `totalTransferencia`.
    for (const m of mediosDelTurno({ ventasDelTurno: c.ventas ?? [], totalEfectivo: c.totalEfectivo, totalTransferencia: c.totalTransferencia })) {
      if (m.medio === 'efectivo') continue
      sistema.set(m.medio, (sistema.get(m.medio) || 0) + (Number(m.monto) || 0))
    }
    // Lo declarado al cerrar (si lo declaró).
    for (const [clave, v] of Object.entries(c.conciliacion ?? {})) {
      const medio = String(clave || '').trim()
      const monto = Number(v?.declarado)
      if (!medio || !Number.isFinite(monto)) continue
      algunConciliado = true
      declarado.set(medio, (declarado.get(medio) || 0) + monto)
    }
  }

  // Los medios del orden conocido primero; cualquier otro que aparezca, al final (nunca se esconde).
  const conocidos = new Set(MEDIOS.map((m) => m.medio))
  const otros = [...new Set([...sistema.keys(), ...declarado.keys()])].filter((m) => !conocidos.has(m)).sort()
  const filas = [...MEDIOS.filter((m) => sistema.has(m.medio) || declarado.has(m.medio)), ...otros.map((medio) => ({ medio, label: medio, icono: '•' }))]
  r.transferencia.medios = filas.map((m) => {
    const sis = redondear2(sistema.get(m.medio) || 0)
    const dec = declarado.has(m.medio) ? redondear2(declarado.get(m.medio) || 0) : null
    return { ...m, sistema: sis, declarado: dec, diferencia: dec === null ? null : redondear2(dec - sis) }
  })
  r.transferencia.conciliado = algunConciliado

  r.efectivo.fondo = redondear2(r.efectivo.fondo)
  r.efectivo.ventas = redondear2(r.efectivo.ventas)
  r.efectivo.gastos = redondear2(r.efectivo.gastos)
  r.efectivo.esperado = redondear2(r.efectivo.esperado)
  r.efectivo.contado = redondear2(r.efectivo.contado)
  r.efectivo.diferencia = redondear2(r.efectivo.diferencia)
  r.transferencia.total = redondear2(r.transferencia.total)
  r.transferencia.gastos = redondear2(r.transferencia.gastos)
  r.ventas.total = redondear2(r.ventas.total)
  return r
}

/**
 * **De dónde salió el efectivo de un cierre** (ventas del día / cobranza de crédito / notas). Es lo que
 * permite explicar una diferencia sin adivinar: si la plata que falta es de una venta, de un cobro o de una
 * devolución.
 */
export function origenDelEfectivo(cierre: CierreParaResumen): { origen: string; label: string; monto: number }[] {
  const d = desglosarTurno({ ventasDelTurno: cierre.ventas ?? [], totalEfectivo: cierre.totalEfectivo, totalTransferencia: cierre.totalTransferencia })
  return [
    { origen: 'ventas', label: 'Ventas del día', monto: redondear2(d.efectivo.ventas) },
    { origen: 'cobranzas', label: 'Cobranza de crédito', monto: redondear2(d.efectivo.cobranzas) },
    { origen: 'notas', label: 'Notas (NC)', monto: redondear2(d.efectivo.notas) },
  ]
}

/** Faltante o sobrante: el signo de la diferencia, en palabras. */
export function signoDe(diferencia: number | null | undefined): 'cuadra' | 'faltante' | 'sobrante' {
  const d = Number(diferencia) || 0
  if (Math.abs(d) < 0.01) return 'cuadra'
  return d < 0 ? 'faltante' : 'sobrante'
}

/**
 * **Una pista concreta** sobre por qué un rubro no cuadra: qué se miró, cuánto y en qué documento.
 *
 * 🔑 **No es una lista genérica de consejos**: cada pista sale de **los datos del cierre** — una venta cuyo
 * importe coincide **exactamente** con la diferencia, dos ventas del mismo monto, montos redondos, anulaciones,
 * notas de crédito, cobros de crédito, gastos — o de un **cruce entre rubros** (lo que falta en Yape es lo que
 * sobra en efectivo). Es lo que permite deducir qué pasó en vez de adivinar.
 */
export type Pista = {
  /** Rubro donde se ve la diferencia (`efectivo` o el nombre del medio). */
  rubro: string
  signo: 'faltante' | 'sobrante'
  monto: number
  texto: string
  /** Documentos a revisar (serie-número), cuando la pista los identifica. */
  documentos: string[]
  /** `fuerte` = coincide al céntimo / cruza dos rubros; `media` = característica sospechosa. */
  fuerza: 'fuerte' | 'media'
}

/** El rótulo del documento de una venta del turno (nunca inventa: si no hay, usa el id). */
function docDe(v: any): string {
  return String(v?.serie_numero ?? v?.serieNumero ?? v?.id ?? '—')
}

function horaDe(v: any): string {
  const f = v?.hora || v?.fecha
  if (!f) return ''
  const d = new Date(f)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

function montoDe(v: any): number {
  return Math.abs(Number(v?.total ?? v?.monto ?? 0) || 0)
}

/**
 * Las pistas de un cierre **cerrado**: por cada rubro que no cuadra, qué podría explicarlo.
 * Devuelve `[]` cuando todo cuadra (o cuando la diferencia es menor a un céntimo).
 */
export function pistasDelCierre(cierre: CierreParaResumen, opts?: { tolerancia?: number }): Pista[] {
  const tol = opts?.tolerancia ?? 0.01
  const ventas = [...(cierre.ventas ?? [])]
  const pistas: Pista[] = []

  const difEfectivo = redondear2((Number(cierre.montoFinalEfectivo) || 0) - (Number(cierre.efectivoEsperado) || 0))
  const signoEfectivo = signoDe(difEfectivo)
  const montoDif = Math.abs(difEfectivo)

  /** ¿Hay un documento cuyo importe es exactamente la diferencia? (la pista más fuerte de todas) */
  const buscarImporte = (soloEfectivo = true) => {
    const candidatos = ventas.filter((v) => {
      if (soloEfectivo) {
        const b = bolsillosDeVenta({ tipoPago: v.tipoPago, pagos: v.pagos, total: v.total })
        if (b.efectivo <= 0) return false
      }
      return Math.abs(montoDe(v) - montoDif) < tol
    })
    return candidatos
  }

  if (signoEfectivo !== 'cuadra') {
    // 1) Un documento por el importe exacto de la diferencia.
    const exactos = buscarImporte()
    for (const v of exactos.slice(0, 3)) {
      const esAnulada = v.estado === 'anulada'
      const esNota = v.tipoDoc === 'NC' || v.tipo === 'nota_credito'
      const esCobro = v.tipo === 'cobro_credito'
      pistas.push({
        rubro: 'efectivo',
        signo: signoEfectivo,
        monto: montoDif,
        texto: esAnulada
          ? `Hay una venta **anulada** por exactamente ese importe: si se devolvió la plata del cajón, revisá si salió del turno (${horaDe(v) || 'sin hora'}).`
          : esNota
            ? `Hay una **nota de crédito** por exactamente ese importe: si se devolvió en efectivo, ese dinero salió del cajón (${horaDe(v) || 'sin hora'}).`
            : esCobro
              ? `Hay un **cobro de crédito** por exactamente ese importe (${horaDe(v) || 'sin hora'}).`
              : `La venta **${docDe(v)}** es por exactamente ese importe (${horaDe(v) || 'sin hora'}): es la primera a revisar.`,
        documentos: [docDe(v)],
        fuerza: 'fuerte',
      })
    }

    // 2) Montos redondos en efectivo: el clásico error de cambio.
    const redondos = ventas.filter((v) => {
      if (v.estado === 'anulada') return false
      const b = bolsillosDeVenta({ tipoPago: v.tipoPago, pagos: v.pagos, total: v.total })
      const total = montoDe(v)
      return b.efectivo > 0 && total >= 20 && total % 5 === 0
    })
    if (redondos.length > 0 && exactos.length === 0) {
      pistas.push({
        rubro: 'efectivo',
        signo: signoEfectivo,
        monto: montoDif,
        texto: `${redondos.length} venta(s) en efectivo con importe redondo: es donde suele estar el error de cambio.`,
        documentos: redondos.slice(0, 5).map(docDe),
        fuerza: 'media',
      })
    }

    // 3) Dos ventas con el mismo importe (doble cobro / se cobró dos veces la misma).
    const porMonto = new Map<number, any[]>()
    for (const v of ventas) {
      if (v.estado === 'anulada') continue
      const m = redondear2(montoDe(v))
      if (m <= 0) continue
      porMonto.set(m, [...(porMonto.get(m) ?? []), v])
    }
    for (const [m, lista] of porMonto) {
      if (lista.length < 2) continue
      if (signoEfectivo === 'sobrante' && Math.abs(m - montoDif) < tol) {
        pistas.push({
          rubro: 'efectivo',
          signo: 'sobrante',
          monto: montoDif,
          texto: `Hay ${lista.length} ventas por el mismo importe (S/ ${m.toFixed(2)}): puede ser un **cobro duplicado** registrado dos veces.`,
          documentos: lista.slice(0, 4).map(docDe),
          fuerza: 'fuerte',
        })
      }
    }

    // 4) Gastos del turno (salen del cajón; un gasto no registrado es un faltante típico).
    const gastos = Number(cierre.totalGastosEfectivo) || 0
    if (gastos > 0) {
      pistas.push({
        rubro: 'efectivo',
        signo: signoEfectivo,
        monto: gastos,
        texto: `En el turno se registraron **S/ ${gastos.toFixed(2)} de gastos en efectivo**: confirmá que cada uno salió del cajón y con comprobante.`,
        documentos: [],
        fuerza: 'media',
      })
    }

    // 5) El vuelto pagado por transferencia **sale del cajón**: si es alto y nadie lo tuvo en cuenta, explica un faltante.
    const vueltoTransf = redondear2((Number(cierre.montoInicial) || 0) + (Number(cierre.totalEfectivo) || 0) - gastos - (Number(cierre.efectivoEsperado) || 0))
    if (signoEfectivo === 'faltante' && vueltoTransf > 0) {
      pistas.push({
        rubro: 'efectivo',
        signo: 'faltante',
        monto: vueltoTransf,
        texto: `Se pagaron **S/ ${vueltoTransf.toFixed(2)} de vuelto con transferencia**: ese dinero salió del cajón y ya está descontado del esperado (si el cajero no lo recordaba, explica el faltante).`,
        documentos: [],
        fuerza: 'media',
      })
    }

    // 6) Sin nada específico: decir qué mirar y con qué número.
    if (pistas.length === 0) {
      pistas.push({
        rubro: 'efectivo',
        signo: signoEfectivo,
        monto: montoDif,
        texto: `${signoEfectivo === 'faltante' ? 'Falta' : 'Sobra'} efectivo y ningún documento coincide con ese importe: compará el conteo contra el esperado (S/ ${(Number(cierre.efectivoEsperado) || 0).toFixed(2)}) y revisá las ventas en efectivo una por una.`,
        documentos: ventas.filter((v) => v.estado !== 'anulada').slice(-3).map(docDe),
        fuerza: 'media',
      })
    }
  }

  // 7) Diferencias por MEDIO (Yape/Plin/tarjeta/transferencia): sistema vs lo declarado al cerrar.
  const sistema = new Map<string, number>()
  for (const m of mediosDelTurno({ ventasDelTurno: ventas, totalEfectivo: cierre.totalEfectivo, totalTransferencia: cierre.totalTransferencia })) {
    if (m.medio === 'efectivo') continue
    sistema.set(m.medio, (sistema.get(m.medio) || 0) + (Number(m.monto) || 0))
  }
  for (const [medio, v] of Object.entries(cierre.conciliacion ?? {})) {
    const declarado = Number(v?.declarado)
    if (!Number.isFinite(declarado)) continue
    const sis = redondear2(sistema.get(medio) || 0)
    const dif = redondear2(declarado - sis)
    if (Math.abs(dif) < tol) continue
    const signo = dif < 0 ? 'faltante' : 'sobrante'
    pistas.push({
      rubro: medio,
      signo,
      monto: Math.abs(dif),
      texto:
        signo === 'faltante'
          ? `El sistema registró **S/ ${sis.toFixed(2)}** por ${medio} y se declararon **S/ ${declarado.toFixed(2)}**: falta plata en ese medio (¿una venta cobrada por ${medio} sin su comprobante/aviso?, ¿o se cobró en efectivo?).`
          : `El sistema registró **S/ ${sis.toFixed(2)}** por ${medio} y se declararon **S/ ${declarado.toFixed(2)}**: entró más plata de la que el POS registró (¿una venta sin medio?, ¿un aviso de prueba que sí era real?).`,
      documentos: [],
      fuerza: 'media',
    })
    // 🔑 **Cruce entre rubros**: lo que falta en un medio es justo lo que sobra en el cajón (o al revés).
    if (signoEfectivo !== 'cuadra' && Math.abs(dif + difEfectivo) < tol) {
      pistas.push({
        rubro: 'cruce',
        signo,
        monto: Math.abs(dif),
        texto: `🔗 **Se cruzan**: hay ${signo === 'faltante' ? 'faltante' : 'sobrante'} de S/ ${Math.abs(dif).toFixed(2)} en ${medio} y ${signoEfectivo === 'faltante' ? 'faltante' : 'sobrante'} de S/ ${montoDif.toFixed(2)} en efectivo por el mismo importe. Lo más probable es que **la venta se cobró por un medio y se registró por el otro**.`,
        documentos: [],
        fuerza: 'fuerte',
      })
    }
  }

  return pistas
}
