import { signInWithEmailAndPassword } from 'firebase/auth'
import { Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck } from 'lucide-react'
import * as React from 'react'
import { auth } from '@/lib/firebase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function Login() {
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [show, setShow] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  // Si ya hay sesión, la app shell redirige; aquí mostramos login.
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim() || !password) {
      setError('Ingresa el correo y la contraseña.')
      return
    }
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
      // onAuthStateChanged del provider actualiza `user`
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      setError(
        code === 'auth/invalid-credential' || code === 'auth/invalid-email'
          ? 'Correo o contraseña incorrectos.'
          : code === 'auth/inactive-user'
            ? 'Este usuario está desactivado.'
            : 'No se pudo iniciar sesión. Revisa la conexión.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app bg-background px-4">
      <div className="w-full max-w-sm space-y-6 animate-slide-up">
        {/* Marca */}
        <div className="flex flex-col items-center space-y-2">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-border">
            <img src="/jorfel.png" alt="AppADM" className="h-full w-full object-contain" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold tracking-tight">AppADM</h1>
            <p className="text-sm text-muted-foreground">Punto de Venta · Inicia sesión</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="glass rounded-3xl p-8 shadow-card ring-1 ring-black/5 space-y-4 animate-scale-in">
          <div className="space-y-2">
            <Label htmlFor="email">Correo electrónico</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="usuario@correo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" size="lg" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? 'Ingresando…' : 'Ingresar'}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Acceso restringido · Administra tus usuarios con permisos desde la app.
        </p>
      </div>
    </div>
  )
}
