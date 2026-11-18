/**
 * **El punto de equilibrio** (`lib/punto-equilibrio.ts`).
 *
 * ⚠️ Lo que estos tests fijan es lo que puede hacer daño si se calcula mal: que **la mercadería no
 * cuente como costo fijo** (se pagaría dos veces), que **el impuesto a las ventas salga del margen**
 * (es variable: como fijo el equilibrio queda corto) y que **con margen 0 o negativo no se invente un
 * número** — ahí no hay equilibrio posible y la pantalla tiene que decirlo.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  CATEGORIAS_FIJAS_TIPICAS,
  baseDeCostosFijos,
  categoriasAusentes,
  categoriasFijasDe,
  comprasDeEgresos,
  costosFijosDe,
  esCostoFijo,
  esMesCompleto,
  impuestosEnEgresos,
  puntoDeEquilibrio,
  resumenDeEgresos,
} from './punto-equilibrio.ts'

describe('esCostoFijo — la mercadería NO es un costo fijo', () => {
  it('alquiler, sueldos, servicios e impuestos son fijos', () => {
    for (const categoria of ['Alquiler', 'Sueldos', 'Servicios', 'Impuestos', 'Mantenimiento', 'Transporte', 'Otros']) {
      assert.equal(esCostoFijo({ categoria }), true, categoria)
    }
  })

  it('«Compras» es mercadería (costo variable), no un fijo', () => {
    // 📌 El caso real: las bolsas se cargaron en Gastos/Egresos con la categoría «Compras». Su costo ya
    // está adentro del margen; contarlo como fijo pediría vender mucho más de lo necesario.
    assert.equal(esCostoFijo({ categoria: 'Compras' }), false)
    assert.equal(esCostoFijo({ categoria: 'compras ' }), false, 'sin importar mayúsculas ni espacios')
  })

  it('una categoría que no conocemos cuenta como fija (no se esconde un gasto)', () => {
    assert.equal(esCostoFijo({ categoria: 'Algo nuevo' }), true)
    assert.equal(esCostoFijo({ categoria: '' }), true)
    assert.equal(esCostoFijo(null), true)
  })
})

describe('costosFijosDe / comprasDeEgresos', () => {
  const egresos = [
    { categoria: 'Alquiler', monto: 1200 },
    { categoria: 'Sueldos', monto: 1500 },
    { categoria: 'Compras', monto: 800 },
    { categoria: 'Servicios', monto: 300 },
    { categoria: 'Compras', monto: 200 },
  ]

  it('suma solo los fijos', () => {
    assert.equal(costosFijosDe(egresos), 3000, '1200 + 1500 + 300: la mercadería queda afuera')
  })

  it('y dice aparte cuánto fue mercadería (para poder avisarlo)', () => {
    assert.equal(comprasDeEgresos(egresos), 1000, '800 + 200')
  })

  it('un monto basura no rompe la suma', () => {
    assert.equal(costosFijosDe([{ categoria: 'Alquiler', monto: 'x' as unknown as number }]), 0)
    assert.equal(costosFijosDe(null), 0)
  })
})

describe('puntoDeEquilibrio — la cuenta', () => {
  it('fijos ÷ margen: con S/ 3.000 fijos y 25% hay que vender S/ 12.000', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 4000, margen: 0.25 })
    assert.equal(r.equilibrio, 12000)
    assert.equal(r.falta, 8000, 'vendió 4.000: le faltan 8.000')
    assert.equal(r.avancePct, 33.33, 'un tercio del camino')
    assert.equal(r.alcanzado, false)
    assert.equal(r.porDia, 461.54, '12.000 en 26 días')
  })

  it('pasado el equilibrio, no “falta” nada y avisa que ya está alcanzado', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 15000, margen: 0.25 })
    assert.equal(r.falta, 0)
    assert.equal(r.alcanzado, true)
    assert.equal(r.avancePct, 100, 'la barra no pasa del 100%')
  })

  it('respeta los días de atención para el “por día”', () => {
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 0, margen: 0.25, dias: 30 })
    assert.equal(r.porDia, 400)
    assert.equal(r.dias, 30)
  })

  it('⚠️ con margen 0 o negativo NO hay equilibrio: devuelve null, no un número imposible', () => {
    for (const margen of [0, -0.1]) {
      const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 5000, margen })
      assert.equal(r.equilibrio, null, `margen ${margen}`)
      assert.equal(r.falta, null)
      assert.equal(r.porDia, null)
      assert.equal(r.alcanzado, false)
      assert.equal(r.avancePct, 0)
    }
  })

  it('sin costos fijos cargados el equilibrio es 0 (y ya está alcanzado)', () => {
    const r = puntoDeEquilibrio({ costosFijos: 0, vendido: 100, margen: 0.25 })
    assert.equal(r.equilibrio, 0)
    assert.equal(r.alcanzado, true)
    assert.equal(r.porDia, 0)
  })

  it('un margen de 1 (mercadería sin costo) da un equilibrio igual a los fijos', () => {
    // No es un error de la cuenta: es el síntoma de que faltan costos, y por eso el margen se mide
    // aparte y la pantalla avisa los ítems sin costo.
    const r = puntoDeEquilibrio({ costosFijos: 3000, vendido: 0, margen: 1 })
    assert.equal(r.equilibrio, 3000)
  })

  it('valores basura no producen NaN', () => {
    const r = puntoDeEquilibrio({ costosFijos: Number.NaN, vendido: Number.NaN, margen: 0.3 })
    assert.equal(r.costosFijos, 0)
    assert.equal(r.vendido, 0)
    assert.equal(r.equilibrio, 0)
  })
})

describe('puntoDeEquilibrio — el impuesto a las ventas (costo VARIABLE)', () => {
  // 📌 El caso real (29/09/2026): fijos S/ 212 (internet 127 + agua 15 + luz 70) y un pago a cuenta del
  // **1,5 % de lo vendido**. Cargarlo como Egreso del mes lo volvía un costo fijo y el equilibrio salía
  // **S/ 966,11**; restándolo del margen da **S/ 1.015,81**. La diferencia no es cosmética: S/ 49,70 al mes.
  const MARGEN = 0.2237
  const IMPUESTO = 1.5

  it('sin impuesto (0 o sin el parámetro) la cuenta es la de siempre', () => {
    const sinParametro = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN })
    const conCero = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: 0 })
    assert.equal(conCero.equilibrio, sinParametro.equilibrio, 'una config vieja (sin el campo) no paga nada')
    assert.equal(conCero.margenContribucion, MARGEN)
    assert.equal(conCero.impuestoDelMes, 0)
  })

  it('el impuesto se RESTA del margen y el equilibrio sube', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    assert.equal(r.margen, MARGEN, 'el margen medido no se toca: se informa aparte')
    assert.equal(r.margenContribucion, 0.2087, '22,37 % − 1,50 %')
    assert.equal(r.equilibrio, 1015.81, '212 ÷ 0,2087')
    assert.equal(r.porDia, 39.07)
    assert.equal(r.impuestoVentasPct, IMPUESTO)
  })

  it('y NO como un costo fijo: la diferencia se mide', () => {
    const variable = puntoDeEquilibrio({ costosFijos: 212, vendido: 274.6, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    const comoFijo = puntoDeEquilibrio({ costosFijos: 212 + 4.12, vendido: 274.6, margen: MARGEN })
    assert.equal(comoFijo.equilibrio, 966.12, 'cargado en Egresos del mes (el 1,5 % de lo vendido: S/ 4,12)')
    assert.ok((variable.equilibrio ?? 0) > (comoFijo.equilibrio ?? 0), 'el variable exige vender más: el fijo queda corto')
  })

  it('dice cuánto se lleva el impuesto de lo vendido (para cotejarlo con lo que se paga)', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 1000, margen: MARGEN, impuestoVentasPct: IMPUESTO })
    assert.equal(r.impuestoDelMes, 15, '1,5 % de 1.000')
  })

  it('⚠️ si el impuesto se come todo el margen, no hay equilibrio: null, no un número imposible', () => {
    const r = puntoDeEquilibrio({ costosFijos: 212, vendido: 500, margen: 0.01, impuestoVentasPct: 1.5 })
    assert.equal(r.equilibrio, null)
    assert.equal(r.falta, null)
    assert.equal(r.porDia, null)
    assert.equal(r.margenContribucion, -0.005, 'queda negativo: vender más agranda la pérdida')
  })

  it('un impuesto basura o negativo no inventa plata', () => {
    assert.equal(puntoDeEquilibrio({ costosFijos: 212, vendido: 0, margen: MARGEN, impuestoVentasPct: Number.NaN }).impuestoVentasPct, 0)
    assert.equal(puntoDeEquilibrio({ costosFijos: 212, vendido: 0, margen: MARGEN, impuestoVentasPct: -5 }).margenContribucion, MARGEN)
  })
})

/**
 * 🛡️ **Test-guarda del cableado**: la cuenta del impuesto está en `lib/` (una sola implementación), y
 * la tarjeta tiene que **leer el porcentaje de la configuración** y pasarlo. Si alguien agrega el campo
 * y no lo conecta —o lo conecta a los fijos en vez del margen— el número vuelve a mentir sin que nada
 * falle. Se lee el código fuente porque el cálculo es puro y el cableado es lo que puede romperse.
 */
