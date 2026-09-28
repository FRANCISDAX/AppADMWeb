/**
 * **La ruta pública del link de pedidos** (`/pedido`).
 *
 * Vive en su propio archivo por dos motivos: (1) el `lazy()` deja la vidriera en **su propio chunk**, así el app
 * de adentro no carga nada de esto; y (2) mantiene `main.tsx` como puro cableado (sin componentes declarados
 * ahí, que es lo que el lint de *fast refresh* pide).
 *
 * ⚠️ **No envuelve con `AuthProvider` ni `PermisosProvider`**: la abre un cliente sin sesión.
 */
import * as React from 'react'

const PedidoPublico = React.lazy(() =>
  import('@/pages/PedidoPublico').then((m) => ({ default: m.PedidoPublico })),
)

export function RutaPedidoPublico() {
  return (
    <React.Suspense fallback={null}>
      <PedidoPublico />
    </React.Suspense>
  )
}
