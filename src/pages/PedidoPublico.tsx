/**
 * **Pedido por link** — la vidriera pública (`/pedido`).
 *
 * 🔑 **Por qué esta pantalla NO usa Firebase, ni login, ni providers**: la abre un cliente desde su celular.
 * No hay sesión, no hay permisos y no hay que leer nada de la base: baja **una foto** del catálogo
 * (`/catalogo.json`, generado al publicar) y arma un **mensaje de WhatsApp**. Por eso se monta **antes** de
 * `AuthProvider` en `main.tsx`: así el link funciona para cualquiera y el app de adentro queda intacto.
 *
 * ⚠️ **Un pedido NO es una venta**: no toca stock, ni comprobantes, ni caja. Llega al WhatsApp del negocio con
 * un código (`P-XXXXX`) y el cajero lo arma en el PDV, donde ya existe todo el circuito de pedidos.
 *
 * ⚠️ **El botón de WhatsApp usa `window.open`**, no un `<form action="https://wa.me">`: el CSP del hosting
 * (`form-action 'self'`) bloquearía el envío del formulario a otro dominio.
 *
 * ⚠️ **Los precios son una foto**: la fecha de publicación se muestra arriba y viaja en el texto del pedido.
 */
import * as React from 'react'
import { Loader2, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  armarPedido,
  buscarEnCatalogo,
  codigoPedidoPublico,
  enlaceWhatsApp,
  fechaPublicacion,
  totalPedido,
  textoPedido,
  type CatalogoPublico,
  type LineaPedido,
  type PedidoPublico,
} from '@/lib/pedido-publico'
import { desempaquetarCatalogo, urlCatalogoPublico } from '@/lib/link-pedidos'
import { cn } from '@/lib/utils'

const soles = (n: number) => `S/ ${Number(n || 0).toFixed(2)}`

