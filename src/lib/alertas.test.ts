/**
 * Alertas proactivas: que el sistema diga **lo que ya está mal** sin que nadie tenga que ir a
 * buscarlo.
 *
 * 🔑 **Lo que estos tests protegen** (24/09/2026):
 *
 * - **Que no grite de más**: un turno abierto es *información* (es la caja trabajando), no una
 *   alerta; un aviso de Yape sin usar es *aviso* y no *crítico*, porque el Yape del negocio también
 *   recibe pagos que no son de una venta. Una alarma que suena siempre se deja de mirar.
 * - **Que no se calle lo grave**: el puente caído (la plata entró y el PDV no lo sabe), el turno de
 *   otro día sin cerrar, el producto agotado.
 * - **El `0` apaga, no rompe**: cada umbral en `0` deja la regla apagada; y una config guardada
 *   **antes** de esta función (sin los campos) sigue evaluando las reglas útiles.
 * - **El id estable**: es lo que hace que «posponer» sirva de algo (si el id cambiara con cada
 *   venta, la alerta volvería en la recarga siguiente).
 */
import { strict as assert } from 'node:assert'
import { test, describe } from 'node:test'
import {
  ALERTA_DIFERENCIA_CAJA_POR_DEFECTO,
  ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO,
  ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO,
  alertaAnulaciones,
  alertaDescuentos,
  alertaDiferenciaCaja,
  alertaPuente,
  alertaTurnoAbierto,
  alertasStock,
  alertasVisibles,
  alertasYape,
  contarPendientes,
  evaluarAlertas,
  listarNombres,
  resumenAlertas,
  umbralesAlertas,
  type ContextoAlertas,
  type DocumentoAlerta,
  type ProductoAlerta,
  type TurnoAlerta,
} from './alertas.ts'
import type { LatidoPuenteYape } from './puente.ts'
import type { PagoYape } from './yape.ts'

/**
 * ⚠️ «Ahora» se arma con la **hora local** (`new Date(año, mes, día, …)`), no con un ISO en UTC: las
 * reglas de «turno de otro día» y las horas que se muestran son **locales**, así que un ISO fijo
 * haría que el test dependa de la zona horaria de la máquina que lo corre.
 */
const AHORA = new Date(2026, 8, 24, 22, 10, 0, 0).getTime()
const MIN = 60000
const HORA = 3600000

const latido = (extra: Partial<LatidoPuenteYape> = {}): LatidoPuenteYape => ({
  ultimoLatido: AHORA - MIN,
  dispositivo: 'Xiaomi Redmi Note 12',
  version: 5,
  ...extra,
})

const pago = (extra: Partial<PagoYape> = {}): PagoYape => ({
  id: 'nd_1',
  monto: 10,
  nroOperacion: '',
  codigoSeguridad: '159',
  pagadorNombre: 'Alesska Pin*',
  fecha: AHORA - MIN,
  estado: 'disponible',
  ...extra,
})

const turno = (extra: Partial<TurnoAlerta> = {}): TurnoAlerta => ({
  id: 't1',
  usuarioNombre: 'Ana Cajera',
  estado: 'abierto',
  fechaApertura: new Date(AHORA - HORA).toISOString(),
  ...extra,
})

const doc = (extra: Partial<DocumentoAlerta> = {}): DocumentoAlerta => ({
  id: 'd1',
  tipoDoc: 'NV',
  serieNumero: 'NV01-000123',
  estado: 'emitida',
  cajero: 'Ana Cajera',
  venta: { total: 100, importe_total: 100 },
  ...extra,
})

const producto = (extra: Partial<ProductoAlerta> = {}): ProductoAlerta => ({
  id: 'p1',
  nombre: 'Harina 1kg',
  stock: 10,
  minStock: 0,
  ...extra,
})

// ─── Puente ─────────────────────────────────────────────────────────────────

