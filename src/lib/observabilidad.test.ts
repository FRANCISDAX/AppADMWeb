/**
 * 🔑 **Observabilidad del app: la agrupación de errores, los umbrales de rendimiento y el resumen por día.**
 *
 * 📌 **Qué se fija acá** (03/11/2026): las decisiones que hacen que el panel de Auditoría → Observabilidad
 * diga la verdad. Si estas reglas se rompen, el panel no falla: **miente** (dos veces el mismo problema
 * contado como dos, un promedio que no corresponde, un número verde cuando debería estar en rojo). Por eso
 * se prueban aparte de la pantalla: son puras.
 *
 * Los casos están elegidos por los errores **reales** que esta app ya tuvo, no por lo que es fácil de testear.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  METRICAS_WEB,
  agruparErrores,
  campoDeMetrica,
  diaDeHoy,
  equipoDe,
  formatoMetrica,
  huellaDeError,
  nivelDeMetrica,
  normalizarMensaje,
  percentil,
  resumenDeErrores,
  resumirMetricas,
  textoDeBitacora,
  valorDeMetrica,
  type DiaDeMetricas,
  type ErrorObservado,
} from './observabilidad.ts'
import { crearBitacora, MAXIMO_EVENTOS } from './bitacora.ts'

// ─── Agrupación ────────���────────────────────────────────────────────────────

describe('normalizar el mensaje: lo que cambia en cada vez no es un problema nuevo', () => {
  test('el número del comprobante no separa dos veces el mismo error', () => {
    // Caso real: el cobro falla y el mensaje trae el correlativo.
    const a = normalizarMensaje('Error al cobrar 2026-9_BOLETA-B001-000001')
    const b = normalizarMensaje('Error al cobrar 2026-9_BOLETA-B001-000002')
    assert.equal(a, b)
  })

  test('los ids de Firestore y los códigos de pedido se colapsan', () => {
    // Los ids de documento de Firestore tienen 20 caracteres (ese es el umbral que normaliza el módulo).
    const idA = 'V1StGXR8Z5jdHi6BmyTq'
    const idB = 'AbC123dEf456GhI789JkL'
    assert.equal(idA.length, 20)
    assert.equal(normalizarMensaje(`documento ${idA} no encontrado`), normalizarMensaje(`documento ${idB} no encontrado`))
    // Y un pedido PED-000123 contra PED-000987.
    assert.equal(normalizarMensaje('Pedido PED-000123 cancelado'), normalizarMensaje('Pedido PED-000987 cancelado'))
  })

  test('montos, cantidades y milisegundos no separan el grupo', () => {
    assert.equal(normalizarMensaje('Total S/ 45.50 inválido'), normalizarMensaje('Total S/ 182.00 inválido'))
    assert.equal(normalizarMensaje('timeout de 8000 ms'), normalizarMensaje('timeout de 300 ms'))
  })

  test('el TEXTO sí separa: son dos causas distintas', () => {
    assert.notEqual(normalizarMensaje('Stock insuficiente'), normalizarMensaje('Sin conexión'))
  })

  test('normaliza mayúsculas y espacios de más (el mismo error escrito distinto)', () => {
    assert.equal(normalizarMensaje('  Error   AL    guardar '), normalizarMensaje('error al guardar'))
  })
})

describe('la huella: la identidad del problema', () => {
  test('el mismo mensaje en dos pantallas es un problema distinto', () => {
    // El contexto entra en la huella a propósito: «Error al guardar» en PDV y en Inventario son dos causas.
    assert.notEqual(
      huellaDeError({ mensaje: 'Error al guardar', contexto: 'pantalla:pdv' }),
      huellaDeError({ mensaje: 'Error al guardar', contexto: 'pantalla:inventario' })
    )
  })

  test('es estable entre equipos y momentos', () => {
    const uno = huellaDeError({ mensaje: 'Error al cobrar 2026-9_BOLETA-B001-000001', contexto: 'pantalla:pdv' })
    const dos = huellaDeError({ mensaje: 'Error al cobrar 2026-9_BOLETA-B001-000002', contexto: 'pantalla:pdv' })
    assert.equal(uno, dos)
  })
})

describe('agrupar errores', () => {
  const errores: ErrorObservado[] = [
    { mensaje: 'Error al cobrar 2026-9_BOLETA-B001-000001', contexto: 'pantalla:pdv', fecha: '2026-11-03T10:00:00.000Z', usuario: 'Ana', dispositivo: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' },
    { mensaje: 'Error al cobrar 2026-9_BOLETA-B001-000002', contexto: 'pantalla:pdv', fecha: '2026-11-03T12:00:00.000Z', usuario: 'Luis', dispositivo: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/605' },
    { mensaje: 'Error al cobrar 2026-9_BOLETA-B001-000003', contexto: 'pantalla:pdv', fecha: '2026-11-02T09:00:00.000Z', usuario: 'Ana', dispositivo: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' },
    { mensaje: 'Stock insuficiente', contexto: 'pantalla:pdv', fecha: '2026-11-03T11:00:00.000Z', usuario: 'Ana', dispositivo: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120' },
  ]

  test('tres cobros fallidos son UN problema, no tres', () => {
    const resumen = resumenDeErrores(errores)
    assert.equal(resumen.total, 4)
    assert.equal(resumen.problemas, 2)
    const cobrar = resumen.grupos[0]
    assert.equal(cobrar.cantidad, 3)
    assert.equal(cobrar.contexto, 'pantalla:pdv')
  })

  test('el grupo guarda la primera vez, la última y el mensaje más reciente', () => {
    const cobrar = agruparErrores(errores).find((g) => g.cantidad === 3)
    assert.ok(cobrar)
    assert.equal(cobrar.primeraVez, '2026-11-02T09:00:00.000Z')
    assert.equal(cobrar.ultimaVez, '2026-11-03T12:00:00.000Z')
    // El mensaje que se muestra es el de la ocurrencia más nueva (la que describe el estado actual).
    assert.match(cobrar.mensaje, /000002/)
  })

  test('dice QUIÉNES lo vieron y en QUÉ equipos (¿una caja o todo el local?)', () => {
    const cobrar = agruparErrores(errores).find((g) => g.cantidad === 3)
    assert.ok(cobrar)
    assert.deepEqual(cobrar.usuarios.sort(), ['Ana', 'Luis'])
    assert.deepEqual(cobrar.equipos.sort(), ['Chrome · Windows', 'Safari · macOS'])
  })

  test('ordena por lo que más duele: cantidad y después lo más reciente', () => {
    const grupos = agruparErrores(errores)
    assert.equal(grupos[0].cantidad, 3)
    assert.equal(grupos[1].cantidad, 1)
  })

  test('los errores YA registrados sin huella se agrupan igual (no hace falta migrar nada)', () => {
    // Los que están en `tblErrores` desde antes no tienen el campo `huella`.
    const viejos: ErrorObservado[] = errores.map(({ ...e }) => e)
    assert.ok(viejos.every((e) => e.huella === undefined))
    assert.equal(agruparErrores(viejos).length, 2)
  })

  test('un registro sin fecha no rompe el grupo ni gana «lo más reciente»', () => {
    const conBasura: ErrorObservado[] = [
      { mensaje: 'Falla X', contexto: 'c', fecha: '2026-11-03T10:00:00.000Z' },
      { mensaje: 'Falla X', contexto: 'c' },
    ]
    const grupo = agruparErrores(conBasura)[0]
    assert.equal(grupo.cantidad, 2)
    assert.equal(grupo.ultimaVez, '2026-11-03T10:00:00.000Z')
  })

  test('no hay lista infinita: se corta en `maxGrupos`', () => {
    // ⚠️ Los grupos distintos tienen que diferir en TEXTO: si difieren en un número, la normalización los
    // junta a propósito (es el punto del módulo).
    const muchos: ErrorObservado[] = Array.from({ length: 40 }, (_, i) => ({
      mensaje: `Falla ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? 'bis' : ''}`,
      contexto: 'c',
    }))
    assert.equal(agruparErrores(muchos).length, 40)
    assert.equal(agruparErrores(muchos, 5).length, 5)
  })

  test('sin errores devuelve vacío, no un grupo fantasma', () => {
    const resumen = resumenDeErrores([])
    assert.equal(resumen.total, 0)
    assert.deepEqual(resumen.grupos, [])
    assert.equal(resumen.problemas, 0)
  })
})

describe('la etiqueta del equipo (para leer la caja desde el panel)', () => {
  test('reconoce navegador y sistema de los equipos reales', () => {
    assert.equal(equipoDe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'), 'Chrome · Windows')
    assert.equal(equipoDe('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605 Version/17.0 Mobile Safari/604'), 'Safari · iOS')
    assert.equal(equipoDe('Mozilla/5.0 (Linux; Android 13) AppleWebKit Chrome/120 Mobile Safari'), 'Chrome · Android')
    assert.equal(equipoDe('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Edg/120'), 'Edge · Windows')
  })

  test('sin datos o con basura no inventa un equipo', () => {
    assert.equal(equipoDe(''), 'equipo desconocido')
    assert.equal(equipoDe(null), 'equipo desconocido')
    assert.equal(equipoDe('algo raro'), 'otro navegador')
  })
})

// ─── Rendimiento ────────────────────────────────────────────────────────────

describe('umbrales de Web Vitals (el color del panel)', () => {
  test('los tres cortes de cada métrica, con los valores oficiales', () => {
    assert.equal(nivelDeMetrica('lcp', 2400), 'ok')
    assert.equal(nivelDeMetrica('lcp', 2500), 'ok')
    assert.equal(nivelDeMetrica('lcp', 3000), 'atencion')
    assert.equal(nivelDeMetrica('lcp', 4100), 'malo')
    assert.equal(nivelDeMetrica('inp', 150), 'ok')
    assert.equal(nivelDeMetrica('inp', 400), 'atencion')
    assert.equal(nivelDeMetrica('inp', 600), 'malo')
    // CLS tiene otra escala (no son milisegundos).
    assert.equal(nivelDeMetrica('cls', 0.05), 'ok')
    assert.equal(nivelDeMetrica('cls', 0.2), 'atencion')
    assert.equal(nivelDeMetrica('cls', 0.4), 'malo')
  })

  test('sin dato devuelve null (no «ok»: no se puede pintar de verde lo que no se midió)', () => {
    assert.equal(nivelDeMetrica('lcp', null), null)
    assert.equal(nivelDeMetrica('lcp', undefined), null)
    assert.equal(nivelDeMetrica('lcp', Number.NaN), null)
  })

  test('el formato respeta la unidad de cada métrica', () => {
    assert.equal(formatoMetrica('lcp', 2140.4), '2140 ms')
    assert.equal(formatoMetrica('cls', 0.05), '0.050')
    assert.equal(formatoMetrica('inp', null), 's/d')
  })
})

describe('percentil', () => {
  test('con pocas muestras devuelve un valor que existe', () => {
    assert.equal(percentil([100], 75), 100)
    assert.equal(percentil([100, 200], 50), 150)
  })

  test('no se deja llevar por un valor enorme (la razón de usar p75 y no el promedio)', () => {
    // El caso real: una medición de 9 s por una pestaña en segundo plano no puede tapar que todo va bien.
    const muestras = [...Array(19).fill(100), 9000]
    assert.equal(percentil(muestras, 75), 100)
    assert.ok((percentil(muestras, 95) ?? 0) > 100)
  })

  test('vacío o con basura no explota', () => {
    assert.equal(percentil([], 75), null)
    assert.equal(percentil([Number.NaN, Number.POSITIVE_INFINITY], 50), null)
  })
})

describe('resumen por día (lo que dibuja el panel)', () => {
  const dias: DiaDeMetricas[] = [
    { id: '2026-11-01', muestras: 2, errores: 5, suma_lcp: 4000, suma_inp: 200, peor_lcp: 2600, peor_inp: 120 },
    { id: '2026-11-02', muestras: 2, errores: 1, suma_lcp: 5000, suma_inp: 300, peor_lcp: 3100, peor_inp: 180 },
    // Día sin INP medido: no puede hundir el promedio de INP.
    { id: '2026-11-03', muestras: 2, errores: 0, suma_lcp: 3000, peor_lcp: 1800 },
  ]

  test('el promedio de cada métrica usa SOLO las muestras de esa métrica', () => {
    const r = resumirMetricas(dias)
    // LCP: (4000+5000+3000) / (2+2+2) = 2000
    assert.equal(r.porMetrica.find((m) => m.metrica === 'lcp')?.promedio, 2000)
    // INP: (200+300) / (2+2) = 125 — el día sin INP no entra
    assert.equal(r.porMetrica.find((m) => m.metrica === 'inp')?.promedio, 125)
    // CLS: nunca se midió
    assert.equal(r.porMetrica.find((m) => m.metrica === 'cls')?.promedio, null)
  })

  test('guarda el peor valor: el promedio esconde el pico', () => {
    const r = resumirMetricas(dias)
    assert.equal(r.porMetrica.find((m) => m.metrica === 'lcp')?.peor, 3100)
  })

  test('cuenta errores y muestras del período, y arma la serie ordenada por día', () => {
    const r = resumirMetricas(dias)
    assert.equal(r.errores, 6)
    assert.equal(r.muestras, 6)
    assert.equal(r.dias, 3)
    assert.deepEqual(r.serie.map((s) => s.dia), ['2026-11-01', '2026-11-02', '2026-11-03'])
    assert.equal(r.serie[0].lcp, 2000)
  })

  test('sin días no inventa números', () => {
    const r = resumirMetricas([])
    assert.equal(r.dias, 0)
    assert.equal(r.errores, 0)
    assert.ok(r.porMetrica.every((m) => m.promedio === null && m.nivel === null))
    assert.deepEqual(r.serie, [])
  })

  test('los nombres de campo son los que el servicio escribe en Firestore', () => {
    // Si cambia uno, el servicio y el panel dejan de coincidir EN SILENCIO.
    assert.equal(campoDeMetrica('lcp', 'suma'), 'suma_lcp')
    assert.equal(campoDeMetrica('inp', 'peor'), 'peor_inp')
    assert.deepEqual([...METRICAS_WEB], ['lcp', 'inp', 'cls', 'fcp', 'ttfb'])
    assert.equal(valorDeMetrica({ id: 'x', suma_lcp: 100 }, 'lcp', 'suma'), 100)
    assert.equal(valorDeMetrica({ id: 'x' }, 'lcp', 'suma'), null)
  })

  test('el día es LOCAL, no UTC (un turno de las 21:00 pertenece a ese día)', () => {
    // 23:30 del 3 de noviembre en hora local: en UTC ya sería el 4.
    const noche = new Date(2026, 10, 3, 23, 30, 0)
    assert.equal(diaDeHoy(noche), '2026-11-03')
    // Y a la mañana temprano también es el 3.
    assert.equal(diaDeHoy(new Date(2026, 10, 3, 0, 15, 0)), '2026-11-03')
  })
})

// ─── Bitácora ───────────────────────────────────────────────────────────────

describe('la bitácora de la sesión (breadcrumbs)', () => {
  test('guarda el orden en que pasaron las cosas', () => {
    const b = crearBitacora()
    b.registrar('seccion:pdv')
    b.registrar('buscar', 'gaseosa')
    b.registrar('cobrar', '3 items')
    assert.deepEqual(b.eventos().map((e) => e.tipo), ['seccion:pdv', 'buscar', 'cobrar'])
  })

  test('no crece sin techo: se queda con los últimos', () => {
    const b = crearBitacora(3)
    for (let i = 1; i <= 10; i++) b.registrar(`paso-${i}`)
    assert.deepEqual(b.eventos().map((e) => e.tipo), ['paso-8', 'paso-9', 'paso-10'])
    assert.equal(crearBitacora().eventos().length, 0)
  })

  test('un evento vacío no se registra (no llena la bitácora de ruido)', () => {
    const b = crearBitacora()
    b.registrar('   ')
    assert.equal(b.eventos().length, 0)
  })

  test('el texto que viaja con el error es corto y legible', () => {
    const eventos = Array.from({ length: MAXIMO_EVENTOS + 5 }, (_, i) => ({ t: i, tipo: `paso-${i}`, detalle: 'x'.repeat(200) }))
    const texto = textoDeBitacora(eventos)
    // Se quedan los ÚLTIMOS 20: del 10 al 29 (hay 30 eventos).
    assert.equal(texto.length, 20)
    assert.ok(texto.every((l) => l.length <= 160), 'ninguna línea puede pasar de 160 caracteres')
    assert.match(texto[0], /^paso-10/)
    assert.match(texto[19], /^paso-29/)
  })
})