export function PedidoPublico() {
  const [catalogo, setCatalogo] = React.useState<CatalogoPublico | null>(null)
  const [cargando, setCargando] = React.useState(true)
  const [errorCatalogo, setErrorCatalogo] = React.useState('')
  const [q, setQ] = React.useState('')
  const [lineas, setLineas] = React.useState<LineaPedido[]>([])
  const [nombre, setNombre] = React.useState('')
  const [telefono, setTelefono] = React.useState('')
  const [entrega, setEntrega] = React.useState<'recojo' | 'delivery'>('recojo')
  const [direccion, setDireccion] = React.useState('')
  const [nota, setNota] = React.useState('')
  const [error, setError] = React.useState('')
  const [enviado, setEnviado] = React.useState<PedidoPublico | null>(null)

  React.useEffect(() => {
    let vivo = true
    /**
     * 🔑 **Primero el catálogo PUBLICADO (en vivo) y, si no se puede, la foto desplegada.**
     *
     * El app publica el catálogo en `tblPublico/catalogo` cada vez que cambia el stock o un precio, y esa
     * colección se puede leer **sin sesión** (la regla lo permite, igual que la pantalla del cliente). Así el
     * link no queda viejo sin que nadie tenga que regenerar nada.
     *
     * ⚠️ Si la lectura falla (sin internet, o la regla todavía no está desplegada), el link **usa igual** el
     * `/catalogo.json` del hosting: nunca se queda sin mostrar productos.
     */
    const urlVivo = urlCatalogoPublico({
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      // En desarrollo con el emulador se lee del emulador (mismo criterio que `lib/firebase.ts`).
      emulador:
        import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === '1'
          ? `http://${window.location.hostname === '127.0.0.1' ? '127.0.0.1' : 'localhost'}:8080`
          : undefined,
    })

    async function cargar() {
      if (urlVivo) {
        try {
          const r = await fetch(urlVivo, { cache: 'no-store' })
          if (r.ok) {
            const enVivo = desempaquetarCatalogo(await r.json())
            if (vivo && enVivo) {
              setCatalogo(enVivo)
              setCargando(false)
              return
            }
          }
        } catch (e) {
          console.warn('No se pudo leer el catálogo publicado; se usa la foto desplegada:', e)
        }
      }
      const r = await fetch('/catalogo.json', { cache: 'no-cache' })
      if (!r.ok) throw new Error(String(r.status))
      const foto = (await r.json()) as CatalogoPublico
      if (!vivo) return
      setCatalogo(foto)
      setCargando(false)
    }

    cargar().catch((e) => {
      console.error('No se pudo cargar el catálogo del link:', e)
      if (!vivo) return
      setErrorCatalogo('El catálogo todavía no está publicado. Pedilo por WhatsApp al negocio.')
      setCargando(false)
    })
    return () => {
      vivo = false
    }
  }, [])

  const visibles = React.useMemo(() => (catalogo ? buscarEnCatalogo(catalogo, q) : []), [catalogo, q])
  const total = React.useMemo(() => (catalogo ? totalPedido(catalogo, lineas) : 0), [catalogo, lineas])
  const cantidadDe = (id: string) => lineas.find((l) => l.id === id)?.cantidad ?? 0

  function agregar(id: string) {
    setLineas((prev) => {
      const ya = prev.find((l) => l.id === id)
      if (ya) return prev.map((l) => (l.id === id ? { ...l, cantidad: l.cantidad + 1 } : l))
      return [...prev, { id, cantidad: 1 }]
    })
  }

  function quitar(id: string) {
    setLineas((prev) =>
      prev.flatMap((l) => (l.id === id ? (l.cantidad > 1 ? [{ ...l, cantidad: l.cantidad - 1 }] : []) : [l])),
    )
  }

  function enviar() {
    if (!catalogo) return
    // El código se arma acá (no en el render): es un dato del pedido que se está mandando, y `Date.now()`
    // es una función impura que no tiene nada que hacer en un `useMemo`.
    const codigo = codigoPedidoPublico(`${Date.now()}`)
    const r = armarPedido(catalogo, lineas, { nombre, telefono, entrega, direccion, nota, codigo })
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError('')
    setEnviado(r.pedido)
    const url = enlaceWhatsApp(r.pedido, catalogo)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando el catálogo…
      </div>
    )
  }

  if (errorCatalogo || !catalogo) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <ShoppingBag className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{errorCatalogo || 'No hay catálogo disponible.'}</p>
      </div>
    )
  }

  /** Ya se armó el pedido: se muestra el código y el texto (por si el WhatsApp no se abrió). */
  if (enviado) {
    return (
      <div className="mx-auto max-w-md space-y-4 bg-background p-5">
        <div className="rounded-xl border bg-card p-4 shadow-card">
          <p className="text-lg font-bold">¡Pedido {enviado.codigo} enviado!</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Mandalo por WhatsApp con el botón de abajo (o copiá el texto). Citá el código{' '}
            <b>{enviado.codigo}</b> si necesitás consultar.
          </p>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-3 text-xs">
          {textoPedido(enviado, catalogo)}
        </pre>
        <div className="flex flex-col gap-2">
          {enlaceWhatsApp(enviado, catalogo) && (
            <Button onClick={() => window.open(enlaceWhatsApp(enviado, catalogo), '_blank', 'noopener')}>
              Abrir WhatsApp con el pedido
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(textoPedido(enviado, catalogo))
            }}
          >
            Copiar el pedido
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setEnviado(null)
              setLineas([])
            }}
          >
            Hacer otro pedido
          </Button>
        </div>
      </div>
    )
  }

  const fecha = fechaPublicacion(catalogo.publicado)

  return (
    <div className="min-h-screen bg-background pb-40">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3">
        <h1 className="text-base font-bold">{catalogo.negocio || 'Catálogo'}</h1>
        <p className="text-[11px] text-muted-foreground">
          Elegí lo que querés y mandá el pedido por WhatsApp{fecha ? ` · precios al ${fecha}` : ''}
        </p>
      </header>

      <div className="space-y-3 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar producto…"
            className="pl-10"
          />
        </div>

        {visibles.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No encontramos «{q}». Probá con otro nombre o código.
          </p>
        ) : (
          <div className="divide-y rounded-xl border bg-card">
            {visibles.map((i) => {
              const cant = cantidadDe(i.id)
              const agotado = i.stock <= 0
              return (
                <div key={i.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{i.nombre}</p>
                    <p className="text-xs text-muted-foreground">
                      {soles(i.precio)}
                      {i.unidad ? ` · ${i.unidad}` : ''}
                      {agotado ? ' · agotado' : i.stock <= 5 ? ` · quedan ${i.stock}` : ''}
                    </p>
                  </div>
                  {cant === 0 ? (
                    <Button size="sm" variant="outline" onClick={() => agregar(i.id)} disabled={agotado}>
                      Agregar
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => quitar(i.id)} aria-label="Quitar uno">
                        <Minus className="h-4 w-4" />
                      </Button>
                      <span className="num w-6 text-center text-sm font-bold">{cant}</span>
                      <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => agregar(i.id)} aria-label="Agregar uno">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {lineas.length > 0 && (
          <div className="rounded-xl border bg-card p-3">
            <p className="mb-2 text-sm font-bold">Tu pedido</p>
            <div className="space-y-1">
              {lineas.map((l) => {
                const item = catalogo.items.find((i) => i.id === l.id)
                if (!item) return null
                return (
                  <div key={l.id} className="flex items-center justify-between text-sm">
                    <span className="min-w-0 truncate">
                      {l.cantidad} × {item.nombre}
                    </span>
                    <span className="num ml-2 shrink-0">{soles(item.precio * l.cantidad)}</span>
                    <button
                      onClick={() => setLineas((prev) => prev.filter((x) => x.id !== l.id))}
                      className="ml-2 shrink-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Sacar ${item.nombre}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-2 rounded-xl border bg-card p-3">
          <p className="text-sm font-bold">Tus datos</p>
          <div className="grid gap-2">
            <div>
              <Label className="mb-1 block text-xs">Nombre</Label>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
            </div>
            <div>
              <Label className="mb-1 block text-xs">WhatsApp / teléfono</Label>
              <Input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="999 888 777"
                inputMode="tel"
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">¿Cómo lo querés?</Label>
              <div className="flex gap-1 rounded-xl bg-muted p-1 text-sm">
                {(
                  [
                    { v: 'recojo', t: 'Recojo en tienda' },
                    { v: 'delivery', t: 'Envío a domicilio' },
                  ] as const
                ).map((o) => (
                  <button
                    key={o.v}
                    type="button"
                    onClick={() => setEntrega(o.v)}
                    className={cn(
                      'flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center',
                      entrega === o.v ? 'bg-background font-semibold shadow-sm' : 'text-muted-foreground',
                    )}
                  >
                    {o.t}
                  </button>
                ))}
              </div>
            </div>
            {entrega === 'delivery' && (
              <div>
                <Label className="mb-1 block text-xs">Dirección</Label>
                <Input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder="Calle, número, referencia" />
              </div>
            )}
            <div>
              <Label className="mb-1 block text-xs">Algo que quieras aclarar (opcional)</Label>
              <Input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej.: lo paso a las 6" />
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          El negocio confirma el pedido y el precio antes de prepararlo. Los precios son los del catálogo
          {fecha ? ` al ${fecha}` : ''} y el stock está sujeto a confirmación.
        </p>
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t bg-card p-3 shadow-lg">
        {error && <p className="mb-2 text-xs font-semibold text-destructive">{error}</p>}
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] text-muted-foreground">Total</p>
            <p className="num text-lg font-extrabold">{soles(total)}</p>
          </div>
          <Button onClick={enviar} disabled={lineas.length === 0} className="flex-1">
            Enviar pedido por WhatsApp
          </Button>
        </div>
      </div>
    </div>
  )
}