describe('el puente de Yape: lo que la caja NO puede ver', () => {
  test('un puente que late no genera ninguna alerta', () => {
    assert.equal(alertaPuente({ latido: latido() }, AHORA), null)
  })

  test('caído es crítico y dice hace cuánto; demorado es aviso (dos ciclos pueden ser un bache)', () => {
    const caido = alertaPuente({ latido: latido({ ultimoLatido: AHORA - 45 * MIN }) }, AHORA)
    assert.equal(caido?.severidad, 'critico')
    assert.match(caido?.titulo ?? '', /45 min/)
    const demorado = alertaPuente({ latido: latido({ ultimoLatido: AHORA - 15 * MIN }) }, AHORA)
    assert.equal(demorado?.severidad, 'aviso')
  })

  test('sin datos NO es lo mismo que caído: el arreglo es otro y el texto lo dice', () => {
    const sinDatos = alertaPuente({ latido: null }, AHORA)
    assert.equal(sinDatos?.severidad, 'critico')
    assert.match(sinDatos?.titulo ?? '', /nunca dio señales/)
    // El texto sale de `lib/puente.ts`: las dos pantallas tienen que decir lo mismo.
    assert.match(sinDatos?.detalle ?? '', /todavía no dio ninguna señal/)
  })

  test('con los avisos de Yape apagados, el puente no es noticia', () => {
    assert.equal(alertaPuente({ latido: null, config: { yapeAvisoActivo: false } }, AHORA), null)
  })
})

// ─── Turnos ─────────────────────────────────────────────────────────────────

describe('turnos abiertos: informar no es alarmar', () => {
  test('un turno abierto de hoy es INFORMACIÓN, no una alerta pendiente', () => {
    const a = alertaTurnoAbierto({ turnosAbiertos: [turno()] }, AHORA)
    assert.equal(a?.severidad, 'info')
    assert.match(a?.detalle ?? '', /Ana Cajera/)
    assert.equal(contarPendientes([a!]), 0)
  })

  test('un turno de OTRO día sin cerrar es crítico: esa plata nunca se rindió', () => {
    const a = alertaTurnoAbierto(
      { turnosAbiertos: [turno({ fechaApertura: new Date(AHORA - 30 * HORA).toISOString() })] },
      AHORA,
    )
    assert.equal(a?.severidad, 'critico')
    assert.match(a?.titulo ?? '', /otro día/)
  })

  test('el umbral de horas se respeta, y en 0 la regla queda apagada', () => {
    // 13 h antes de las 22:10 locales: todavía es el mismo día (si no, la regla «de otro día» gana).
    const t = turno({ fechaApertura: new Date(AHORA - 13 * HORA).toISOString() })
    // Con el umbral por defecto (12) avisa…
    assert.equal(alertaTurnoAbierto({ turnosAbiertos: [t] }, AHORA)?.severidad, 'aviso')
    assert.ok(ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO <= 13)
    // …y apagada, un turno de hoy vuelve a ser información (no un aviso).
    assert.equal(alertaTurnoAbierto({ turnosAbiertos: [t], config: { alertaTurnoAbiertoHoras: 0 } }, AHORA)?.severidad, 'info')
  })

  test('sin turnos abiertos no hay nada que decir', () => {
    assert.equal(alertaTurnoAbierto({ turnosAbiertos: [] }, AHORA), null)
  })
})

// ─── Stock ──────────────────────────────────────────────────────────────────

