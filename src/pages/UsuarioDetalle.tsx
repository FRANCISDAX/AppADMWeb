import { AlertTriangle, KeyRound, Loader2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LABELS_PERMISOS, MODULOS, PERMISOS_POR_ROL, ROLES, permisosPorRol } from '@/constants/permisos'
import { useNotifications } from '@/components/notifications'
import { crearUsuario, editarUsuario, obtenerUsuarios, resetearPassword, validarSeriesUsuario } from '@/services/usuarios'
import { type ConflictoSerie, type SeriesUsuario, mensajeConflictos } from '@/lib/series'
import { cargarCajas, type Caja } from '@/services/cajas'
import { cn } from '@/lib/utils'

// Campos de serie que el admin configura por caja (7: los 3 de venta + 4 de notas).
const CAMPOS_SERIE_UI: { campo: keyof SeriesUsuario; label: string; placeholder: string }[] = [
  { campo: 'serieBoleta', label: 'Serie Boletas', placeholder: 'B001' },
  { campo: 'serieFactura', label: 'Serie Facturas', placeholder: 'F001' },
  { campo: 'seriePrefijo', label: 'Serie Nota Venta', placeholder: 'NV01' },
  { campo: 'serieBoletaNC', label: 'NC Boletas', placeholder: 'BC01' },
  { campo: 'serieBoletaND', label: 'ND Boletas', placeholder: 'BD01' },
  { campo: 'serieFacturaNC', label: 'NC Facturas', placeholder: 'FC01' },
  { campo: 'serieFacturaND', label: 'ND Facturas', placeholder: 'FD01' },
]

