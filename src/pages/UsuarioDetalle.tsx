import { KeyRound, Loader2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LABELS_PERMISOS, MODULOS, PERMISOS_POR_ROL, ROLES, permisosPorRol } from '@/constants/permisos'
import { useNotifications } from '@/components/notifications'
import { crearUsuario, editarUsuario, obtenerUsuarios, resetearPassword } from '@/services/usuarios'
import { cn } from '@/lib/utils'

export function UsuarioDetalle({ uid, onBack, onSaved }: { uid?: string; onBack: () => void; onSaved: () => void }) {
  const esEdicion = !!uid
  const { toast, confirm } = useNotifications()
  const [nombre, setNombre] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [rol, setRol] = React.useState('CAJERO')
  const [permisos, setPermisos] = React.useState<Record<string, boolean>>(permisosPorRol('CAJERO'))
  const [activo, setActivo] = React.useState(true)
  const [serieBoleta, setSerieBoleta] = React.useState('')
  const [serieFactura, setSerieFactura] = React.useState('')
  const [seriePrefijo, setSeriePrefijo] = React.useState('')
  const [guardando, setGuardando] = React.useState(false)
  const [reseteando, setReseteando] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!esEdicion) return
    ;(async () => {
      const lista = await obtenerUsuarios()
      const u = lista.find((x) => x.uid === uid)
      if (u) {
        setNombre(u.nombre || '')
        setEmail(u.email || '')
        setRol(u.rol || 'CAJERO')
        // Fusiona los permisos guardados con los defaults del rol: así los permisos
        // nuevos (ej. 'estadisticas') quedan con un valor real y se pueden desactivar
        // guardando false (bloquea de verdad) sin romper las claves que ya existían.
        setPermisos({ ...permisosPorRol(u.rol || 'CAJERO'), ...(u.permisos || {}) })
        setActivo(u.activo !== false)
        setSerieBoleta(u.serieBoleta || '')
        setSerieFactura(u.serieFactura || '')
        setSeriePrefijo(u.seriePrefijo || '')
      }
    })()
  }, [uid, esEdicion])

  function cambiarRol(nuevoRol: string) {
    setRol(nuevoRol)
    if (nuevoRol !== 'PERSONALIZADO') setPermisos({ ...PERMISOS_POR_ROL[nuevoRol] })
  }
  function togglePermiso(clave: string) {
    setPermisos((prev) => ({ ...prev, [clave]: !prev[clave] }))
  }
  function toggleSeccion(claves: string[]) {
    setPermisos((prev) => {
      const allOn = claves.every((k) => prev[k])
      const next = { ...prev }
      claves.forEach((k) => (next[k] = !allOn))
      return next
    })
  }

  async function guardar() {
    setError(null)
    if (!nombre.trim()) return setError('Ingresa el nombre')
    if (!email.trim()) return setError('Ingresa el email')
    if (!esEdicion && password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres')
    setGuardando(true)
    try {
      if (esEdicion && uid) {
        await editarUsuario(uid, { nombre: nombre.trim(), rol, permisos, activo, serieBoleta: serieBoleta.trim(), serieFactura: serieFactura.trim(), seriePrefijo: seriePrefijo.trim() })
      } else {
        await crearUsuario({ email: email.trim().toLowerCase(), password, nombre: nombre.trim(), rol, permisos, serieBoleta: serieBoleta.trim(), serieFactura: serieFactura.trim(), seriePrefijo: seriePrefijo.trim() })
      }
      onSaved()
      onBack()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  async function resetear() {
    if (!email.trim()) return
    const ok = await confirm({ title: 'Restablecer contraseña', message: `¿Enviar correo de restablecimiento a ${email.trim()}?`, okText: 'Enviar' })
    if (!ok) return
    setReseteando(true)
    const r = await resetearPassword(email.trim())
    setReseteando(false)
    toast(r.success ? `Email enviado a ${email.trim()}` : (r.error || 'Error'), r.success ? 'success' : 'error')
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-muted-foreground hover:text-foreground cursor-pointer" aria-label="Volver">←</button>
        <h2 className="text-lg font-bold">{esEdicion ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-card space-y-3">
        <div>
          <Label>Nombre</Label>
          <Input value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1" />
        </div>
        <div>
          <Label>Email</Label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled={esEdicion} className="mt-1" />
        </div>
        {!esEdicion && (
          <div>
            <Label>Contraseña</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mínimo 6 caracteres" className="mt-1" />
          </div>
        )}

        <div>
          <Label>Rol</Label>
          <div className="mt-1 grid grid-cols-4 gap-1.5">
            {ROLES.map((r) => (
              <button key={r} onClick={() => cambiarRol(r)} className={cn('h-10 rounded-lg text-xs font-bold border cursor-pointer', rol === r ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border p-3">
          <p className="mb-2 text-sm font-bold">Series de comprobantes (por caja)</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Si se dejan vacías, este usuario usa la serie global de la empresa (Configuración → Empresa). Cada caja debe tener series distintas por tipo.</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Serie Boletas</Label>
              <Input value={serieBoleta} onChange={(e) => setSerieBoleta(e.target.value.toUpperCase())} placeholder="B001" className="mt-1" />
            </div>
            <div>
              <Label>Serie Facturas</Label>
              <Input value={serieFactura} onChange={(e) => setSerieFactura(e.target.value.toUpperCase())} placeholder="F001" className="mt-1" />
            </div>
            <div>
              <Label>Serie Nota Venta</Label>
              <Input value={seriePrefijo} onChange={(e) => setSeriePrefijo(e.target.value.toUpperCase())} placeholder="NV01" className="mt-1" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Vacíos → serie global. Ej.: caja admin = B001/F001, caja 2 = B002/F002.</p>
        </div>

        <div className="space-y-3 pt-2">
          {MODULOS.map((sec) => {
            const allOn = sec.permisos.every((k) => permisos[k])
            return (
              <div key={sec.key} className="rounded-xl border">
                <button onClick={() => toggleSeccion(sec.permisos)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-bold cursor-pointer">
                  <span>{sec.label}</span>
                  <span className="text-xs text-muted-foreground">{allOn ? 'Todo ✓' : 'Parcial'}</span>
                </button>
                <div className="grid grid-cols-2 gap-1 px-3 pb-3 sm:grid-cols-3">
                  {sec.permisos.map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2 text-xs">
                      <input type="checkbox" checked={!!permisos[k]} onChange={() => togglePermiso(k)} className="h-3.5 w-3.5 accent-primary" />
                      {LABELS_PERMISOS[k] || k}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} className="h-4 w-4 accent-primary" />
          Usuario activo
        </label>

        {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {esEdicion && (
          <Button variant="secondary" onClick={resetear} disabled={reseteando}>
            {reseteando ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            {reseteando ? 'Enviando…' : 'Restablecer Clave'}
          </Button>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" className="flex-1" onClick={onBack}>Cancelar</Button>
          <Button className="flex-1" onClick={guardar} disabled={guardando}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar Cambios' : 'Crear Usuario'}
          </Button>
        </div>
      </div>
    </div>
  )
}