describe('stock: agotado es venta perdida, bajo el mínimo es un aviso', () => {
  const productos = [
    producto({ id: 'p1', nombre: 'Harina 1kg', stock: 0 }),
    producto({ id: 'p2', nombre: 'Aceite 1L', stock: 2, minStock: 5 }),
    producto({ id: 'p3', nombre: 'Arroz 5kg', stock: 80, minStock: 0 }),
    producto({ id: 'p4', nombre: 'Descontinuado', stock: 0, activo: false }),
  ]

  test('separa agotados (crítico) de bajos (aviso) y no cuenta lo inactivo', () => {
    const alertas = alertasStock({ productos })
    const agotado = alertas.find((a) => a.regla === 'stock-agotado')
    const bajo = alertas.find((a) => a.regla === 'stock-bajo')
    assert.equal(agotado?.severidad, 'critico')
    assert.match(agotado?.titulo ?? '', /^1 producto/)
    assert.match(agotado?.detalle ?? '', /Harina 1kg/)
    assert.doesNotMatch(agotado?.detalle ?? '', /Descontinuado/)
    assert.equal(bajo?.severidad, 'aviso')
    assert.match(bajo?.detalle ?? '', /Aceite 1L/)
    // El que tiene stock y `minStock` en 0 no aparece en ninguna: no se inventa un mínimo.
    assert.doesNotMatch(bajo?.detalle ?? '', /Arroz/)
  })

  test('`alertaStockBajo: false` apaga las dos', () => {
    assert.deepEqual(alertasStock({ productos, config: { alertaStockBajo: false } }), [])
  })
})

// ─── Yape ───────────────────────────────────────────────────────────────────

describe('avisos de Yape sin usar', () => {
  test('un aviso vencido y sin usar avisa; uno recién llegado no', () => {
    const viejo = pago({ id: 'a', fecha: AHORA - 30 * MIN })
    const nuevo = pago({ id: 'b', monto: 5, fecha: AHORA - 2 * MIN })
    const alertas = alertasYape({ avisosYape: [viejo, nuevo] }, AHORA)
    const sinUsar = alertas.find((a) => a.regla === 'yape-sin-usar')
    assert.ok(sinUsar, 'el aviso vencido tiene que aparecer')
    assert.equal(sinUsar?.severidad, 'aviso')
    assert.match(sinUsar?.detalle ?? '', /Alesska Pin/)
    assert.doesNotMatch(sinUsar?.detalle ?? '', /S\/ 5\.00/)
    assert.ok(ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO <= 30)
  })

  test('no es una alerta si alguien ya decidió: ignorado, anulado, usado o reservado', () => {
    const avisos = [
      pago({ id: 'a', estado: 'ignorado', fecha: AHORA - 60 * MIN }),
      pago({ id: 'b', estado: 'anulado', fecha: AHORA - 60 * MIN }),
      pago({ id: 'c', estado: 'usado', fecha: AHORA - 60 * MIN }),
      pago({ id: 'd', estado: 'reservado', reservadoEn: AHORA - MIN, fecha: AHORA - 60 * MIN }),
    ]
    assert.deepEqual(alertasYape({ avisosYape: avisos }, AHORA), [])
  })

  test('un aviso de PRUEBA nunca genera alerta', () => {
    const prueba = pago({ id: 'p', origen: 'prueba', fecha: AHORA - 60 * MIN })
    assert.deepEqual(alertasYape({ avisosYape: [prueba] }, AHORA), [])
  })

  test('con el umbral en 0 la regla queda apagada', () => {
    const viejo = pago({ fecha: AHORA - 60 * MIN })
    assert.deepEqual(alertasYape({ avisosYape: [viejo], config: { alertaYapeSinUsarMinutos: 0 } }, AHORA), [])
  })

  test('un estado que el app no entiende se muestra como problema, no se esconde', () => {
    const raro = pago({ id: 'x', estado: 'procesando' })
    const alertas = alertasYape({ avisosYape: [raro] }, AHORA)
    assert.equal(alertas.length, 1)
    assert.equal(alertas[0].regla, 'yape-raro')
  })

  test('con los avisos de Yape apagados, no hay alertas de Yape', () => {
    const viejo = pago({ fecha: AHORA - 60 * MIN })
    assert.deepEqual(alertasYape({ avisosYape: [viejo], config: { yapeAvisoActivo: false } }, AHORA), [])
  })
})

// ─── Caja, anulaciones y descuentos ─────────────────────────────────────────