describe('🛡️ el impuesto llega desde la configuración hasta la cuenta', () => {
  const aca = dirname(fileURLToPath(import.meta.url))
  const widget = readFileSync(join(aca, '..', 'components', 'dashboard', 'PuntoEquilibrioWidget.tsx'), 'utf8')

  it('existe en la configuración y por defecto es 0 (sin impuesto)', () => {
    const def = readFileSync(join(aca, '..', 'constants', 'tributario.ts'), 'utf8')
    assert.match(def, /impuestoVentasPorcentaje: 0/, 'el default tiene que estar declarado')
  })

  it('la tarjeta lo lee de la config y se lo pasa a puntoDeEquilibrio', () => {
    assert.match(widget, /const impuestoVentasPct = Number\(config\.impuestoVentasPorcentaje\) \|\| 0/)
    assert.match(widget, /puntoDeEquilibrio\(\{[\s\S]*impuestoVentasPct,/)
  })

  it('y se puede guardar desde Configuración', () => {
    const pagina = readFileSync(join(aca, '..', 'pages', 'Configuracion.tsx'), 'utf8')
    assert.match(pagina, /set\('impuestoVentasPorcentaje',/)
  })
})

describe('revisión 03/11/2026 — qué es costo fijo y qué no', () => {
  it('los pagos a proveedores son MERCADERÍA, no costo fijo (antes duplicaban el costo)', () => {
    // services/pagos-proveedores.ts escribe en tblEgresos con esta categoría.
    assert.equal(esCostoFijo({ categoria: 'pago_proveedor' }), false)
    assert.equal(esCostoFijo({ categoria: 'Pago_Proveedor' }), false, 'sin importar mayúsculas')
    // Y la de las compras.
    assert.equal(esCostoFijo({ categoria: 'compra' }), false)
  })

  it('el alquiler y los sueldos sí son fijos', () => {
    assert.equal(esCostoFijo({ categoria: 'Alquiler' }), true)
    assert.equal(esCostoFijo({ categoria: 'Sueldos' }), true)
  })

  it('el desglose por categoría no pierde plata', () => {
    const r = resumenDeEgresos([
      { categoria: 'Alquiler', monto: 800 },
      { categoria: 'alquiler', monto: 200 },   // misma categoría escrita distinto: se junta
      { categoria: 'Sueldos', monto: 1200 },
      { categoria: 'pago_proveedor', monto: 500 },
      { categoria: '', monto: 50 },            // sin categoría → es fijo
    ])
    assert.equal(r.porCategoria.find((c) => c.categoria === 'Alquiler')?.monto, 1000)
    assert.equal(r.fijos, 800 + 200 + 1200 + 50)
    assert.equal(r.mercaderia, 500)
    assert.equal(r.fijos + r.mercaderia, r.porCategoria.reduce((s, c) => s + c.monto, 0))
  })

  it('dice qué categorías típicas faltan cargar', () => {
    const faltan = categoriasAusentes(['Alquiler', 'Sueldos'])
    assert.deepEqual(faltan, ['servicios', 'impuestos', 'mantenimiento', 'transporte'])
    assert.deepEqual(categoriasAusentes(CATEGORIAS_FIJAS_TIPICAS), [])
    assert.deepEqual(categoriasAusentes([]), [...CATEGORIAS_FIJAS_TIPICAS])
  })

  it('detecta el impuesto cargado como Egreso (para avisar del doble conteo)', () => {
    assert.equal(impuestosEnEgresos([{ categoria: 'Impuestos', monto: 120 }]), 120)
    assert.equal(impuestosEnEgresos([{ categoria: 'Alquiler', monto: 800 }]), 0)
  })
})

describe('de dónde salen los costos fijos (mes a medias vs meses completos)', () => {
  const nov = { mes: '2026-11', egresos: [{ categoria: 'Alquiler', monto: 169.9 }] }

  it('con meses completos cargados usa el PROMEDIO (el mes en curso no entra)', () => {
    const base = baseDeCostosFijos({
      mesesCompletos: [
        // Dos categorías por mes: es el criterio de «mes completo» (alquiler + sueldos).
        { mes: '2026-09', egresos: [{ categoria: 'Alquiler', monto: 600 }, { categoria: 'Sueldos', monto: 400 }] },
        { mes: '2026-10', egresos: [{ categoria: 'Alquiler', monto: 900 }, { categoria: 'Sueldos', monto: 500 }] },
      ],
      mesEnCurso: nov,
    })
    assert.equal(base.motivo, 'promedio')
    assert.equal(base.monto, 1200)
    assert.deepEqual(base.mesesUsados, ['2026-09', '2026-10'])
    assert.equal(base.completo, true)
  })

  it('NUNCA promedia meses vacíos: sin historia, usa el mes en curso y lo marca incompleto', () => {
    // 📌 El caso real del usuario: no cargó gastos en septiembre ni octubre.
    // Promediar (169,90 + 0 + 0) ÷ 3 = 57 hundiría el equilibrio a 1/3 y mentiría al revés.
    const base = baseDeCostosFijos({
      mesesCompletos: [
        { mes: '2026-09', egresos: [] },
        { mes: '2026-10', egresos: [] },
      ],
      mesEnCurso: nov,
    })
    assert.equal(base.motivo, 'incompleto')
    assert.equal(base.monto, 169.9)
    assert.equal(base.completo, false)
  })

  it('mezcla: los meses vacíos no arrastran el promedio hacia abajo', () => {
    const base = baseDeCostosFijos({
      mesesCompletos: [
        { mes: '2026-08', egresos: [] },
        { mes: '2026-09', egresos: [{ categoria: 'Sueldos', monto: 700 }, { categoria: 'Alquiler', monto: 200 }] },
      ],
      mesEnCurso: nov,
    })
    assert.equal(base.monto, 900)
  })

  it('respeta el máximo de meses (los más recientes)', () => {
    const base = baseDeCostosFijos({
      mesesCompletos: [
        { mes: '2026-06', egresos: [{ categoria: 'Alquiler', monto: 100 }, { categoria: 'Sueldos', monto: 100 }] },
        { mes: '2026-09', egresos: [{ categoria: 'Alquiler', monto: 300 }, { categoria: 'Sueldos', monto: 100 }] },
        { mes: '2026-10', egresos: [{ categoria: 'Alquiler', monto: 500 }, { categoria: 'Sueldos', monto: 100 }] },
      ],
      mesEnCurso: nov,
      maximoMeses: 2,
    })
    // Los dos más recientes: (400 + 600) ÷ 2 = 500
    assert.equal(base.monto, 500)
    assert.deepEqual(base.mesesUsados, ['2026-09', '2026-10'])
  })

  it('sin nada cargado devuelve 0 pero marco incompleto (la pantalla avisa, no inventa)', () => {
    const base = baseDeCostosFijos({ mesesCompletos: [], mesEnCurso: { mes: '2026-11', egresos: [] } })
    assert.equal(base.monto, 0)
    assert.equal(base.completo, false)
  })
})

  describe('🛡️ la base de los costos fijos y los días llegan desde la configuración', () => {
    const aca = dirname(fileURLToPath(import.meta.url))
    const widget = readFileSync(join(aca, '..', 'components', 'dashboard', 'PuntoEquilibrioWidget.tsx'), 'utf8')

    it('los fijos se calculan con la regla nueva, no leyendo el mes en curso a mano', () => {
      // 📌 Si alguien vuelve a `costosFijosDe(egresosDelMes)` directo, el 3 de cada mes el equilibrio
      // vuelve a salir irrealmente bajo (3 días de gastos contra un objetivo de mes completo).
      assert.match(widget, /baseDeCostosFijos\(/)
      assert.doesNotMatch(widget, /fijos: costosFijosDe\(/)
    })

    it('los días de atención salen de la configuración, con 26 de respaldo', () => {
      assert.match(widget, /config\.diasAtencionMes/)
      const def = readFileSync(join(aca, '..', 'constants', 'tributario.ts'), 'utf8')
      assert.match(def, /diasAtencionMes: 26/, 'el default tiene que estar declarado')
      const pagina = readFileSync(join(aca, '..', 'pages', 'Configuracion.tsx'), 'utf8')
      assert.match(pagina, /set\('diasAtencionMes',/, 'y se tiene que poder guardar desde Configuración')
    })

    it('avisa del doble conteo del impuesto y de las categorías que faltan', () => {
      assert.match(widget, /impuestoComoEgreso/)
      assert.match(widget, /faltanCategorias/)
    })
  })

describe('un mes con UN solo egreso no es un mes (el falso "✅ Mes cubierto")', () => {
  it('septiembre con un egreso de S/ 12 no sirve como base', () => {
    // 📌 El caso real: el widget tomó eso como "mes con datos" ⇒ equilibrio S/ 52,84 y "cubierto"
    // con S/ 54,60 vendidos. Falsa tranquilidad.
    const septiembre = { mes: '2026-09', egresos: [{ categoria: 'Servicios', monto: 12 }] }
    assert.equal(esMesCompleto(septiembre.egresos), false, 'una sola categoría no alcanza')
    const base = baseDeCostosFijos({ mesesCompletos: [septiembre], mesEnCurso: { mes: '2026-11', egresos: [] } })
    assert.equal(base.motivo, 'incompleto')
    assert.equal(base.completo, false)
  })

  it('con alquiler + sueldos sí sirve, y con más también', () => {
    assert.equal(esMesCompleto([{ categoria: 'Alquiler', monto: 800 }, { categoria: 'Sueldos', monto: 1200 }]), true)
    assert.equal(esMesCompleto([{ categoria: 'Alquiler', monto: 800 }, { categoria: 'Sueldos', monto: 1200 }, { categoria: 'Servicios', monto: 90 }]), true)
  })

  it('la mercadería no cuenta como categoría fija', () => {
    const soloCompras = [{ categoria: 'Compras', monto: 500 }, { categoria: 'pago_proveedor', monto: 300 }]
    assert.equal(esMesCompleto(soloCompras), false, 'dos categorías pero las dos son mercadería')
    assert.deepEqual(categoriasFijasDe(soloCompras), [])
  })

  it('un mes en curso PROVISIONADO vale como base (devengo, decisión del usuario)', () => {
    // Provisionar el mes lo deja completo en costos aunque no haya cerrado: no hace falta esperar.
    const base = baseDeCostosFijos({
      mesesCompletos: [],
      mesEnCurso: {
        mes: '2026-11',
        egresos: [
          { categoria: 'Alquiler', monto: 800 },
          { categoria: 'Sueldos', monto: 1200 },
        ],
      },
    })
    assert.equal(base.motivo, 'provisionado')
    assert.equal(base.completo, true)
    assert.equal(base.monto, 2000)
  })

  it('el mínimo de categorías es configurable (para un local sin sueldos, 1)', () => {
    const soloAlquiler = [{ categoria: 'Alquiler', monto: 800 }]
    assert.equal(esMesCompleto(soloAlquiler, 1), true)
    assert.equal(esMesCompleto(soloAlquiler, 2), false)
  })
})
