import { Plus, Users as UsersIcon } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { usePermisos } from '@/context/permisos'
import { activarDesactivarUsuario, obtenerUsuarios, type Usuario } from '@/services/usuarios'
import { useNotifications } from '@/components/notifications'
import { cn } from '@/lib/utils'
import { UsuarioDetalle } from '@/pages/UsuarioDetalle'

const ROLES_BADGE: Record<string, { bg: string; color: string }> = {
  ADMIN: { bg: 'bg-emerald-100 text-emerald-700', color: '' },
  GERENTE: { bg: 'bg-amber-100 text-amber-700', color: '' },
  CAJERO: { bg: 'bg-sky-100 text-sky-700', color: '' },
  PERSONALIZADO: { bg: 'bg-purple-100 text-purple-700', color: '' },
}

export function Usuarios() {
  const { tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [usuarios, setUsuarios] = React.useState<Usuario[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [editando, setEditando] = React.useState<string | 'new' | null>(null)

  const cargar = React.useCallback(async () => {
    setCargando(true)
    const lista = await obtenerUsuarios()
    setUsuarios(lista)
    setCargando(false)
  }, [])

  React.useEffect(() => {
    cargar()
  }, [cargar])

  async function toggleActivo(u: Usuario) {
    const nuevo = !u.activo
    const ok = await confirm({ title: nuevo ? 'Activar usuario' : 'Desactivar usuario', message: `¿${nuevo ? 'Activar' : 'Desactivar'} a ${u.nombre || u.email}?`, okText: nuevo ? 'Activar' : 'Desactivar' })
    if (!ok) return
    const r = await activarDesactivarUsuario(u.uid, nuevo)
    if (r.success) setUsuarios((prev) => prev.map((x) => (x.uid === u.uid ? { ...x, activo: nuevo } : x)))
    else toast(r.error || 'Error', 'error')
  }

  if (editando !== null) {
    return <UsuarioDetalle uid={editando === 'new' ? undefined : editando} onBack={() => setEditando(null)} onSaved={cargar} />
  }

  if (!tienePermiso('usuarios')) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <UsersIcon className="mx-auto mb-2 h-9 w-9 text-muted-foreground/40" />
        <p className="text-sm font-medium">No tenés acceso a Gestión de Usuarios</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{usuarios.length} usuario{usuarios.length !== 1 ? 's' : ''}</span>
        <Button onClick={() => setEditando('new')}>
          <Plus className="h-4 w-4" /> Nuevo Usuario
        </Button>
      </div>

      {cargando ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : (
        <div className="space-y-2">
          {usuarios.map((u) => {
            const badge = ROLES_BADGE[u.rol || 'CAJERO'] || ROLES_BADGE.CAJERO
            return (
              <div key={u.uid} className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-soft hover:shadow-card">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {(u.nombre || u.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{u.nombre || u.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                  <span className={cn('mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold', badge.bg)}>{u.rol || 'CAJERO'}</span>
                </div>
                <label className="flex items-center gap-2">
                  <button onClick={() => setEditando(u.uid)} className="text-sm font-semibold text-primary hover:underline cursor-pointer">Editar</button>
                  <input type="checkbox" checked={u.activo !== false} onChange={() => toggleActivo(u)} className="h-5 w-5 accent-primary" />
                </label>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