describe('cierres, anulaciones y descuentos', () => {
  test('la diferencia de caja avisa por encima del umbral, con el signo puesto', () => {
    const turnos = [
      turno({ id: 'a', estado: 'cerrado', usuarioNombre: 'Ana', diferencia: -2.5 }),
      turno({ id: 'b', estado: 'cerrado', usuarioNombre: 'Luis', diferencia: 0 }),
    ]
    const a = alertaDiferenciaCaja({ turnosCerradosHoy: turnos })
    assert.match(a?.titulo ?? '', /faltante de S\/ 2\.50/)
    assert.match(a?.detalle ?? '', /Ana: faltante de S\/ 2\.50/)
    assert.ok(ALERTA_DIFERENCIA_CAJA_POR_DEFECTO <= 2.5)
    // Un sobrante se revisa igual que un faltante.
    const sobrante = alertaDiferenciaCaja({ turnosCerradosHoy: [turno({ diferencia: 3 })] })
    assert.match(sobrante?.detalle ?? '', /sobrante/)
    // Por debajo del umbral, nada.
    assert.equal(alertaDiferenciaCaja({ turnosCerradosHoy: [turno({ diferencia: 0.2 })] }), null)
    // Y en 0, apagada.
    assert.equal(alertaDiferenciaCaja({ turnosCerradosHoy: turnos, config: { alertaDiferenciaCaja: 0 } }), null)
  })

  test('las anulaciones avisan al llegar al umbral y dicen QUIÉN anuló', () => {
    const docs = [
      doc({ serieNumero: 'NV01-1', estado: 'anulada', cajero: 'Ana' }),
      doc({ serieNumero: 'NV01-2', estado: 'anulada', cajero: 'Ana' }),
      doc({ serieNumero: 'NV01-3', estado: 'anulada', cajero: 'Luis' }),
      doc({ serieNumero: 'NV01-4' }),
    ]
    const a = alertaAnulaciones({ documentosHoy: docs })
    assert.equal(a?.titulo, '3 comprobantes anulados hoy')
    assert.match(a?.detalle ?? '', /Ana: 2/)
    assert.equal(alertaAnulaciones({ documentosHoy: docs, config: { alertaAnulacionesDia: 4 } }), null)
    assert.equal(alertaAnulaciones({ documentosHoy: docs, config: { alertaAnulacionesDia: 0 } }), null)
  })

  test('el descuento se mide sobre el BRUTO (total + descuento), no sobre lo cobrado', () => {
    // 10 de descuento sobre un bruto de 110 es 9,1% (sobre el cobrado daría 11,1%: sería una alarma falsa).
    const diez = doc({ venta: { total: 100, descuentoTotal: 10 } })
    assert.equal(alertaDescuentos({ documentosHoy: [diez], config: { alertaDescuentoPorcentaje: 10 } }), null)
    const quince = doc({ serieNumero: 'NV01-9', venta: { total: 85, descuentoTotal: 15 } })
    const a = alertaDescuentos({ documentosHoy: [diez, quince], config: { alertaDescuentoPorcentaje: 10 } })
    assert.equal(a?.titulo, '1 venta(s) con descuento mayor a 10%')
    assert.match(a?.detalle ?? '', /NV01-9: 15\.0% \(S\/ 15\.00\)/)
    // Una venta anulada no cuenta (su descuento no cobró nada).
    assert.equal(alertaDescuentos({ documentosHoy: [{ ...quince, estado: 'anulada' }], config: { alertaDescuentoPorcentaje: 10 } }), null)
    // Y en 0, apagada (el default: el número lo pone el dueño).
    assert.equal(alertaDescuentos({ documentosHoy: [quince] }), null)
  })
})

// ─── Conjunto ───────────────────────────────────────────────────────────────

