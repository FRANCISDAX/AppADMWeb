import * as React from 'react'
import { listenCart, type CustomerDisplayData } from '@/lib/customer-display'

function getParams() {
  const p = new URLSearchParams(window.location.search)
  return { session: p.get('session') || '' }
}

function fmt(n: number) {
  return 'S/ ' + n.toFixed(2)
}

export function PantallaCliente() {
  const { session } = React.useMemo(getParams, [])
  const [data, setData] = React.useState<CustomerDisplayData | null>(null)
  const [connected, setConnected] = React.useState(false)

  React.useEffect(() => {
    if (!session) return
    setConnected(true)
    return listenCart(session, (d) => setData(d))
  }, [session])

  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-bold">Sesión no válida</p>
          <p className="text-sm">Escanee el código QR desde el PDV.</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="text-lg font-bold">Esperando productos…</p>
          <p className="text-sm">Conectado al PDV</p>
        </div>
      </div>
    )
  }

  const itemCount = data.items.reduce((s, i) => s + i.cantidad, 0)

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <div className="brand-grad px-6 py-5 text-white text-center">
        <h1 className="text-xl font-extrabold tracking-tight">{data.businessName || 'JorFel'}</h1>
        <p className="mt-1 text-sm opacity-80">Tu compra</p>
      </div>

      {/* Items */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {data.items.length === 0 ? (
          <div className="py-20 text-center text-muted-foreground">
            <p className="text-sm">Carrito vacío</p>
          </div>
        ) : (
          <div className="space-y-0 divide-y">
            {data.items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.nombre}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.cantidad} × {fmt(item.precioUnitario)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">{fmt(item.subtotal)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: totals */}
      <div className="border-t bg-card px-6 py-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Productos</span>
          <span className="font-semibold">{itemCount} artículo{itemCount !== 1 ? 's' : ''}</span>
        </div>
        {data.descuento > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Descuento</span>
            <span className="font-semibold text-emerald-600">-{fmt(data.descuento)}</span>
          </div>
        )}
        {data.envioCosto > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Envío</span>
            <span className="font-semibold">{fmt(data.envioCosto)}</span>
          </div>
        )}
        <div className="flex items-end justify-between border-t pt-2">
          <span className="text-base font-bold">Total</span>
          <span className="text-3xl font-extrabold tabular-nums">{fmt(data.total)}</span>
        </div>
      </div>

      {/* Connection indicator */}
      <div className="flex items-center justify-center gap-1.5 border-t py-1.5">
        <span className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
        <span className="text-[10px] text-muted-foreground">En vivo</span>
      </div>
    </div>
  )
}
