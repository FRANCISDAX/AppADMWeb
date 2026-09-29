/**
 * **Cargar un pedido del link pegando el WhatsApp** (PDV → Ventas Pendientes).
 *
 * 🔑 **Qué resuelve**: el cliente arma su pedido en `/pedido` y le llega al negocio como un mensaje
 * ordenado. Antes el cajero lo leía y cargaba los productos **uno por uno**. Acá pega el mensaje y
 * los productos se resuelven solos contra el catálogo; el pedido queda **igual que uno del vendedor**
 * (`crearVentaPendiente`), esperando cobro en el panel de al lado.
 *
 * 🔑 **El precio sale del catálogo, nunca del mensaje**: el importe que dice el WhatsApp solo se usa
 * para comparar (si el precio cambió, se muestra la diferencia). Lo resuelve `lib/pedido-pegado.ts`,
 * que es puro y está testeado; acá solo se dibuja y se decide.
 *
 * ⚠️ **Nada se descarta en silencio**: una línea que no se pudo identificar (producto dado de baja,
 * nombre que coincide con dos productos) **bloquea el botón** hasta que el cajero la quite a
 * propósito o corrija el texto. Cobrar de menos porque el lector «supuso» es peor que preguntar.
 *
 * ⚠️ **Sigue sin tocar el stock**: el pedido se descuenta al cobrar, en el único lugar donde eso
 * pasa (`cobrarVentaPendiente`).
 */
import * as React from 'react'
import { AlertTriangle, ClipboardPaste, Loader2, Trash2, Undo2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { AFECTACION_POR_DEFECTO } from '@/constants/tributario'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useProductos } from '@/hooks/use-productos'
import { fmt } from '@/lib/ui-utils'
import { cn } from '@/lib/utils'
import { AFECTACION_EXONERADO } from '@/lib/sunat-importes'
import { itemsDelPegado, leerPedidoPegado } from '@/lib/pedido-pegado'
import { crearVentaPendiente, type VentaItem } from '@/services/ventas'

