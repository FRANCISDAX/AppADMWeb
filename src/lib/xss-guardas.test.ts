/**
 * 🛡️ **Guardas de XSS** — el app arma HTML a mano en un solo lugar (los tickets de `lib/pdf.ts` y las
 * etiquetas de `Inventario.tsx`), y ese HTML se escribe con `document.write` en una ventana del **mismo
 * origen**: un `<script>` o un `onerror=` que se cuele ahí corre con acceso a `window.opener` (o sea, a la
 * sesión del POS). Por eso lo que se pinte por JSX lo escapa React, y lo que se arma a mano **tiene que pasar
 * por `esc()`** (`lib/ui-utils.ts`).
 *
 * ⚠️ Estos tests leen el código a propósito: `lib/pdf.ts` importa con el alias `@/`, así que el runner de Node
 * no puede cargarlo. Cada guarda falla si alguien agrega una interpolación de datos **sin escapar**.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const leer = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('🛡️ XSS — el HTML hecho a mano escapa todo lo que viene de datos', () => {
  const pdf = leer('../lib/pdf.ts')
  const inventario = leer('../pages/Inventario.tsx')

  it('no hay `dangerouslySetInnerHTML` en toda la app (React escapa solo)', () => {
    const archivos = [
      '../lib/pdf.ts',
      '../pages/Inventario.tsx',
      '../pages/Pdv.tsx',
      '../pages/Reportes.tsx',
      '../components/AuditoriaCaja.tsx',
    ]
    for (const f of archivos) {
      let src = ''
      try {
        src = leer(f)
      } catch {
        continue // el archivo puede no existir en otra rama
      }
      assert.ok(!/dangerouslySetInnerHTML/.test(src), `${f} no puede inyectar HTML crudo`)
    }
  })

  it('el `src` del logo y del QR van escapados (inyección por atributo)', () => {
    // Un logo con comillas (`x" onerror="…`) se saldría del atributo `src="…"`.
    assert.match(pdf, /src="\$\{esc\(logo\)\}"/)
    assert.match(pdf, /src="\$\{esc\(qrSvg\)\}"/)
    // Y el logo además tiene que ser una URL válida (no cualquier cosa que escriban en la config).
    assert.match(pdf, /\^\(https\?:\\\/\\\/\|data:image\\\/\|\\\/\[\^\/\]\)/)
  })

  it('el hash del comprobante se escapa (viene de Firestore)', () => {
    assert.match(pdf, /hashText = esc\(sunat\.hash \|\| ''\)/)
  })

  it('los datos del producto y del cliente pasan por `esc()`', () => {
    for (const campo of ['esc(desc)', 'esc(und', 'esc(config.nombre)', 'esc(config.direccion)', 'esc(config.ruc)', 'esc(clienteDni)', 'esc(clienteNombre)', 'esc(clienteDireccion)', 'esc(serieNumero)', 'esc(formaPago)', 'esc(sonLetras)']) {
      assert.ok(pdf.includes(campo), `el ticket tiene que escapar ${campo}`)
    }
    // Las etiquetas del inventario también.
    assert.match(inventario, /esc\(p\.nombre\)/)
    assert.match(inventario, /esc\(p\.codigo \|\| '—'\)/)
  })

  it('los nombres de quién vendió/cobró se escapan uno por uno', () => {
    assert.match(pdf, /esc\(l\.etiqueta\)\}: \$\{esc\(l\.nombre\)\}/)
  })

  it('el HTML del ticket se escribe en una ventana del mismo origen (about:blank), no en una URL externa', () => {
    const ventanas = pdf.match(/window\.open\(([^)]*)\)/g) ?? []
    assert.ok(ventanas.length > 0, 'tiene que abrir una ventana para imprimir')
    for (const v of ventanas) {
      assert.match(v, /window\.open\(''/, 'la ventana de impresión se abre vacía (mismo origen)')
    }
    assert.ok(!/document\.write\([^)]*https?:/i.test(pdf), 'nunca se escribe HTML traído de una URL')
  })

  it('no hay `eval` ni `new Function` (una CSP con unsafe-eval no alcanza como defensa)', () => {
    for (const f of ['../lib/pdf.ts', '../pages/Inventario.tsx', '../pages/Pdv.tsx', '../lib/comprobante-a4.ts']) {
      const src = leer(f)
      assert.ok(!/\beval\s*\(/.test(src), `${f} no puede usar eval`)
      assert.ok(!/new Function\s*\(/.test(src), `${f} no puede usar new Function`)
    }
  })
})

describe('🛡️ XSS — la CSP de Firebase Hosting sigue puesta', () => {
  const hosting = JSON.parse(readFileSync(new URL('../../firebase.json', import.meta.url), 'utf8'))
  const headers = hosting.hosting.headers[0].headers as { key: string; value: string }[]
  const valor = (k: string) => headers.find((h) => h.key === k)?.value ?? ''

  it('tiene CSP con `default-src self`, `frame-ancestors none` y `base-uri self`', () => {
    const csp = valor('Content-Security-Policy')
    assert.match(csp, /default-src 'self'/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.match(csp, /base-uri 'self'/)
    assert.match(csp, /form-action 'self'/)
  })

  it('tiene las cabeceras de clickjacking y de tipo de contenido', () => {
    assert.equal(valor('X-Frame-Options'), 'DENY')
    assert.equal(valor('X-Content-Type-Options'), 'nosniff')
    assert.ok(valor('Referrer-Policy').length > 0)
    // 🔑 Agregadas el 30/10/2026: HSTS, Permissions-Policy y los aislamientos de contexto.
    assert.match(valor('Strict-Transport-Security'), /max-age=\d{8,}/)
    assert.match(valor('Permissions-Policy'), /camera=\(self\)/)
    assert.ok(valor('Cross-Origin-Opener-Policy').length > 0)
    assert.equal(valor('Cross-Origin-Resource-Policy'), 'same-origin')
    assert.equal(valor('X-Permitted-Cross-Domain-Policies'), 'none')
  })

  it('la CSP bloquea `object-src` y permite reCAPTCHA (App Check) sin abrir todo', () => {
    const csp = valor('Content-Security-Policy')
    assert.match(csp, /object-src 'none'/)
    assert.match(csp, /content-firebaseappcheck\.googleapis\.com/)
  })

  it('⚠️ deuda conocida: `script-src` todavía permite `unsafe-inline`/`unsafe-eval`', () => {
    // No es una guarda de "está bien": es el recordatorio medible de lo que falta endurecer.
    const csp = valor('Content-Security-Policy')
    assert.match(csp, /script-src 'self' 'unsafe-inline' 'unsafe-eval'/)
  })
})
