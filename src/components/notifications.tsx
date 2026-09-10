import { AlertTriangle, CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ToastVariant = 'success' | 'error' | 'warning' | 'info'
type ToastItem = { id: number; message: string; variant: ToastVariant }
type ConfirmOpts = { title?: string; message: string; okText?: string; cancelText?: string; destructive?: boolean }

type NotifCtx = {
  toast: (message: string, variant?: ToastVariant) => void
  confirm: (opts: ConfirmOpts | string) => Promise<boolean>
}

const Ctx = createContext<NotifCtx | null>(null)

const emojiVariant = (msg: string): ToastVariant => {
  const first = msg.trim().split(/\s+/)[0]
  if (first === '❌' || first === '🚫' || first === '✖') return 'error'
  if (first === '⚠️' || first === '🚧') return 'warning'
  if (first === '✅' || first === 'ℹ️' || first === '✔' || first === '📧') return 'success'
  return 'info'
}
const stripEmoji = (msg: string) => {
  const first = msg.trim().split(/\s+/)[0]
  // Si el primer token no empieza por letra/número (es un emoji/símbolo), se quita.
  if (/^[^\p{L}\p{N}]/u.test(first)) return msg.trim().slice(first.length).trim()
  return msg.trim()
}

const VARIANT_CLS: Record<ToastVariant, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  error: 'border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300',
}
const VARIANT_ICON: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 shrink-0" />,
  error: <XCircle className="h-5 w-5 shrink-0" />,
  warning: <AlertTriangle className="h-5 w-5 shrink-0" />,
  info: <Info className="h-5 w-5 shrink-0" />,
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [confirmState, setConfirmState] = useState<ConfirmOpts | null>(null)
  const confirmResolve = useRef<((v: boolean) => void) | null>(null)
  const idRef = useRef(0)

  const toast = useCallback((message: string, variant?: ToastVariant) => {
    const id = ++idRef.current
    const v = variant || emojiVariant(message)
    setToasts((p) => [...p, { id, message: stripEmoji(message), variant: v }])
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000)
  }, [])

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve
      setConfirmState(typeof opts === 'string' ? { message: opts } : opts)
    })
  }, [])

  const closeConfirm = useCallback((v: boolean) => {
    setConfirmState(null)
    confirmResolve.current?.(v)
    confirmResolve.current = null
  }, [])

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <Ctx.Provider value={value}>
      {children}

      {/* Toasts arriba */}
      <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div key={t.id} className={cn('pointer-events-auto flex w-full items-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg', VARIANT_CLS[t.variant])}>
            {VARIANT_ICON[t.variant]}
            <span className="flex-1 whitespace-pre-line">{t.message}</span>
            <button onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))} className="text-current/60 hover:text-current cursor-pointer" aria-label="Cerrar notificación"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>

      {/* Confirmación */}
      {confirmState && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
            <h2 className="text-lg font-extrabold">{confirmState.title || 'Confirmar'}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{confirmState.message}</p>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => closeConfirm(false)}>{confirmState.cancelText || 'Cancelar'}</Button>
              <Button className={cn('flex-1', confirmState.destructive && 'bg-red-600 hover:bg-red-700')} onClick={() => closeConfirm(true)}>{confirmState.okText || 'Confirmar'}</Button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useNotifications() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useNotifications debe usarse dentro de <NotificationsProvider>')
  return c
}