export function UsuarioDetalle({ uid, onBack, onSaved }: { uid?: string; onBack: () => void; onSaved: () => void }) {
  const esEdicion = !!uid
  const { toast, confirm } = useNotifications()
  const [nombre, setNombre] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [rol, setRol] = React.useState('CAJERO')
  const [permisos, setPermisos] = React.useState<Record<string, boolean>>(permisosPorRol('CAJERO'))
  const [activo, setActivo] = React.useState(true)
  const [series, setSeries] = React.useState<SeriesUsuario>({})
  const [guardando, setGuardando] = React.useState(false)
  const [reseteando, setReseteando] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [conflictosSeries, setConflictosSeries] = React.useState<ConflictoSerie[]>([])
  const [revisandoSeries, setRevisandoSeries] = React.useState(false)
  const [cajas, setCajas] = React.useState<Caja[]>([])
  const [cajaId, setCajaId] = React.useState('')

  React.useEffect(() => {
    cargarCajas().then(setCajas)
  }, [])

  React.useEffect(() => {
    if (!esEdicion) return
    ;(async () => {
      const lista = await obtenerUsuarios()
      const u = lista.find((x) => x.uid === uid)
      if (u) {
        setNombre(u.nombre || '')
        setEmail(u.email || '')
        setRol(u.rol || 'CAJERO')
        setPermisos({ ...permisosPorRol(u.rol || 'CAJERO'), ...(u.permisos || {}) })
        setActivo(u.activo !== false)
        setCajaId(u.cajaId || '')
        setSeries({
          serieBoleta: u.serieBoleta || '',
          serieFactura: u.serieFactura || '',
          seriePrefijo: u.seriePrefijo || '',
          serieBoletaNC: u.serieBoletaNC || '',
          serieBoletaND: u.serieBoletaND || '',
          serieFacturaNC: u.serieFacturaNC || '',
          serieFacturaND: u.serieFacturaND || '',
        })
      }
    })()
  }, [uid, esEdicion])

  // Series: cada caja debe numerar con su propia serie. Dos cajas con la misma
  // serie comparten el contador `sunat_{serie}` / `notaVenta_{serie}` de
  // Firestore, así que se avisa (y se bloquea) antes de guardar.
  React.useEffect(() => {
    let vigente = true
    const timer = setTimeout(() => {
      if (!vigente) return
      setRevisandoSeries(true)
      validarSeriesUsuario(series, uid)
        .then((c) => {
          if (vigente) setConflictosSeries(c)
        })
        .catch((e) => {
          console.error('❌ validarSeriesUsuario:', e)
          if (vigente) setConflictosSeries([])
        })
        .finally(() => {
          if (vigente) setRevisandoSeries(false)
        })
    }, 300)
    return () => {
      vigente = false
      clearTimeout(timer)
    }
  }, [series, uid])

  const erroresSeries = conflictosSeries.filter((c) => c.bloqueante)
  const avisosSeries = conflictosSeries.filter((c) => !c.bloqueante)

  function setSerie(campo: keyof SeriesUsuario, valor: string) {
    setSeries((prev) => ({ ...prev, [campo]: valor }))
  }

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
    if (erroresSeries.length > 0) return setError(mensajeConflictos(erroresSeries))
    setGuardando(true)
    try {
      const r: { success: boolean; error?: string } =
        esEdicion && uid
          ? await editarUsuario(uid, { nombre: nombre.trim(), rol, permisos, activo, cajaId: cajaId || undefined, ...series })
          : await crearUsuario({ email: email.trim().toLowerCase(), password, nombre: nombre.trim(), rol, permisos, cajaId: cajaId || undefined, ...series })
      if (!r.success) {
        setError(r.error || 'No se pudo guardar el usuario.')
        return
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
          <div className="mt-1 grid grid-cols-5 gap-1.5">
            {ROLES.map((r) => (
              <button key={r} onClick={() => cambiarRol(r)} className={cn('h-10 rounded-lg text-xs font-bold border cursor-pointer', rol === r ? 'bg-primary text-white border-primary' : 'bg-background hover:bg-accent')}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {(rol === 'VENDEDOR' || rol === 'CAJERO') && (
          <div>
            <Label>Caja asignada</Label>
            <p className="text-[11px] text-muted-foreground mb-1">El vendedor cajero usará las series de esta caja. Si no asignas una, se usa la serie global.</p>
            <select value={cajaId} onChange={(e) => setCajaId(e.target.value)} className="mt-1 flex h-10 w-full rounded-lg border bg-background px-3 py-2 text-sm">
              <option value="">Sin caja asignada (serie global)</option>
              {cajas.filter((c) => c.activo).map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}{c.serieBoleta ? ` (${c.serieBoleta}/${c.serieFactura})` : ''}</option>
              ))}
            </select>
          </div>
        )}

        <div className="rounded-xl border p-3">
          <p className="mb-2 text-sm font-bold">Series de comprobantes (por caja)</p>
          <p className="mb-2 text-[11px] text-muted-foreground">Si se dejan vacías, este usuario usa la serie global de la empresa (Configuración → Empresa). Cada caja debe tener series distintas por tipo.</p>
          <div className="grid grid-cols-3 gap-2">
            {CAMPOS_SERIE_UI.slice(0, 3).map(({ campo, label, placeholder }) => (
              <div key={campo}>
                <Label>{label}</Label>
                <Input value={series[campo] ?? ''} onChange={(e) => setSerie(campo, e.target.value.toUpperCase())} placeholder={placeholder} className="mt-1" />
              </div>
            ))}
          </div>
          <p className="mt-3 mb-2 text-[11px] font-bold text-muted-foreground">Notas de crédito y débito</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CAMPOS_SERIE_UI.slice(3).map(({ campo, label, placeholder }) => (
              <div key={campo}>
                <Label>{label}</Label>
                <Input value={series[campo] ?? ''} onChange={(e) => setSerie(campo, e.target.value.toUpperCase())} placeholder={placeholder} className="mt-1" />
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">Vacíos → serie global. Ej.: caja admin = B001/F001, caja 2 = B002/F002 (y BC02/FD02 para sus notas).</p>
          {revisandoSeries && <p className="mt-2 text-[10px] text-muted-foreground">Revisando que las series no choquen con otras cajas…</p>}
          {erroresSeries.map((c, i) => (
            <p key={`error-${i}-${c.motivo}-${c.serie}`} className="mt-2 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{c.mensaje}</span>
            </p>
          ))}
          {avisosSeries.map((c, i) => (
            <p key={`aviso-${i}-${c.motivo}-${c.serie}`} className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-600 dark:text-amber-500">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{c.mensaje}</span>
            </p>
          ))}
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
          <Button className="flex-1" onClick={guardar} disabled={guardando || erroresSeries.length > 0} title={erroresSeries.length > 0 ? 'Corrige las series duplicadas para guardar' : undefined}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {guardando ? 'Guardando…' : esEdicion ? 'Guardar Cambios' : 'Crear Usuario'}
          </Button>
        </div>
      </div>
    </div>
  )
}
