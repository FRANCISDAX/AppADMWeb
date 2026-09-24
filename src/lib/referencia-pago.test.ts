/**
 * 🔒 GUARDA: **la referencia de un pago se rotula igual en todos lados, y dice «Ref», no «Op».**
 *
 * 📌 **Por qué existe** (24/09/2026): el usuario reportó que al aplicar un aviso de Yape en el PDV, el
 * campo «N° de Operación» se llenaba con *«unas letras, parece un garabato»*. Era el **id del
 * documento** del aviso (`nd_1790227037576`): un identificador interno que se imprimía como si fuera
 * un N° de operación en el PDV, el ticket, el arqueo y el detalle. Se arregló en dos pasos: primero
 * el **valor** (ahora es el N° de operación y, si no viene, el **código de seguridad** — ver
 * `lib/yape.ts`) y después el **rótulo**, porque un aviso real de Yape **no trae N° de operación** y
 * «Op:» prometía algo que podía no ser.
 *
 * 🔑 **La regla que queda fijada**: el rótulo lo decide **una sola función** (`textoReferenciaPago`
 * en `lib/pagos.ts`) y la usan los seis lugares que lo imprimen. Si alguien vuelve a escribir
 * `Op:` a mano en uno de ellos, los papeles se contradicen entre sí (el ticket dice una cosa y el
 * arqueo otra) — que es exactamente lo que el usuario vio.
 *
 * ⚠️ **`Op. Gravadas` / `Op. Exonerada` / `Op. Inafecta` / `Op. Gratuita` NO son esto**: son los
 * totales de SUNAT que declara el comprobante. La guarda solo mira el rótulo de la **referencia del
 * pago** (siempre precedido de `· `), no los totales.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const leer = (...partes: string[]) => readFileSync(join(aqui, ...partes), 'utf8')

/** Los archivos que imprimen la referencia de un pago (ticket, A4, arqueo, detalle y turnos). */
const ARCHIVOS: [string, string[]][] = [
  ['el ticket de 72 mm y el PDF del cierre', ['pdf.ts']],
  ['el comprobante A4', ['comprobante-a4.ts']],
  ['el detalle de la venta', ['..', 'components', 'ModalDetalleVenta.tsx']],
  ['el arqueo', ['..', 'pages', 'ArqueoCaja.tsx']],
  ['los turnos', ['..', 'pages', 'Turnos.tsx']],
]

describe('GUARDA: la referencia del pago se rotula «Ref» y con una sola regla', () => {
  for (const [nombre, ruta] of ARCHIVOS) {
    test(`${nombre} usa \`textoReferenciaPago\` y no imprime «Op:»`, () => {
      const fuente = leer(...ruta)
      assert.match(
        fuente,
        /textoReferenciaPago/,
        `${nombre} tiene que rotular la referencia con la regla única (\`textoReferenciaPago\` de \`lib/pagos.ts\`).`,
      )
      assert.doesNotMatch(
        fuente,
        /· Op: /,
        `${nombre} volvió a imprimir «· Op:»: el rótulo de la referencia del pago es «Ref» (un aviso de Yape puede traer un código de seguridad, no un N° de operación).`,
      )
    })
  }

  test('los totales de SUNAT del comprobante NO se tocan', () => {
    // Son otra cosa: los declara el comprobante y su nombre lo fija el formato de SUNAT.
    for (const ruta of [['pdf.ts'], ['comprobante-a4.ts']]) {
      const fuente = leer(...ruta)
      assert.match(fuente, /Op\. (Gravadas|Exonerada|Inafecta|Gratuita)/, 'Los rótulos de los totales (Op. Gravadas / Op. Exonerada…) tienen que seguir como están.')
    }
  })
})
