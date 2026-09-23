import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  COLUMNAS_AVISOS_YAPE,
  RESERVA_YAPE_MINUTOS,
  VIGENCIA_YAPE_MINUTOS_POR_DEFECTO,
  YAPE_USADO_RECIENTE_MINUTOS,
  aplicarYapeEnVenta,
  avisoYapeActivo,
  avisosDelMismoMonto,
  coincideConTotal,
  codigoDeSeguridadYape,
  confirmarAntesDeAplicar,
  conteoAvisosYape,
  detalleDeAviso,
  estaDisponible,
  etiquetaYape,
  fechaDeYape,
  filasDeAvisosYape,
  filtrarAvisosYape,
  haceCuantoYape,
  horaDeYape,
  minutosRestantesYape,
  msDeFechaYape,
  operacionDePagoYape,
  pagosYapeDeTurno,
  pagosYapeVisibles,
  resumenHistorialYape,
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

test('«hace cuánto» se lee en segundos cuando es reciente, y después en minutos y horas', () => {
  // 🔑 Los segundos importan: con varias cajas abiertas, «hace 12 s» es lo que deja reconocer
  // cuál de los avisos es el del cliente que está delante.
  assert.equal(haceCuantoYape(AHORA - 20 * 1000, AHORA), 'hace 20 s')
  assert.equal(haceCuantoYape(AHORA - 3 * MIN, AHORA), 'hace 3 min')
  assert.equal(haceCuantoYape(AHORA - 75 * MIN, AHORA), 'hace 1 h 15 min')
})

test('la hora del yapeo se muestra con segundos', () => {
  // Se compara contra la hora local de la propia fecha, sin fijar zona horaria (el test corre
  // en cualquier máquina): lo que importa es el formato HH:MM:SS.
  const fecha = Date.parse('2026-09-21T22:10:07.000Z')
  const d = new Date(fecha)
  const dos = (n: number) => String(n).padStart(2, '0')
  assert.equal(horaDeYape(fecha), `${dos(d.getHours())}:${dos(d.getMinutes())}:07`)
})

// ─── Varias cajas a la vez (la misma lista para todos) ──────────────────────

test('se detectan los avisos disponibles por el mismo monto (y solo esos)', () => {
  const mio = aviso({ id: 'mio', monto: 10 })
  const pagos = [
    mio,
    aviso({ id: 'igual-disponible', monto: 10, fecha: AHORA - 2 * MIN }),
    aviso({ id: 'igual-reservado', monto: 10, estado: 'reservado', reservadoEn: AHORA - MIN }),
    aviso({ id: 'igual-usado', monto: 10, estado: 'usado', usadoEn: AHORA - MIN }),
    aviso({ id: 'igual-vencido', monto: 10, fecha: AHORA - 60 * MIN }),
    aviso({ id: 'otro-monto', monto: 25 }),
  ]
  const repetidos = avisosDelMismoMonto(mio, pagos, op).map((p) => p.id)
  assert.deepEqual(repetidos, ['igual-disponible'])
})

test('un aviso sin monto no arrastra a los demás', () => {
  const mio = aviso({ id: 'mio', monto: 0 })
  assert.deepEqual(avisosDelMismoMonto(mio, [aviso({ id: 'otro', monto: 0 })], op), [])
})

