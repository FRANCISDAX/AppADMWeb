import { CalendarDays, DollarSign, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/context/auth'
import { usePermisos } from '@/context/permisos'
import { useNotifications } from '@/components/notifications'
import { CATEGORIAS_EGRESO, actualizarEgreso, eliminarEgreso, obtenerEgresosPorFecha, registrarEgreso, registrarEgresoEnTurno, type Egreso } from '@/services/egresos'
import { buscarTurnoAbierto } from '@/services/turnos'
import { exportarExcel } from '@/lib/excel'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const inicioMes = () => { const d = new Date(); d.setDate(1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }

export default function Egresos() {
  const { user } = useAuth()
  const { tienePermiso } = usePermisos()
  const { toast, confirm } = useNotifications()

  const [desde, setDesde] = React.useState(inicioMes)
  const [hasta, setHasta] = React.useState(hoy)
  const [egresos, setEgresos] = React.useState<Egreso[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [turnoId, setTurnoId] = React.useState<string | null>(null)

  // Formulario
  const [formOpen, setFormOpen] = React.useState(false)
  const [editId, setEditId] = React.useState<string | null>(null)
  const [formFecha, setFormFecha] = React.useState('')
  const [formMonto, setFormMonto] = React.useState('')
  const [formDesc, setFormDesc] = React.useState('')
  const [formCat, setFormCat] = React.useState('Servicios')
  const [formTipo, setFormTipo] = React.useState<'caja' | 'transferencia' | 'otro'>('caja')
  const [formRuc, setFormRuc] = React.useState('')
  const [formProveedor, setFormProveedor] = React.useState('')
  const [formComprobante, setFormComprobante] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [buscandoRuc, setBuscandoRuc] = React.useState(false)

  const cargarEgresos = React.useCallback(async () => {
    setCargando(true)
    const data = await obtenerEgresosPorFecha(desde, hasta)
    setEgresos(data.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')))
    setCargando(false)
  }, [desde, hasta])

  React.useEffect(() => { cargarEgresos() }, [cargarEgresos])

  React.useEffect(() => {
    if (!user) return
    buscarTurnoAbierto(user.uid, tienePermiso('verTodo')).then((t) => {
      setTurnoId(t?.id ?? null)
    })
  }, [user, tienePermiso])

  // Auto-lookup RUC cuando se completan 11 dígitos
  React.useEffect(() => {
    if (formRuc.length !== 11 || !/^\d{11}$/.test(formRuc)) return
    let cancelled = false
    setBuscandoRuc(true)
    import('@/lib/consultaSunat').then(({ consultarRuc }) =>
      consultarRuc(formRuc).then((data) => {
        if (cancelled) return
        if (data?.nombre || data?.razonSocial) {
          const nombre = (data.nombre || data.razonSocial || '').trim()
          setFormProveedor(nombre)
          toast('✅ RUC encontrado: ' + nombre, 'success')
        } else {
          toast('⚠️ RUC no encontrado', 'warning')
        }
        setBuscandoRuc(false)
      })
    )
    return () => { cancelled = true }
  }, [formRuc, toast])

  const totalCaja = egresos.filter((e) => e.tipoPago === 'caja').reduce((s, e) => s + e.monto, 0)
  const totalTransferencia = egresos.filter((e) => e.tipoPago === 'transferencia').reduce((s, e) => s + e.monto, 0)
  const totalGeneral = egresos.reduce((s, e) => s + e.monto, 0)

  async function handleGuardar() {
    const monto = parseFloat(formMonto)
    if (!monto || monto <= 0) { toast('⚠️ Ingresá un monto válido', 'warning'); return }
    if (!formDesc.trim()) { toast('⚠️ Ingresá una descripción', 'warning'); return }

    setSaving(true)
    try {
      const base = {
        monto,
        descripcion: formDesc.trim(),
        categoria: formCat,
        tipoPago: formTipo,
        rucProveedor: formRuc.trim() || undefined,
        proveedorNombre: formProveedor.trim() || undefined,
        comprobante: formComprobante.trim() || undefined,
        fecha: formFecha || hoy(),
        usuarioId: user?.uid ?? '',
        usuarioNombre: user?.displayName ?? user?.email ?? '',
      }

      if (editId) {
        const res = await actualizarEgreso(editId, base)
        if (!res.success) { toast('❌ ' + (res.error || 'Error'), 'error'); setSaving(false); return }
      } else if (turnoId) {
        const res = await registrarEgresoEnTurno(base, turnoId)
        if (!res.success) { toast('❌ ' + (res.error || 'Error'), 'error'); setSaving(false); return }
      } else {
        const res = await registrarEgreso(base)
        if (!res.success) { toast('❌ ' + (res.error || 'Error'), 'error'); setSaving(false); return }
      }

      toast(editId ? '✅ Egreso actualizado' : '✅ Egreso registrado')
      setFormOpen(false)
      setEditId(null)
      setFormMonto(''); setFormDesc(''); setFormCat('Servicios'); setFormTipo('caja'); setFormRuc(''); setFormProveedor(''); setFormComprobante(''); setFormFecha('')
      cargarEgresos()
    } finally {
      setSaving(false)
    }
  }

  async function handleEliminar(e: Egreso) {
    const ok = await confirm({ title: 'Eliminar egreso', message: `¿Eliminar "${e.descripcion}" de ${fmt(e.monto)}?`, destructive: true })
    if (!ok) return
    await eliminarEgreso(e.id!)
    toast('✅ Egreso eliminado')
    cargarEgresos()
  }

  function abrirEdicion(e: Egreso) {
    setEditId(e.id!)
    setFormMonto(String(e.monto))
    setFormDesc(e.descripcion)
    setFormCat(e.categoria)
    setFormTipo(e.tipoPago)
    setFormRuc(e.rucProveedor ?? '')
    setFormProveedor(e.proveedorNombre ?? '')
    setFormComprobante(e.comprobante ?? '')
    setFormFecha(e.fecha?.slice(0, 10) ?? '')
    setFormOpen(true)
  }

  function handleExcel() {
    const rows = egresos.map((e) => [
      e.fecha?.slice(0, 10) ?? '',
      e.descripcion,
      e.categoria,
      e.tipoPago,
      e.proveedorNombre || e.rucProveedor || '',
      e.comprobante ?? '',
      e.monto,
    ])
    exportarExcel([{ name: 'Egresos', headers: ['Fecha', 'Descripción', 'Categoría', 'Tipo Pago', 'Proveedor', 'Comprobante', 'Monto'], rows }], 'Egresos')
  }

  if (!tienePermiso('egresos')) return <div className="p-8 text-center text-muted-foreground">No tenés acceso a este módulo.</div>

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-[150px]" />
          <span className="text-muted-foreground">a</span>
          <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-[150px]" />
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleExcel} disabled={egresos.length === 0}>
          Excel
        </Button>
        <Button size="sm" onClick={() => { setEditId(null); setFormFecha(''); setFormMonto(''); setFormDesc(''); setFormCat('Servicios'); setFormTipo('caja'); setFormRuc(''); setFormProveedor(''); setFormComprobante(''); setFormOpen(true) }}>
          <Plus className="h-4 w-4" /> Nuevo Egreso
        </Button>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Egresos Caja</div>
          <div className="num text-lg font-bold text-orange-600">{fmt(totalCaja)}</div>
          <div className="text-xs text-muted-foreground">{egresos.filter((e) => e.tipoPago === 'caja').length} registros</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Egresos Transferencia</div>
          <div className="num text-lg font-bold text-blue-600">{fmt(totalTransferencia)}</div>
          <div className="text-xs text-muted-foreground">{egresos.filter((e) => e.tipoPago === 'transferencia').length} registros</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs text-muted-foreground">Total Egresos</div>
          <div className="num text-lg font-bold">{fmt(totalGeneral)}</div>
          <div className="text-xs text-muted-foreground">{egresos.length} registros</div>
        </div>
      </div>

      {/* Lista */}
      {cargando ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : egresos.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Sin egresos en este período.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                <th className="px-3 py-2">Fecha</th>
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2">Categoría</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Proveedor</th>
                <th className="px-3 py-2">Comprobante</th>
                <th className="px-3 py-2 text-right">Monto</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {egresos.map((e) => (
                <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{e.fecha?.slice(0, 10)}</td>
                  <td className="px-3 py-2 font-medium">{e.descripcion}</td>
                  <td className="px-3 py-2 text-xs">{e.categoria}</td>
                  <td className="px-3 py-2">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold',
                      e.tipoPago === 'caja' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                        : e.tipoPago === 'transferencia' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                    )}>
                      {e.tipoPago}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{e.proveedorNombre || e.rucProveedor || '-'}</td>
                  <td className="px-3 py-2 text-xs">{e.comprobante ?? '-'}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right font-semibold">{fmt(e.monto)}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => abrirEdicion(e)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleEliminar(e)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal nuevo / editar egreso */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between bg-primary px-5 py-4 text-white">
              <p className="text-lg font-bold">{editId ? 'Editar Egreso' : 'Nuevo Egreso'}</p>
              <button onClick={() => { setFormOpen(false); setEditId(null) }} className="cursor-pointer"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-3 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Fecha</label>
                  <Input type="date" value={formFecha || hoy()} onChange={(e) => setFormFecha(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Monto (S/)</label>
                  <Input type="number" inputMode="decimal" placeholder="0.00" value={formMonto} onChange={(e) => setFormMonto(e.target.value)} className="num" autoFocus />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">Descripción</label>
                <Input placeholder="Ej: Pago luz eléctrica" value={formDesc} onChange={(e) => setFormDesc(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">Categoría</label>
                  <select value={formCat} onChange={(e) => setFormCat(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    {CATEGORIAS_EGRESO.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Tipo de pago</label>
                  <select value={formTipo} onChange={(e) => setFormTipo(e.target.value as typeof formTipo)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="caja">Caja</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="otro">Otro</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold">RUC proveedor</label>
                  <div className="relative">
                    <Input placeholder="10123456789" value={formRuc} onChange={(e) => setFormRuc(e.target.value)} maxLength={11} className="num pr-7" />
                    {buscandoRuc && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold">Nombre proveedor</label>
                  <Input placeholder="Se autollenó con RUC" value={formProveedor} onChange={(e) => setFormProveedor(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold">Comprobante (opcional)</label>
                <Input placeholder="N° factura/boleta" value={formComprobante} onChange={(e) => setFormComprobante(e.target.value)} />
              </div>
              {formTipo === 'caja' && !turnoId && (
                <p className="rounded-md bg-yellow-50 p-2 text-xs text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
                  No hay turno abierto. No se descontará de caja.
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
                <Button onClick={handleGuardar} disabled={saving || !formMonto || !formDesc.trim()}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <DollarSign className="h-4 w-4" />}
                  Registrar
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
