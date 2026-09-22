import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  RESERVA_YAPE_MINUTOS,
  VIGENCIA_YAPE_MINUTOS_POR_DEFECTO,
  YAPE_USADO_RECIENTE_MINUTOS,
  aplicarYapeEnVenta,
  avisoYapeActivo,
  coincideConTotal,
  estaDisponible,
  etiquetaYape,
  haceCuantoYape,
  minutosRestantesYape,
  operacionDePagoYape,
  pagosYapeDeTurno,
  pagosYapeVisibles,
  resumenYape,
  situacionPagoYape,
  sonidoYapeActivo,
  totalYape,
  vigenciaYapeMinutos,
  type PagoYape,
} from './yape.ts'

// 🔑 Avisos de Yape (21/09/2026): el aviso que llega del celular del negocio tiene que
// aparecer en el PDV. Estas son las reglas de cuándo sirve, cuándo venció y cuánto se le
// puede aplicar a la venta. **Un aviso dice un monto, no una venta**: el cruce real es el
// cierre (avisos confirmados contra los cobros por Yape del turno).

const AHORA = Date.parse('2026-09-21T22:10:00.000Z')
const MIN = 60000

/** Aviso base: disponible, recién llegado. Cada test cambia solo lo que le importa. */
const aviso = (extra: Partial<PagoYape> = {}): PagoYape => ({
  id: 'yape-1',
  monto: 25,
  nroOperacion: '34153064',
  pagadorNombre: 'Johan Rey*',
  fecha: AHORA - MIN,
  estado: 'disponible',
  ...extra,
})

const op = { ahora: AHORA }

// ─── Configuración ──────────────────────────────────────────────────────────

test('sin configurar, los avisos se muestran y suenan (una config vieja no rompe nada)', () => {
  assert.equal(avisoYapeActivo(undefined), true)
  assert.equal(avisoYapeActivo({}), true)
  assert.equal(sonidoYapeActivo(undefined), true)
  assert.equal(vigenciaYapeMinutos(undefined), VIGENCIA_YAPE_MINUTOS_POR_DEFECTO)
})

test('se pueden apagar el aviso y el sonido, y cambiar la vigencia', () => {
  assert.equal(avisoYapeActivo({ yapeAvisoActivo: false }), false)
  assert.equal(sonidoYapeActivo({ yapeSonido: false }), false)
  assert.equal(vigenciaYapeMinutos({ yapeVigenciaMinutos: 3 }), 3)
})

test('una vigencia en 0 o basura NO deja los avisos sin validez: vuelve al valor por defecto', () => {
  // ⚠️ Si 0 significara "vigencia 0", ningún aviso serviría nunca y el panel quedaría vacío
  // sin explicación. La convención de 0 = sin tope es de `descuentoMaximoPorcentaje` y
  // `limiteCredito`, no de acá: acá 0 es un valor sin sentido y se ignora.
  assert.equal(vigenciaYapeMinutos({ yapeVigenciaMinutos: 0 }), VIGENCIA_YAPE_MINUTOS_POR_DEFECTO)
  assert.equal(vigenciaYapeMinutos({ yapeVigenciaMinutos: -5 }), VIGENCIA_YAPE_MINUTOS_POR_DEFECTO)
  assert.equal(vigenciaYapeMinutos({ yapeVigenciaMinutos: Number.NaN }), VIGENCIA_YAPE_MINUTOS_POR_DEFECTO)
})

// ─── Vigencia ───────────────────────────────────────────────────────────────

test('un aviso recién llegado está disponible; pasada la vigencia queda vencido', () => {
  assert.equal(situacionPagoYape(aviso({ fecha: AHORA - 9 * MIN }), op), 'disponible')
  assert.equal(situacionPagoYape(aviso({ fecha: AHORA - 11 * MIN }), op), 'vencido')
  // El borde: a los 10 minutos exactos ya venció (no se estira).
  assert.equal(situacionPagoYape(aviso({ fecha: AHORA - 10 * MIN }), op), 'vencido')
})

test('la vigencia es la configurada, no la de por defecto', () => {
  const p = aviso({ fecha: AHORA - 4 * MIN })
  assert.equal(situacionPagoYape(p, { ahora: AHORA, vigenciaMin: 20 }), 'disponible')
  assert.equal(situacionPagoYape(p, { ahora: AHORA, vigenciaMin: 2 }), 'vencido')
})

test('la reserva vence sola: un navegador que se cerró a mitad del cobro no deja el aviso tomado', () => {
  const reservado = aviso({
    estado: 'reservado',
    reservadoPor: 'Ana',
    reservadoEn: AHORA - 1 * MIN,
  })
  assert.equal(situacionPagoYape(reservado, op), 'reservado')
  // Pasada la reserva vuelve a estar disponible para cualquiera (y el aviso sigue vigente).
  const viejo = aviso({ estado: 'reservado', reservadoPor: 'Ana', reservadoEn: AHORA - (RESERVA_YAPE_MINUTOS + 1) * MIN })
  assert.equal(situacionPagoYape(viejo, op), 'disponible')
  assert.equal(estaDisponible(viejo, op), true)
})