describe('el conjunto: orden, posposición y resumen', () => {
  const contexto = (extra: Partial<ContextoAlertas> = {}): ContextoAlertas => ({
    ahora: AHORA,
    latido: latido({ ultimoLatido: AHORA - 90 * MIN }),
    productos: [producto({ id: 'p1', nombre: 'Harina 1kg', stock: 0 })],
    turnosAbiertos: [turno()],
    turnosCerradosHoy: [turno({ id: 'c1', estado: 'cerrado', diferencia: -5 })],
    documentosHoy: [doc()],
    avisosYape: [pago({ fecha: AHORA - 40 * MIN })],
    ...extra,
  })

  test('lo crítico va primero y lo informativo no cuenta como pendiente', () => {
    const alertas = evaluarAlertas(contexto())
    const sev = alertas.map((a) => a.severidad)
    assert.deepEqual([...sev].sort((a, b) => (a === b ? 0 : a === 'critico' ? -1 : b === 'critico' ? 1 : a === 'aviso' ? -1 : 1)), sev)
    assert.equal(sev[0], 'critico')
    // Puente caído + stock agotado son los críticos; caja abierta es información.
    assert.equal(alertas.filter((a) => a.severidad === 'critico').length, 2)
    assert.equal(alertas.filter((a) => a.severidad === 'info').length, 1)
    assert.equal(contarPendientes(alertas), alertas.length - 1)
    assert.match(resumenAlertas(alertas), /urgente/)
  })

  test('sin nada mal, el resumen lo dice', () => {
    assert.equal(resumenAlertas(evaluarAlertas({ ahora: AHORA, latido: latido() })), 'Todo en orden')
  })

  test('una config vieja (sin los campos nuevos) igual evalúa las reglas útiles', () => {
    // Es el caso real: la config guardada del negocio no tiene ninguno de los umbrales nuevos.
    const alertas = evaluarAlertas(contexto({ config: { yapeAvisoActivo: true } }))
    assert.ok(alertas.some((a) => a.regla === 'puente'))
    assert.ok(alertas.some((a) => a.regla === 'stock-agotado'))
    assert.ok(alertas.some((a) => a.regla === 'diferencia-caja'))
    assert.ok(alertas.some((a) => a.regla === 'yape-sin-usar'))
  })

  test('posponer oculta la alerta hasta su hora, pero la información sigue', () => {
    const alertas = evaluarAlertas(contexto())
    const ids = alertas.filter((a) => a.severidad === 'critico').map((a) => a.id)
    const pospuestas = { [ids[0]]: AHORA + HORA }
    const visibles = alertasVisibles(alertas, { pospuestas, ahora: AHORA })
    assert.ok(!visibles.some((a) => a.id === ids[0]), 'la pospuesta no se muestra')
    assert.ok(visibles.some((a) => a.id === ids[1]), 'la otra sí')
    // La información (caja abierta) no se pospone nunca.
    const info = alertas.find((a) => a.severidad === 'info')
    assert.ok(visibles.some((a) => a.id === info?.id))
    // Y cuando vence la posposición, vuelve sola.
    assert.ok(alertasVisibles(alertas, { pospuestas, ahora: AHORA + 2 * HORA }).some((a) => a.id === ids[0]))
  })

  test('los umbrales por defecto son los que dice el módulo', () => {
    const u = umbralesAlertas(undefined)
    assert.equal(u.stockBajo, true)
    assert.equal(u.yapeSinUsarMin, ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO)
    assert.equal(u.turnoAbiertoHoras, ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO)
    assert.equal(u.diferenciaCaja, ALERTA_DIFERENCIA_CAJA_POR_DEFECTO)
    // El de descuentos arranca apagado a propósito: el número lo pone el negocio.
    assert.equal(u.descuentoPorcentaje, 0)
    // Un campo vacío (string) no rompe: cae al default.
    assert.equal(umbralesAlertas({ alertaTurnoAbiertoHoras: '' as unknown as number }).turnoAbiertoHoras, ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO)
  })

  test('la lista de nombres se corta y avisa cuántos quedaron afuera', () => {
    assert.equal(listarNombres(['a', 'b']), 'a, b')
    assert.equal(listarNombres(['a', 'b', 'c', 'd', 'e']), 'a, b, c, d y 1 más')
  })
})