export function PegarPedidoLink() {
  const { user } = useAuth()
  const { cajaId, nombre: nombreUsuario } = usePermisos()
  const { config } = useConfiguracion()
  const { productos } = useProductos()
  const { toast, confirm } = useNotifications()

  const [abierto, setAbierto] = React.useState(false)
  const [texto, setTexto] = React.useState('')
  /** Índices de las líneas que el cajero decidió **no** cargar (con los ojos en la pantalla). */
  const [excluidas, setExcluidas] = React.useState<number[]>([])
  const [costoEnvio, setCostoEnvio] = React.useState('')
  const [cargando, setCargando] = React.useState(false)

  const afectacionPorDefecto = config.regionExonerada ? AFECTACION_EXONERADO : AFECTACION_POR_DEFECTO
  const envioCosto = Number(String(costoEnvio).replace(',', '.')) || 0

  const pegado = React.useMemo(
    () => (texto.trim() ? leerPedidoPegado(texto, productos) : null),
    [texto, productos],
  )

  const preview = React.useMemo(
    () =>
      pegado
        ? itemsDelPegado(pegado, {
            excluidas,
            afectacionPorDefecto,
            envio: { costo: envioCosto, afectacion: String(config.tipoAfectacionManual ?? '') },
          })
        : null,
    [pegado, excluidas, afectacionPorDefecto, envioCosto, config.tipoAfectacionManual],
  )

  const sinResolver = pegado ? pegado.lineas.filter((l, i) => l.estado !== 'ok' && !excluidas.includes(i)) : []
  const cargables = pegado ? pegado.lineas.filter((l, i) => l.estado === 'ok' && !excluidas.includes(i)) : []
  const puedeCargar = Boolean(pegado && preview && cargables.length > 0 && sinResolver.length === 0 && !cargando)

  function alternarLinea(i: number) {
    setExcluidas((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
  }

  function limpiar() {
    setTexto('')
    setExcluidas([])
    setCostoEnvio('')
  }

  async function cargar() {
    if (!pegado || !preview || !puedeCargar) return
    const codigo = pegado.codigo || 'del link'
    const ok = await confirm({
      title: `¿Cargar el pedido ${codigo}?`,
      message: `Se crea un pedido pendiente por ${fmt(preview.total)}, esperando cobro.\nEl stock NO se toca: se descuenta cuando lo cobres, igual que cualquier pedido.`,
      okText: 'Cargar pedido',
    })
    if (!ok) return

    setCargando(true)
    try {
      const payload = {
        // 🔑 El formato es el del **documento** (`lib/pedido-pegado.ts`), no el del carrito: si no,
        // el pedido viajaba sin `tipoAfectacion` y al cobrarlo se declaraba GRAVADO un producto
        // exonerado (bug del 18/09/2026).
        items: preview.items as VentaItem[],
        venta: {
          total: preview.total,
          descuentoTotal: 0,
          cliente_nombre: pegado.cliente.nombre,
          cliente_telefono: pegado.cliente.telefono,
          cliente_direccion: pegado.cliente.direccion ?? '',
          cajero: nombreUsuario || user?.email || 'sistema',
          usuarioId: user?.uid || '',
          // El envío se guarda con su dirección y el flete que el cajero decidió cobrar (el link no
          // cotiza el flete: esa plata la define el negocio).
          ...(pegado.cliente.entrega === 'delivery'
            ? {
                envio: {
                  tipo: 'domicilio' as const,
                  direccion: pegado.cliente.direccion ?? '',
                  referencia: '',
                  zonaId: '',
                  costo: envioCosto,
                  notas: pegado.cliente.nota ?? '',
                },
              }
            : {}),
        },
        config: { ...config },
        vendedorId: user?.uid || '',
        vendedorNombre: nombreUsuario || user?.email || 'sistema',
        cajaId: cajaId || '',
        codigoLink: pegado.codigo,
      }

      let res = await crearVentaPendiente(payload)

      // 🔁 El mismo mensaje no se carga dos veces (ni desde otra caja: la huella de un pedido del
      // link es su código). Si el cajero insiste, se marca como duplicado confirmado.
      if (!res.success && res.duplicado) {
        const otro = await confirm({
          title: '¿Cargar otro pedido igual?',
          message: `Ya se cargó este mismo mensaje del link (${res.codigoPedido}) y sigue esperando en caja.\n\nSi el cliente pidió DOS VECES lo mismo, confirmá y se carga un pedido nuevo. Si fue el mismo mensaje, cancelá: el pedido ya está en la lista.`,
          okText: 'Cargar otro igual',
        })
        if (!otro) return toast(`ℹ️ No se cargó nada: el pedido ${res.codigoPedido} ya está en la lista`)
        res = await crearVentaPendiente({ ...payload, permitirDuplicado: true })
      }

      if (res.success) {
        toast(`✅ Pedido ${res.correlativo ?? ''} cargado desde el link`)
        limpiar()
        setAbierto(false)
      } else {
        toast(`❌ ${res.error || 'No se pudo cargar el pedido'}`, 'error')
      }
    } catch (e) {
      toast(`❌ ${(e as Error).message}`, 'error')
    } finally {
      setCargando(false)
    }
  }

  if (!abierto) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setAbierto(true)}>
        <ClipboardPaste className="h-3.5 w-3.5" />
        Pegar pedido del link
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-primary/30 bg-card p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold">Pegar el pedido del link</p>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => {
            limpiar()
            setAbierto(false)
          }}
        >
          Cerrar
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Copiá el mensaje de WhatsApp del cliente (empieza con <b>PEDIDO P-…</b>) y pegalo acá: los
        productos se buscan en el catálogo y los precios se toman de acá, no del mensaje.
      </p>

      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setExcluidas([])
        }}
        rows={5}
        placeholder={'*PEDIDO P-8F3K2*\nCliente: …\n2 × GALLETA SODA = S/ 3.00\n*TOTAL: S/ 3.00*'}
        className="num w-full rounded-lg border bg-background px-2 py-1.5 text-[11px]"
      />

      {pegado && (
        <div className="space-y-2">
          {(pegado.cliente.nombre || pegado.cliente.telefono) && (
            <p className="text-[11px]">
              <b>{pegado.cliente.nombre || 'Sin nombre'}</b>
              {pegado.cliente.telefono ? ` · ${pegado.cliente.telefono}` : ''}
              {' · '}
              {pegado.cliente.entrega === 'delivery'
                ? `envío a ${pegado.cliente.direccion ?? '—'}`
                : 'recojo en tienda'}
            </p>
          )}

          <div className="space-y-1">
            {pegado.lineas.map((l, i) => {
              const fuera = excluidas.includes(i)
              return (
                <div
                  key={`${i}-${l.texto}`}
                  className={cn(
                    'flex items-start justify-between gap-2 rounded-lg border px-2 py-1.5',
                    fuera && 'opacity-40',
                    l.estado !== 'ok' && !fuera && 'border-destructive/40 bg-destructive/5',
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold">
                      {l.cantidad} × {l.producto?.nombre ?? l.nombre}
                    </p>
                    {l.estado === 'ok' ? (
                      <p className="text-[10px] text-muted-foreground">
                        {fmt(l.precio ?? 0)} c/u
                        {l.stockInsuficiente ? ' · ⚠️ hoy no alcanza el stock' : ''}
                        {l.importeDistinto ? ` · el mensaje decía ${fmt(l.importeMensaje)}` : ''}
                      </p>
                    ) : (
                      <p className="text-[10px] font-semibold text-destructive">
                        {l.estado === 'ambiguo'
                          ? `Coincide con ${(l.candidatos ?? []).join(' / ')}`
                          : 'No está en el catálogo activo (o no tiene precio)'}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="num text-[11px] font-bold">
                      {l.precio != null ? fmt(l.precio * l.cantidad) : '—'}
                    </span>
                    <button
                      type="button"
                      onClick={() => alternarLinea(i)}
                      title={fuera ? 'Volver a incluirla' : 'No cargar esta línea'}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {fuera ? <Undo2 className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {pegado.cliente.entrega === 'delivery' && (
            <div>
              <label className="mb-1 block text-[10px] font-semibold">
                Costo de envío a cobrar (el link no lo cotiza)
              </label>
              <input
                value={costoEnvio}
                onChange={(e) => setCostoEnvio(e.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                className="num w-full rounded-lg border bg-background px-2 py-1.5 text-[11px]"
              />
            </div>
          )}

          {pegado.avisos.length > 0 && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-900 dark:bg-amber-950">
              {pegado.avisos.map((a) => (
                <p key={a} className="flex gap-1.5 text-[10px] text-amber-800 dark:text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{a}</span>
                </p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-2 text-[11px]">
            <span className="text-muted-foreground">
              {pegado.lineas.length} línea(s)
              {pegado.totalMensaje > 0 ? ` · el mensaje dice ${fmt(pegado.totalMensaje)}` : ''}
            </span>
            <span className="num font-extrabold">{fmt(preview?.total ?? 0)}</span>
          </div>

          <Button className="w-full" size="sm" disabled={!puedeCargar} onClick={() => void cargar()}>
            {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ClipboardPaste className="h-3.5 w-3.5" />}
            Cargar como pedido
          </Button>
          {sinResolver.length > 0 && (
            <p className="text-center text-[10px] text-destructive">
              Quitá o corregí {sinResolver.length === 1 ? 'la línea' : 'las líneas'} en rojo para poder cargar el
              pedido: no se cargan a medias.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