test('una reserva sin fecha no deja el aviso tomado para siempre', () => {
  // ⚠️ Sin `reservadoEn` no hay forma de saber si la reserva está viva; darla por vencida es
  // mejor que dejar un aviso bloqueado por una reserva que nadie va a soltar.
  const sinFecha = aviso({ estado: 'reservado', reservadoPor: 'Ana' })
  assert.equal(situacionPagoYape(sinFecha, op), 'disponible')
})

test('usado, ignorado y anulado mandan sobre la vigencia (un aviso usado no revive)', () => {
  assert.equal(situacionPagoYape(aviso({ estado: 'usado', fecha: AHORA - 60 * MIN }), op), 'usado')
  assert.equal(situacionPagoYape(aviso({ estado: 'ignorado' }), op), 'ignorado')
  assert.equal(situacionPagoYape(aviso({ estado: 'anulado' }), op), 'anulado')
})

test('un aviso sin estado se lee como disponible, pero uno desconocido NO se ofrece', () => {
  // Un aviso recién llegado sin `estado` es lo natural (el puente todavía no lo tocó).
  assert.equal(situacionPagoYape(aviso({ estado: '' }), op), 'disponible')
  assert.equal(situacionPagoYape(aviso({ estado: undefined as unknown as string }), op), 'disponible')
  // 🛡️ Un estado que la app no entiende se marca: es un puente mal escrito, y tiene que
  // notarse (el panel y el cierre lo dicen) en vez de mostrar avisos que no se entienden.
  assert.equal(situacionPagoYape(aviso({ estado: 'pendiente' }), op), 'desconocido')
})

test('«vence en N min» cuenta desde la fecha del yapeo y nunca da negativo', () => {
  assert.equal(minutosRestantesYape(aviso({ fecha: AHORA - MIN }), op), 9)
  assert.equal(minutosRestantesYape(aviso({ fecha: AHORA - 60 * MIN }), op), 0)
})

test('«hace cuánto» se lee en minutos y después en horas', () => {
  assert.equal(haceCuantoYape(AHORA - 20 * 1000, AHORA), 'hace menos de 1 min')
  assert.equal(haceCuantoYape(AHORA - 3 * MIN, AHORA), 'hace 3 min')
  assert.equal(haceCuantoYape(AHORA - 75 * MIN, AHORA), 'hace 1 h 15 min')
})

// ─── La lista del panel ─────────────────────────────────────────────────────

test('la lista muestra disponibles, reservados y usados recientes; esconde vencidos e ignorados', () => {
  const pagos = [
    aviso({ id: 'usado-hoy', estado: 'usado', usadoEn: AHORA - 2 * MIN }),
    aviso({ id: 'vencido', fecha: AHORA - 60 * MIN }),
    aviso({ id: 'ignorado', estado: 'ignorado' }),
    aviso({ id: 'reservado', estado: 'reservado', reservadoEn: AHORA - MIN }),
    aviso({ id: 'libre', fecha: AHORA - 2 * MIN }),
    aviso({ id: 'usado-viejo', estado: 'usado', usadoEn: AHORA - (YAPE_USADO_RECIENTE_MINUTOS + 1) * MIN }),
    aviso({ id: 'raro', estado: 'pendiente' }),
  ]
  const ids = pagosYapeVisibles(pagos, op).map((p) => p.id)
  assert.deepEqual(ids, ['libre', 'reservado', 'usado-hoy'])
})

test('el orden es: primero lo usable, después lo que está en uso, y lo más nuevo arriba', () => {
  const pagos = [
    aviso({ id: 'reservado', estado: 'reservado', reservadoEn: AHORA - MIN, fecha: AHORA - 5 * MIN }),
    aviso({ id: 'libre-viejo', fecha: AHORA - 8 * MIN }),
    aviso({ id: 'libre-nuevo', fecha: AHORA - 1 * MIN }),
  ]
  assert.deepEqual(pagosYapeVisibles(pagos, op).map((p) => p.id), ['libre-nuevo', 'libre-viejo', 'reservado'])
})

test('el resumen cuenta cada situación y suma solo lo disponible', () => {
  const pagos = [
    aviso({ id: 'a', monto: 25 }),
    aviso({ id: 'b', monto: 10, fecha: AHORA - 2 * MIN }),
    aviso({ id: 'c', estado: 'reservado', reservadoEn: AHORA - MIN }),
    aviso({ id: 'd', estado: 'usado', usadoEn: AHORA - MIN }),
    aviso({ id: 'e', estado: 'ignorado' }),
    aviso({ id: 'f', fecha: AHORA - 60 * MIN }),
    aviso({ id: 'g', estado: 'pendiente' }),
  ]
  const r = resumenYape(pagos, op)
  assert.equal(r.disponibles, 2)
  assert.equal(r.reservados, 1)
  assert.equal(r.usados, 1)
  assert.equal(r.ignorados, 1)
  assert.equal(r.vencidos, 1)
  assert.equal(r.desconocidos, 1)
  assert.equal(r.montoDisponible, 35)
})