test('un aviso que NO coincide con el total pide confirmación; el que coincide, no', () => {
  assert.equal(confirmarAntesDeAplicar(aviso({ monto: 10 }), 10), false)
  assert.equal(confirmarAntesDeAplicar(aviso({ monto: 10 }), 7.5), true)
  assert.equal(confirmarAntesDeAplicar(aviso({ monto: 30 }), 10), true)
  // Sin venta armada no hay nada que confirmar: el botón ya está deshabilitado (`aplicarYapeEnVenta`).
  assert.equal(confirmarAntesDeAplicar(aviso({ monto: 10 }), 0), true)
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

// ─── Historial (Reportes → Yape) ────────────────────────────────────────────

/** Un aviso de cada tipo, como los que quedan en la colección después de unos días. */
const historial = (): PagoYape[] => [
  aviso({ id: 'hoy-libre', monto: 25, nroOperacion: '1001', pagadorNombre: 'Rosa Diaz*', fecha: AHORA - 2 * MIN }),
  aviso({ id: 'ayer-usado', monto: 12, nroOperacion: '1002', pagadorNombre: 'Carlos Mena*', fecha: AHORA - 25 * 60 * MIN, estado: 'usado', usadoEn: AHORA - 24 * 60 * MIN, usadoPor: 'Ana', documento: '2026-9_BOLETA-B001-000123', codigoSeguridad: '159' }),
  aviso({ id: 'ayer-ignorado', monto: 8.5, nroOperacion: '1003', pagadorNombre: 'Luis Quispe*', fecha: AHORA - 26 * 60 * MIN, estado: 'ignorado', ignoradoPor: 'Luis', motivoIgnorado: 'era de otra tienda' }),
  aviso({ id: 'viejo-vencido', monto: 30, nroOperacion: '1004', pagadorNombre: 'Marta Sosa*', fecha: AHORA - 3 * 24 * 60 * MIN }),
  aviso({ id: 'anulado-x', monto: 40, nroOperacion: '1005', pagadorNombre: 'Pedro Ruiz*', fecha: AHORA - 4 * 24 * 60 * MIN, estado: 'anulado', usadoEn: AHORA - 4 * 24 * 60 * MIN }),
  aviso({ id: 'raro', monto: 5, nroOperacion: '1006', pagadorNombre: 'Sofia Leon*', fecha: AHORA - 5 * 24 * 60 * MIN, estado: 'pendiente' }),
  aviso({ id: 'prueba-1', monto: 0.1, nroOperacion: '1007', pagadorNombre: 'PRUEBA DEL SISTEMA', fecha: AHORA - 3 * MIN, origen: 'prueba' }),
]

test('el historial filtra por SITUACIÓN (no por el estado guardado) y ordena lo más nuevo primero', () => {
  const pagos = historial()
  // «Vencido» no es un estado guardado (se deriva): si el filtro leyera `estado` a mano, un
  // aviso viejo sin usar no se podría ni buscar. Y `anulado` sí es un estado: tiene que salir.
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'usado', opciones: op }).map((p) => p.id), ['ayer-usado'])
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'vencido', opciones: op }).map((p) => p.id), ['viejo-vencido'])
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'anulado', opciones: op }).map((p) => p.id), ['anulado-x'])
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'ignorado', opciones: op }).map((p) => p.id), ['ayer-ignorado'])
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'desconocido', opciones: op }).map((p) => p.id), ['raro'])
  // Sin filtro, todo y lo más nuevo primero (el historial se lee de arriba hacia abajo).
  const todos = filtrarAvisosYape(pagos, { opciones: op })
  assert.equal(todos.length, 7)
  assert.equal(todos[0].id, 'hoy-libre')
  assert.equal(todos[todos.length - 1].id, 'raro')
})

test('el buscador del historial encuentra por pagador, N° de operación, comprobante, monto y motivo', () => {
  const pagos = historial()
  const ids = (texto: string) => filtrarAvisosYape(pagos, { texto, opciones: op }).map((p) => p.id)
  assert.deepEqual(ids('rosa'), ['hoy-libre'])
  assert.deepEqual(ids('1002'), ['ayer-usado'])
  assert.deepEqual(ids('B001-000123'), ['ayer-usado'])
  // 🔑 Buscar por monto: cuando el cliente reclama dice «yapeé 8.50», no el número de operación.
  assert.deepEqual(ids('8.50'), ['ayer-ignorado'])
  assert.deepEqual(ids('otra tienda'), ['ayer-ignorado'])
  // Quién lo usó también es buscable (es la pregunta «¿quién cobró con este aviso?»).
  assert.deepEqual(ids('ana'), ['ayer-usado'])
  // El filtro y el buscador se combinan (uno acota al otro).
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'usado', texto: 'quispe', opciones: op }), [])
  assert.deepEqual(filtrarAvisosYape(pagos, { estado: 'ignorado', texto: 'quispe', opciones: op }).map((p) => p.id), ['ayer-ignorado'])
})

test('el conteo del filtro cuenta cada situación y distingue los estados que no se entienden', () => {
  const c = conteoAvisosYape(historial(), op)
  assert.equal(c.todos, 7)
  assert.equal(c.disponible, 2) // el de hoy y el de prueba (los dos están dentro de la vigencia)
  assert.equal(c.usado, 1)
  assert.equal(c.ignorado, 1)
  assert.equal(c.anulado, 1)
  assert.equal(c.vencido, 1)
  assert.equal(c.desconocido, 1)
})

test('el resumen del historial separa lo cobrado con aviso, lo que no se usó y los de PRUEBA', () => {
  const r = resumenHistorialYape(historial(), op)
  assert.equal(r.cantidad, 7)
  // `total` no incluye el aviso de prueba (0.10): un aviso de prueba NO es plata que entró.
  assert.equal(r.total, 25 + 12 + 8.5 + 30 + 40 + 5)
  assert.equal(r.cobrado, 12)
  // Sin usar = ignorado (8.50) + anulado (40) + vencido (30): los tres que no llegaron a una venta.
  assert.equal(r.sinUsar, 3)
  assert.equal(r.montoSinUsar, 78.5)
  assert.equal(r.pruebas, 1)
  assert.equal(r.montoPruebas, 0.1)
  assert.equal(r.desconocidos, 1)
})

test('un aviso de PRUEBA se ve en el historial pero no infla lo cobrado', () => {
  // Es la misma regla del panel del PDV y del cierre: si el aviso de prueba sumara, el reporte
  // diría que entró plata que nunca entró.
  const pagos = [aviso({ id: 'p', monto: 100, origen: 'prueba', estado: 'usado', usadoEn: AHORA - MIN })]
  const r = resumenHistorialYape(pagos, op)
  assert.equal(r.cobrado, 0)
  assert.equal(r.total, 0)
  assert.equal(r.pruebas, 1)
  assert.equal(r.montoPruebas, 100)
  // Y sigue apareciendo en la lista, marcado como PRUEBA.
  const fila = filasDeAvisosYape(pagos, op)[0]
  assert.equal(fila[6], 'Usado (PRUEBA)')
  assert.equal(fila[7], 'PRUEBA')
})

