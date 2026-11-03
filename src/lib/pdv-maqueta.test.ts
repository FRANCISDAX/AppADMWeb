/**
 * 🔑 **GUARDA: en el celular el cobro no puede quedar debajo de todo el catálogo.**
 *
 * 📌 **Por qué existe** (03/11/2026): la maqueta del PDV pone el carrito al costado recién desde `lg`
 * (1024 px). Abajo de eso el carrito caía **después del catálogo completo**, así que vender desde el celular
 * —que es la contingencia cuando se cae el internet del local— obligaba a bajar a ciegas para encontrar el
 * cobro, con el catálogo paginado de a 60 productos. Ahora hay una **barra fija** con items y total, y el
 * carrito se abre **encima** como hoja.
 *
 * Se fija leyendo `pages/Pdv.tsx` (igual criterio que `sesion-offline.test.ts` con `App.tsx`): es una regla
 * de maqueta que un refactor puede deshacer sin que nada más falle.
 *
 * ⚠️ **Y una trampa de compatibilidad**: el variante `max-lg:` de Tailwind se compila como
 * `@media not all and (width>=1024px)`, sintaxis que un iPad con iPadOS 15 o cualquier navegador viejo
 * **descarta entera** — las reglas de la hoja no aplicarían y el carrito volvería a quedar suelto abajo.
 * Por eso la hoja se escribe «celular primero» y se deshace con `lg:` (min-width, que entiende todo).
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aqui = dirname(fileURLToPath(import.meta.url))
const pdv = readFileSync(join(aqui, '..', 'pages', 'Pdv.tsx'), 'utf8')

/**
 * El código sin los comentarios. Hace falta para las guardas que buscan clases: en `Pdv.tsx` hay comentarios
 * que **nombran** `max-lg:` justamente para explicar por qué no se usa, y un `doesNotMatch` sobre el texto
 * crudo los tomaría como si fueran código.
 */
const codigo = pdv
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .join('\n')

describe('el carrito del PDV en celular', () => {
  test('es una hoja fija abajo, y en escritorio vuelve a ser la columna del costado', () => {
    // El bloque que envuelve el carrito: fijo abajo (celular) y estático desde lg (escritorio).
    assert.match(pdv, /fixed inset-x-0 bottom-0 z-40/, 'la hoja del celular tiene que ir fija abajo')
    assert.match(pdv, /lg:static lg:z-auto/, 'desde lg tiene que volver a la columna normal')
    // Cerrado en el celular no se dibuja; en escritorio la columna está siempre visible.
    assert.match(
      pdv,
      /carritoAbierto \? 'flex' : 'hidden lg:flex'/,
      'cerrado tiene que ser `hidden` en celular y `flex` desde lg'
    )
  })

  test('tiene su propio encabezado con la salida a mano', () => {
    // «Seguir vendiendo»: sin esto, la hoja tapa el catálogo y no se ve cómo volver.
    assert.match(pdv, /Seguir vendiendo/)
  })

  test('hay una barra fija con items y total que abre la hoja', () => {
    assert.match(pdv, /border-t bg-card\/95 px-3 py-[0-9.]+ backdrop-blur lg:hidden/)
    assert.match(pdv, /onClick=\{\(\) => setCarritoAbierto\(true\)\}/)
  })

  test('la barra avisa si hay pedidos esperando o avisos de Yape (paneles que viven dentro del carrito)', () => {
    // Los dos paneles escuchan en vivo, pero están DENTRO de la hoja: sin el badge, un pedido o un yapeo
    // recién llegados solo se verían abriendo la venta. Los números los informan los paneles, no se
    // consultan de nuevo acá (sería una segunda suscripción a las mismas colecciones).
    assert.match(pdv, /onPendientes=\{alInformarPedidos\}/)
    assert.match(pdv, /onAvisos=\{alInformarAvisosYape\}/)
    assert.match(pdv, /pedido esperando|pedidos esperando/)
    assert.match(pdv, /aviso de Yape|avisos de Yape/)
  })

  test('la barra NO se deshabilita con la venta vacía', () => {
    // Dentro del carrito viven «Pausadas», «Pedidos enviados» y «Retiro sin cobro»: si la barra se
    // deshabilitara sin items, en el celular quedarían inalcanzables. Con 0 items dice «Ver carrito».
    assert.doesNotMatch(
      pdv,
      /onClick=\{\(\) => setCarritoAbierto\(true\)\}\s*\n\s*disabled=/,
      'la barra tiene que abrir la hoja aunque el carrito esté vacío'
    )
    assert.match(pdv, /'Ver carrito'/)
  })

  test('qué hace el botón grande sale de UNA regla, no de dos', () => {
    // El pie del carrito (PC) y la barra (celular) comparten `accionDeVenta`: si cada uno decidiera por su
    // cuenta, la barra podría ofrecer «Cobrar» a un vendedor que solo puede enviar a caja.
    assert.match(pdv, /const accionDeVenta: 'pedido' \| 'enviar' \| 'cobrar'/)
    assert.match(pdv, /accionDeVenta === 'pedido' \? 'Cobrar pedido'/)
    // Y el pie del carrito usa esa regla (no `tienePermiso('enviarACaja') && !tienePermiso('cobrarVenta')`).
    assert.doesNotMatch(
      pdv,
      /\} : tienePermiso\('enviarACaja'\) && !tienePermiso\('cobrarVenta'\) \? \(/,
      'el pie del carrito tiene que usar `accionDeVenta`'
    )
  })

  test('nada de `max-lg:` (un iPad viejo descartaría la regla)', () => {
    assert.doesNotMatch(codigo, /max-lg:/, 'usar `lg:` al revés: celular por defecto y el `lg:` para deshacerlo')
  })

  test('el aviso (toast) sube para no quedar tapado por la barra', () => {
    assert.match(pdv, /bottom-24 left-1\/2 z-50[^']*lg:bottom-6/)
  })
})
