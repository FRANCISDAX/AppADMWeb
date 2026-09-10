import * as React from 'react'
import type { Producto } from '@/hooks/use-productos'

/** Escapa caracteres HTML peligrosos para prevenir XSS en templates. */
export function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export const fmt = (n: number) => 'S/ ' + n.toFixed(2)

export function estadoStock(p: Producto) {
  const stock = p.stock ?? 0
  const min = p.minStock ?? 0
  if (stock === 0) return { label: 'AGOTADO', variant: 'destructive' as const }
  if (stock <= min) return { label: 'BAJO', variant: 'warning' as const }
  return { label: 'OK', variant: 'success' as const }
}

export function useToast(duration = 2200) {
  const [toast, setToast] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), duration)
    return () => clearTimeout(t)
  }, [toast, duration])
  return { toast, setToast } as const
}

export function estadoVencimiento(fechaVencimiento?: string | null) {
  if (!fechaVencimiento) return { dias: null, label: null, variant: null as 'destructive' | 'warning' | 'success' | null }
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const venc = new Date(fechaVencimiento + 'T00:00:00')
  const diffMs = venc.getTime() - hoy.getTime()
  const dias = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  if (dias < 0) return { dias, label: `Vencido (${Math.abs(dias)}d)`, variant: 'destructive' as const }
  if (dias <= 7) return { dias, label: `${dias}d`, variant: 'warning' as const }
  if (dias <= 30) return { dias, label: `${dias}d`, variant: 'success' as const }
  return { dias, label: `${dias}d`, variant: null }
}
