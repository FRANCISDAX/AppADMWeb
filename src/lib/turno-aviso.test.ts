/**
 * **El aviso de «no hay turno abierto» en el PDV** (`lib/turno-aviso.ts` + guardas de la pantalla).
 *
 * 🔑 **Decisión del usuario (30/10/2026)**: el PDV **no abre turnos**. Sin turno, se avisa **arriba y antes**
 * de armar la venta, y el aviso **lleva a la pantalla de Turnos**, que es donde se declara el **monto inicial**
 * (la base del arqueo). Abrirlo desde acá, con 0 por comodidad, dejaría un **sobrante fantasma** en el cierre.
 *
 * ⚠️ Lo que estos tests protegen: que el aviso exista y esté **arriba** (no escondido en el flujo de cobro), que
 * el botón **navegue** a Turnos en vez de abrir un modal, y que el cobro siga **bloqueado** sin turno (la regla
 * de caja no se relaja por tener un atajo).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const pdv = leer('../pages/Pdv.tsx')
const app = leer('../App.tsx')

describe('PDV — aviso de turno cerrado (sin modal, lleva a Turnos)', () => {
  it('la pantalla sabe si hay turno abierto (tres estados, no dos)', () => {
    assert.match(pdv, /const \[hayTurno, setHayTurno\] = React\.useState<boolean \| null>\(null\)/)
    assert.match(pdv, /setHayTurno\(Boolean\(propio\)\)/)
    // Y además si hay alguno abierto en CUALQUIER caja (lo que le importa al vendedor).
    assert.match(pdv, /const \[hayTurnoEnCaja, setHayTurnoEnCaja\] = React\.useState<boolean \| null>\(null\)/)
  })

  it('avisa ANTES de la venta, arriba del carrito', () => {
    assert.match(pdv, /\{sinTurnoQueFrene && \(/)
    assert.match(pdv, /No hay un turno abierto/)
    // El aviso va antes del aviso del límite de turno (que ya estaba arriba del carrito).
    assert.ok(
      pdv.indexOf('sinTurnoQueFrene &&') < pdv.indexOf('<AvisoLimiteTurno'),
      'el aviso de turno tiene que estar arriba, no entre los botones de cobro',
    )
  })

  /**
   * 📌 **Bug del 30/10/2026**: el vendedor veía «no hay turno abierto» **para siempre**, aunque la caja ya
   * estuviera abierta — se miraba solo **su** turno, y el turno lo abre el cajero. Él puede vender igual (manda
   * el pedido), así que el aviso le mentía. Ahora se pregunta también si hay **algún** turno abierto.
   */
  it('🛡️ al vendedor NO le avisa si hay una caja abierta (su pedido lo cobra el cajero)', () => {
    assert.match(pdv, /esVendedor = tienePermiso\('enviarACaja'\) && !tienePermiso\('cobrarVenta'\)/)
    assert.match(
      pdv,
      /const sinTurnoQueFrene = hayTurno === false && !\(esVendedor && hayTurnoEnCaja\)/,
      'el aviso tiene que depender de si el usuario está realmente frenado',
    )
    // Y se consulta por un turno abierto **en cualquier caja**.
    assert.match(pdv, /buscarTurnoAbierto\(undefined, true\)/)
    assert.match(pdv, /No hay ninguna caja abierta/)
  })

  it('el botón NAVEGA a Turnos: no hay modal de apertura en el PDV', () => {
    assert.match(pdv, /onClick=\{onIrATurnos\}/)
    assert.match(app, /<Pdv onIrATurnos=\{\(\) => setSeccion\('turnos'\)\} \/>/)
    // Ni un modal ni una llamada a `abrirTurno` desde el PDV: el monto inicial se declara en Turnos.
    assert.ok(!/abrirTurno\(/.test(pdv), 'el PDV no abre turnos')
    assert.ok(!/AbrirTurnoModal/.test(pdv), 'no puede haber un modal de apertura en el PDV')
  })

  it('🛡️ el cobro sigue bloqueado sin turno (el atajo no relaja la regla de caja)', () => {
    assert.match(pdv, /No hay un turno abierto\. Abre un turno antes de vender/)
    assert.match(pdv, /No hay un turno abierto\. Abre un turno antes de cobrar/)
  })

  it('la pantalla de Turnos sigue siendo la que abre el turno (con su monto inicial)', () => {
    const turnos = leer('../pages/Turnos.tsx')
    assert.match(turnos, /abrirTurno\(\{ tipoTurno, montoInicial: parseFloat\(montoInicial\) \|\| 0/)
  })
})