// ─── Aplicar un aviso a la venta ────────────────────────────────────────────

test('un aviso que coincide con el total se destaca (es el caso normal: el cliente yapeó justo)', () => {
  assert.equal(coincideConTotal(aviso({ monto: 25 }), 25), true)
  assert.equal(coincideConTotal(aviso({ monto: 25.0 }), 25.0), true)
  assert.equal(coincideConTotal(aviso({ monto: 25 }), 24), false)
  // ⚠️ Sin venta armada (total 0) no hay nada que destacar, y un aviso de S/ 0 tampoco.
  assert.equal(coincideConTotal(aviso({ monto: 25 }), 0), false)
  assert.equal(coincideConTotal(aviso({ monto: 0 }), 0), false)
})

test('sin carrito el aviso no se puede aplicar (y se dice por qué)', () => {
  const r = aplicarYapeEnVenta(aviso(), 0)
  assert.equal(r.ok, false)
  assert.match(r.motivo ?? '', /Agregá productos/)
})

test('un aviso por MÁS que la venta se aplica topeado y se avisa: Yape no da vuelto', () => {
  // 📌 Caso real: el cliente yapea S/ 30 por una venta de S/ 25 (se equivocó o redondeó).
  // Los medios electrónicos no pueden superar el total (`lib/pagos.ts`), así que se aplican
  // 25 y el resto queda **a favor del cliente en su celular**, no en el cajón.
  const r = aplicarYapeEnVenta(aviso({ monto: 30 }), 25)
  assert.equal(r.ok, true)
  assert.equal(r.monto, 25)
  assert.match(r.aviso ?? '', /quedan a favor del cliente/)
  assert.match(r.aviso ?? '', /S\/ 5\.00/)
})

test('un aviso por menos que la venta se aplica por su monto (el resto se cobra aparte)', () => {
  const r = aplicarYapeEnVenta(aviso({ monto: 10 }), 25)
  assert.equal(r.ok, true)
  assert.equal(r.monto, 10)
  assert.equal(r.aviso, undefined)
})

test('un aviso sin monto no se aplica: hay que revisar el puente', () => {
  const r = aplicarYapeEnVenta(aviso({ monto: 0 }), 25)
  assert.equal(r.ok, false)
  assert.match(r.motivo ?? '', /no tiene monto/)
})

test('el pago de la venta guarda el N° de operación del aviso (y si falta, el id del aviso)', () => {
  assert.equal(operacionDePagoYape(aviso()), '34153064')
  assert.equal(operacionDePagoYape(aviso({ nroOperacion: '   ' })), 'yape-1')
})

test('la etiqueta de una línea aguanta un aviso sin nombre ni número', () => {
  assert.equal(etiquetaYape(aviso()), 'S/ 25.00 · Johan Rey* · op. 34153064')
  assert.equal(etiquetaYape(aviso({ pagadorNombre: '', nroOperacion: '' })), 'S/ 25.00')
})

// ─── Cruce del cierre ───────────────────────────────────────────────────────

test('el cruce del turno cuenta solo los avisos confirmados dentro del turno', () => {
  // Se filtra por `usadoEn` (cuándo se aplicó a la venta) para que el aviso caiga en el turno
  // que lo cobró, igual que la venta — no por `fecha` (cuándo yapeó el cliente).
  const pagos = [
    aviso({ id: 'en-turno', estado: 'usado', usadoEn: AHORA - 5 * MIN, monto: 25 }),
    aviso({ id: 'otro-turno', estado: 'usado', usadoEn: AHORA - 10 * 60 * MIN, monto: 99 }),
    aviso({ id: 'disponible', monto: 50 }),
    aviso({ id: 'raro-con-usadoEn', estado: 'pendiente', usadoEn: AHORA - MIN, monto: 40 }),
  ]
  const delTurno = pagosYapeDeTurno(pagos, { desde: AHORA - 60 * MIN, hasta: AHORA })
  assert.deepEqual(delTurno.map((p) => p.id), ['en-turno'])
  assert.equal(totalYape(delTurno), 25)
})

test('un aviso anulado por la anulación de la venta NO cuenta como cobro confirmado', () => {
  // Si se anula la venta, la plata se le devuelve al cliente: el aviso deja de ser un cobro.
  const pagos = [aviso({ id: 'anulado', estado: 'anulado', usadoEn: AHORA - 5 * MIN, monto: 25 })]
  assert.deepEqual(pagosYapeDeTurno(pagos, { desde: AHORA - 60 * MIN }), [])
})
