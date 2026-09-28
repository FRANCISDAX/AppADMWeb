/**
 * **La tarjeta del link de pedidos** (Configuración → Empresa).
 *
 * 🔑 **Para qué**: que el negocio **tenga el link a mano** (copiar, compartir por WhatsApp, QR para imprimir) y
 * que **vea que la publicación está viva** (cuándo se publicó por última vez y con cuántos productos). Antes el
 * link solo lo tenía el que lo programó, y el catálogo había que regenerarlo a mano.
 *
 * ⚠️ **El catálogo lo publica el app solo** (`usePublicarCatalogo()`, montado en el `Shell`): acá se muestra el
 * estado y, si el dueño quiere forzarlo, hay un botón para publicar en el momento.
 */
import * as React from 'react'
import { Check, Copy, Loader2, QrCode, RefreshCw, Share2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'
import {
  INTERVALO_PUBLICACION_MS,
  haceCuanto,
  linkPedido,
  mensajeParaCompartir,
  urlCompartirWhatsApp,
  whatsappDeNegocio,
} from '@/lib/link-pedidos'
import { catalogoPublico } from '@/lib/pedido-publico'
import { estadoCatalogoPublico, publicarCatalogoPublico, type EstadoCatalogoPublico } from '@/services/catalogo-publico'

/** El estado que muestra la tarjeta, con el «hace cuánto» ya calculado (nada de `Date.now()` en el render). */
type Estado = { publicado: number; items: number; texto: string } | null

const aEstado = (e: EstadoCatalogoPublico | null): Estado =>
  e ? { ...e, texto: haceCuanto(e.publicado, Date.now()) } : null

export function LinkPedidos() {
  const { productos } = useProductos()
  const { config } = useConfiguracion()
  const { toast } = useNotifications()
  const [copiado, setCopiado] = React.useState(false)
  const [publicando, setPublicando] = React.useState(false)
  /** `'cargando'` mientras se lee; `null` cuando nunca se publicó desde el app. */
  const [estado, setEstado] = React.useState<Estado | 'cargando'>('cargando')

  const link = linkPedido()
  const mensaje = mensajeParaCompartir(link, String(config.nombre ?? ''))
  const whatsapp = whatsappDeNegocio(config.telefono)

  // Lee el estado al abrir y lo refresca cada minuto (el «hace cuánto» se mantiene al día solo).
  // ⚠️ Los `setEstado` van dentro de un `.then`/timer, nunca sincrónicos en el efecto.
  React.useEffect(() => {
    let vivo = true
    const leer = () => {
      void estadoCatalogoPublico().then((e) => {
        if (vivo) setEstado(aEstado(e))
      })
    }
    leer()
    const id = setInterval(leer, 60_000)
    return () => {
      vivo = false
      clearInterval(id)
    }
  }, [])

  async function copiar(texto: string, que: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
      toast(`${que} copiado`, 'success')
    } catch {
      // Sin permiso de portapapeles (o http): se muestra el texto para copiarlo a mano.
      toast('No se pudo copiar: seleccioná el link y copialo a mano', 'warning')
    }
  }

  async function publicarAhora() {
    setPublicando(true)
    const r = await publicarCatalogoPublico(
      catalogoPublico(productos, {
        publicado: new Date().toISOString(),
        negocio: String(config.nombre ?? ''),
        whatsapp,
      }),
    )
    setPublicando(false)
    if (!r.ok) {
      toast(r.error ?? 'No se pudo publicar', 'error')
      return
    }
    setEstado(aEstado(await estadoCatalogoPublico()))
    toast('Catálogo del link publicado', 'success')
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <QrCode className="h-5 w-5 text-primary" />
        <h2 className="font-bold">Link de pedidos (el cliente pide solo)</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        Compartilo por WhatsApp, redes o imprimí el QR para el mostrador. El cliente arma su pedido desde el
        celular y <b>te llega al WhatsApp del negocio</b>; después lo cobrás en el PDV como cualquier pedido.
      </p>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold">El link</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="num w-full rounded-lg border border-input bg-muted/40 px-3 py-2 text-xs"
              />
              <Button variant="outline" size="sm" onClick={() => void copiar(link, 'Link')} className="shrink-0">
                {copiado ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.open(urlCompartirWhatsApp(mensaje), '_blank', 'noopener')}>
              <Share2 className="mr-1.5 h-3.5 w-3.5" /> Compartir por WhatsApp
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copiar(mensaje, 'Mensaje')}>
              <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar el mensaje
            </Button>
            <Button variant="outline" size="sm" onClick={() => void publicarAhora()} disabled={publicando || productos.length === 0}>
              {publicando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Publicar el catálogo ahora
            </Button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {estado === 'cargando'
              ? 'Viendo cuándo se publicó…'
              : estado
                ? `Última publicación: ${estado.texto} · ${estado.items} productos. Se vuelve a publicar sola cuando cambia el catálogo (como mucho cada ${Math.round(INTERVALO_PUBLICACION_MS / 60000)} min).`
                : 'Todavía no se publicó desde el app: el link está mostrando la última foto desplegada.'}
          </p>
          {!whatsapp && (
            <p className="text-[11px] font-semibold text-amber-600">
              ⚠️ Cargá el <b>Teléfono</b> de la empresa (arriba) y guardá: sin ese número el pedido no puede abrir
              WhatsApp y el cliente solo puede copiar el texto.
            </p>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          <img
            src="/qr-pedido.png"
            alt={`QR del link de pedidos ${link}`}
            className="h-40 w-40 rounded-lg border bg-white p-1"
          />
          <a href="/qr-pedido.png" download="qr-pedidos.png" className="text-[11px] font-semibold text-primary underline">
            Descargar el QR
          </a>
          <p className="max-w-[10rem] text-center text-[10px] text-muted-foreground">
            Imprimilo y pegalo en el mostrador o en la puerta.
          </p>
        </div>
      </div>
    </div>
  )
}