test('la fecha y la hora del historial se leen por separado (un rango cruza varios días)', () => {
  // Se leen en hora **local**, igual que el resto de la app: `fechaDeYape` da el día y
  // `horaDeYape` la hora con segundos (en el panel del PDV alcanza con la hora; en un rango de
  // varios días, no saber de qué jornada es el aviso lo vuelve inútil).
  const ms = Date.parse('2026-09-21T22:10:03.000Z')
  const d = new Date(ms)
  const dos = (n: number) => String(n).padStart(2, '0')
  assert.equal(fechaDeYape(ms), `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`)
  assert.equal(horaDeYape(ms), `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`)
  assert.match(fechaDeYape(ms), /^\d{2}\/\d{2}\/\d{4}$/)
  // Sin fecha válida no se inventa una fecha de 1970 en pantalla: se muestra el epoch, que se ve raro.
  assert.equal(fechaDeYape(Number.NaN), fechaDeYape(0))
})

test('el detalle dice por qué un aviso no llegó a una venta', () => {
  assert.equal(detalleDeAviso(aviso({ estado: 'ignorado', motivoIgnorado: 'era de otra tienda' })), 'era de otra tienda')
  assert.equal(detalleDeAviso(aviso({ estado: 'anulado' })), 'la venta se anuló: la plata volvió al cliente')
  assert.equal(detalleDeAviso(aviso({ estado: 'reservado', reservadoEn: AHORA - MIN, reservadoPor: 'Ana' }), op), 'en uso por Ana')
  assert.equal(detalleDeAviso(aviso({ estado: 'pendiente' }), op), 'estado «pendiente»')
  assert.equal(detalleDeAviso(aviso({ estado: 'usado' }), op), '')
})

test('la fecha de un aviso se lee venga como venga (el puente es otro proceso)', () => {
  // 🔑 Si esto fallara, TODOS los avisos parecerían vencidos: una fecha que no se entiende da NaN, y
  // `ahora - NaN` no es «hace poco», es «nunca». Lo usan los avisos y el latido del puente.
  const d = new Date('2026-09-22T22:00:00.000Z')
  assert.equal(msDeFechaYape(d.getTime()), d.getTime())
  assert.equal(msDeFechaYape(d), d.getTime())
  assert.equal(msDeFechaYape(d.toISOString()), d.getTime())
  assert.equal(msDeFechaYape({ toMillis: () => 123 }), 123, 'Timestamp de Firestore')
  assert.equal(msDeFechaYape({ seconds: 1700000000 }), 1700000000000)
  assert.equal(msDeFechaYape(null), 0)
  assert.equal(msDeFechaYape(undefined), 0)
  assert.equal(msDeFechaYape('ni idea'), 0)
  assert.equal(msDeFechaYape(Number.NaN), 0)
})

test('las filas del historial tienen el mismo largo que los encabezados (si no, el Excel se corre)', () => {
  const filas = filasDeAvisosYape(historial(), op)
  assert.equal(filas.length, 7)
  for (const f of filas) assert.equal(f.length, COLUMNAS_AVISOS_YAPE.length)
  const usada = filas.find((f) => f[4] === '1002' && f[6] === 'Usado')
  assert.ok(usada)
  assert.equal(usada[5], '159', 'el código de seguridad va en su columna (es lo que se coteja con el cliente)')
  assert.equal(usada[8], 'Ana')
  assert.equal(usada[9], '2026-9_BOLETA-B001-000123')
  // Ninguna celda puede quedar `undefined`: ExcelJS lo escribiría como una celda vacía rara.
  for (const f of filas) for (const c of f) assert.notEqual(c, undefined)
})

test('el código de seguridad se muestra y se coteja: es lo único que distingue dos avisos sin N° de operación', () => {
  // Los avisos reales de Yape NO traen N° de operación (verificado en el celular): el código que el
  // cliente ve en su pantalla es el dato que permite confirmar que el aviso es del que está delante.
  const conCodigo = aviso({ codigoSeguridad: '159', nroOperacion: '' })
  assert.equal(codigoDeSeguridadYape(conCodigo), '159')
  assert.equal(codigoDeSeguridadYape(aviso({ codigoSeguridad: '  159  ' })), '159')
  assert.equal(codigoDeSeguridadYape(aviso()), '', 'sin código no se inventa uno')
  assert.equal(codigoDeSeguridadYape(aviso({ codigoSeguridad: undefined })), '')
  // Y viaja en la etiqueta de una línea (la usan el panel, el cierre y las confirmaciones).
  assert.equal(etiquetaYape(conCodigo), 'S/ 25.00 · Johan Rey* · cód. 159')
})
