import { ArrowLeft, Loader2, Pen, Save, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications'
import { cn } from '@/lib/utils'
import { type Proveedor, type ContactoProveedor, obtenerProveedor, guardarProveedor, eliminarProveedor, consultarProveedor } from '@/services/proveedores'
import { ProveedorHistorial } from '@/components/ProveedorHistorial'

const fmtFecha = (iso?: string) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}

type Form = {
  nombre: string
  documento: string
  tipoDocumento: 'RUC' | 'DNI'
  direccion: string
  telefono: string
  correo: string
  notas: string
  activo: boolean
  contactos: ContactoProveedor[]
}

const VACIO: Form = { nombre: '', documento: '', tipoDocumento: 'RUC', direccion: '', telefono: '', correo: '', notas: '', activo: true, contactos: [] }

export function ProveedorDetalle({ clave, nuevo, onBack }: { clave?: string; nuevo?: boolean; onBack: () => void }) {
  const esNuevo = !!nuevo && !clave
  const { toast, confirm } = useNotifications()
  const [proveedor, setProveedor] = React.useState<Proveedor | null>(null)
  const [editando, setEditando] = React.useState(esNuevo)
  const [cargando, setCargando] = React.useState(!esNuevo)
  const [guardando, setGuardando] = React.useState(false)
  const [consultandoSunat, setConsultandoSunat] = React.useState(false)
  const [numDocInput, setNumDocInput] = React.useState('')
  const [form, setForm] = React.useState<Form>(VACIO)

  React.useEffect(() => {
    if (esNuevo || !clave) return
    setCargando(true)
    obtenerProveedor(clave).then((p) => {
      if (p) {
        setProveedor(p)
        setForm({
          nombre: p.nombre ?? '',
          documento: p.documento ?? '',
          tipoDocumento: p.tipoDocumento || 'RUC',
          direccion: p.direccion ?? '',
          telefono: p.telefono ?? '',
          correo: p.correo ?? '',
          notas: p.notas ?? '',
          activo: p.activo !== false,
          contactos: p.contactos ?? [],
        })
        setNumDocInput(p.documento ?? '')
      }
      setCargando(false)
    })
  }, [clave, esNuevo])

  async function buscarSunat() {
    const id = numDocInput.trim()
    if (id.length < 8) { toast('Ingresá un DNI (8) o RUC (11)', 'warning'); return }
    setConsultandoSunat(true)
    try {
      const p = await consultarProveedor(id)
      if (p) {
        setForm((f) => ({ ...f, nombre: p.nombre, documento: p.documento, tipoDocumento: p.tipoDocumento, direccion: p.direccion || f.direccion }))
        setNumDocInput(p.documento)
        toast('Datos obtenidos de SUNAT', 'success')
      } else {
        toast('No se encontró el documento', 'warning')
      }
    } catch {
      toast('Sin conexión a SUNAT', 'warning')
    }
    setConsultandoSunat(false)
  }

  async function handleGuardar() {
    if (!form.nombre.trim()) { toast('El nombre es obligatorio', 'warning'); return }
    setGuardando(true)
    try {
      const data: Proveedor = {
        id: clave,
        nombre: form.nombre.trim(),
        documento: form.documento.trim(),
        tipoDocumento: form.tipoDocumento,
        direccion: form.direccion.trim(),
        telefono: form.telefono.trim(),
        correo: form.correo.trim(),
        notas: form.notas.trim(),
        activo: form.activo,
        contactos: form.contactos,
      }
      const r = await guardarProveedor(data)
      if (r.success) {
        toast(esNuevo ? 'Proveedor creado' : 'Proveedor actualizado', 'success')
        if (esNuevo && r.id) {
          setProveedor({ ...data, id: r.id })
          setEditando(false)
        } else {
          setProveedor({ ...data, id: clave })
          setEditando(false)
        }
      } else {
        toast('Error al guardar', 'error')
      }
    } catch {
      toast('Error al guardar', 'error')
    }
    setGuardando(false)
  }

  async function handleEliminar() {
    if (!clave) return
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      const { COL } = await import('@/constants/colecciones')
      const q = query(collection(db, COL.MOVIMIENTOS), where('tipoMovimiento', '==', 'compra'))
      const snap = await getDocs(q)
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
      const claveNorm = norm(clave)
      const nombreNorm = norm(form.nombre)
      const tieneCompras = snap.docs.some((d) => {
        const meta = (d.data().metadata || {}) as Record<string, unknown>
        const provId = (meta.proveedorId as string) || ''
        const provNombre = (meta.proveedor as string) || ''
        return norm(provId) === claveNorm || norm(provNombre) === nombreNorm
      })
      if (tieneCompras) {
        toast('No se puede eliminar: este proveedor tiene compras registradas.', 'warning')
        return
      }
    } catch { /* si falla la verificación, permitir eliminar */ }
    const ok = await confirm({ title: 'Eliminar proveedor', message: `¿Eliminar "${form.nombre}"? Esta acción no se puede deshacer.`, okText: 'Eliminar', destructive: true })
    if (!ok) return
    const r = await eliminarProveedor(clave)
    if (r) {
      toast('Proveedor eliminado', 'success')
      onBack()
    } else {
      toast('Error al eliminar', 'error')
    }
  }

  function agregarContacto() {
    setForm((f) => ({ ...f, contactos: [...f.contactos, { nombre: '', cargo: '', telefono: '', email: '' }] }))
  }

  function actualizarContacto(idx: number, campo: keyof ContactoProveedor, valor: string) {
    setForm((f) => ({ ...f, contactos: f.contactos.map((c, i) => i === idx ? { ...c, [campo]: valor } : c) }))
  }

  function eliminarContacto(idx: number) {
    setForm((f) => ({ ...f, contactos: f.contactos.filter((_, i) => i !== idx) }))
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-9 w-9"><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-xl font-extrabold">{esNuevo ? 'Nuevo Proveedor' : proveedor?.nombre || 'Proveedor'}</h1>
        {!esNuevo && !editando && (
          <Button variant="outline" size="sm" onClick={() => setEditando(true)} className="ml-auto gap-1.5"><Pen className="h-3.5 w-3.5" /> Editar</Button>
        )}
      </div>

      {/* Formulario */}
      <div className="rounded-2xl border bg-card p-5 shadow-card space-y-4">
        {/* SUNAT lookup */}
        {(esNuevo || editando) && (
          <div>
            <Label>Buscar en SUNAT</Label>
            <div className="mt-1 flex gap-2">
              <Input value={numDocInput} onChange={(e) => setNumDocInput(e.target.value.replace(/[^0-9]/g, '').slice(0, 11))} placeholder="RUC (11) o DNI (8)" inputMode="numeric" className="flex-1" />
              <Button variant="secondary" onClick={buscarSunat} disabled={consultandoSunat}>
                {consultandoSunat ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {consultandoSunat ? 'Buscando…' : 'Consultar SUNAT'}
              </Button>
            </div>
          </div>
        )}

        {/* Nombre */}
        <div>
          <Label>Nombre / Razón Social *</Label>
          <Input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} disabled={!editando} className="mt-1" />
        </div>

        {/* Documento */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label>Tipo</Label>
            <div className="mt-1 flex gap-1 rounded-xl bg-muted p-1">
              {(['RUC', 'DNI'] as const).map((t) => (
                <button key={t} onClick={() => setForm({ ...form, tipoDocumento: t })} disabled={!editando}
                  className={cn('flex-1 rounded-lg py-1.5 text-xs font-bold cursor-pointer', form.tipoDocumento === t ? 'bg-background shadow-sm' : 'text-muted-foreground')}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2">
            <Label>N° Documento</Label>
            <Input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value.replace(/[^0-9]/g, '').slice(0, 11) })} disabled={!editando} className="mt-1" />
          </div>
        </div>

        {/* Dirección */}
        <div>
          <Label>Dirección</Label>
          <Input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} disabled={!editando} className="mt-1" />
        </div>

        {/* Teléfono + Email */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Teléfono</Label>
            <Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} disabled={!editando} className="mt-1" />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} disabled={!editando} className="mt-1" />
          </div>
        </div>

        {/* Notas */}
        <div>
          <Label>Notas</Label>
          <Input value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} disabled={!editando} placeholder="Observaciones, condiciones, etc." className="mt-1" />
        </div>

        {/* Activo */}
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={form.activo} onChange={(e) => setForm({ ...form, activo: e.target.checked })} disabled={!editando} className="h-4 w-4 accent-primary" />
          <Label>Activo</Label>
        </div>

        {/* Contactos */}
        {(editando || form.contactos.length > 0) && (
          <div>
            <div className="flex items-center justify-between">
              <Label>Contactos</Label>
              {editando && <Button variant="outline" size="sm" onClick={agregarContacto}>+ Agregar</Button>}
            </div>
            <div className="mt-2 space-y-3">
              {form.contactos.map((c, idx) => (
                <div key={idx} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">Contacto {idx + 1}</span>
                    {editando && (
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => eliminarContacto(idx)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={c.nombre} onChange={(e) => actualizarContacto(idx, 'nombre', e.target.value)} placeholder="Nombre" disabled={!editando} className="text-xs" />
                    <Input value={c.cargo} onChange={(e) => actualizarContacto(idx, 'cargo', e.target.value)} placeholder="Cargo" disabled={!editando} className="text-xs" />
                    <Input value={c.telefono} onChange={(e) => actualizarContacto(idx, 'telefono', e.target.value)} placeholder="Teléfono" disabled={!editando} className="text-xs" />
                    <Input value={c.email} onChange={(e) => actualizarContacto(idx, 'email', e.target.value)} placeholder="Email" disabled={!editando} className="text-xs" />
                  </div>
                </div>
              ))}
              {form.contactos.length === 0 && !editando && (
                <p className="text-xs text-muted-foreground">Sin contactos registrados</p>
              )}
            </div>
          </div>
        )}

        {/* Acciones */}
        <div className="flex gap-2 pt-2">
          {editando ? (
            <>
              <Button variant="outline" onClick={() => { setEditando(false); if (esNuevo) onBack() }} className="flex-1">Cancelar</Button>
              <Button onClick={handleGuardar} disabled={guardando} className="flex-1">
                {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="destructive" onClick={handleEliminar} className="flex-1">
                <Trash2 className="h-4 w-4" /> Eliminar
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Info de registro */}
      {!esNuevo && proveedor && (
        <div className="rounded-2xl border bg-card p-4 shadow-card text-xs text-muted-foreground space-y-1">
          <p>Registrado: {fmtFecha(proveedor.fechaRegistro)}</p>
          {proveedor.updatedAt && <p>Última actualización: {fmtFecha(proveedor.updatedAt)}</p>}
        </div>
      )}

      {/* Historial de compras y pagos */}
      {!esNuevo && proveedor && clave && (
        <div className="rounded-2xl border bg-card p-5 shadow-card space-y-3">
          <h2 className="text-sm font-extrabold">Historial</h2>
          <ProveedorHistorial proveedorId={clave} proveedorNombre={proveedor.nombre} saldoPendiente={proveedor.saldoPendiente || 0} />
        </div>
      )}
    </div>
  )
}
