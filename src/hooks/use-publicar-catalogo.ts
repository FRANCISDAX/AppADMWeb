/**
 * **Publica el catálogo del link solo** (montado en el `Shell`, como `use-sunat-auto`).
 *
 * 🔑 **Por qué**: el link muestra stock y precios; si hubiera que regenerar el archivo a mano, a los dos días
 * estaría mintiendo. Acá, cada vez que **cambia el catálogo** (una venta descuenta stock, se carga una compra,
 * se edita un precio o se cambia el nombre/teléfono del negocio) el app **republica** el documento que lee el
 * link — **como mucho una vez cada `INTERVALO_PUBLICACION_MS`** (5 min), para no escribir la base en cada venta.
 *
 * ⚠️ **No toca la venta**: es un efecto aparte que corre después; si falla (sin internet, por ejemplo) solo deja
 * un aviso en la consola y el link sigue mostrando la última publicación.
 *
 * ⚠️ **Cualquier usuario con sesión publica** (el contenido es el mismo para todos): así el catálogo se mantiene
 * fresco con solo tener el app abierto, sin depender de que el dueño entre a Configuración.
 */
import * as React from 'react'

import { debePublicar, INTERVALO_PUBLICACION_MS, whatsappDeNegocio } from '@/lib/link-pedidos'
import { catalogoPublico } from '@/lib/pedido-publico'
import { publicarCatalogoPublico } from '@/services/catalogo-publico'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'

export function usePublicarCatalogo() {
  const { productos } = useProductos()
  const { config } = useConfiguracion()
  /** Cuándo se publicó por última vez (en esta pestaña). */
  const ultima = React.useRef(0)
  /** Evita publicar dos veces a la vez si el catálogo cambia rápido. */
  const publicando = React.useRef(false)

  React.useEffect(() => {
    if (productos.length === 0) return
    if (publicando.current) return
    if (!debePublicar(ultima.current, Date.now())) return

    publicando.current = true
    const catalogo = catalogoPublico(productos, {
      publicado: new Date().toISOString(),
      negocio: String(config.nombre ?? ''),
      whatsapp: whatsappDeNegocio(config.telefono),
    })
    publicarCatalogoPublico(catalogo)
      .then((r) => {
        if (r.ok) ultima.current = Date.now()
        else console.warn('No se pudo publicar el catálogo del link:', r.error)
      })
      .finally(() => {
        publicando.current = false
      })
  }, [productos, config])
}

/** El intervalo, expuesto para que la pantalla lo explique sin repetir el número. */
export const INTERVALO_PUBLICACION = INTERVALO_PUBLICACION_MS
