import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Tags, Trash2, Upload, X } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useNotifications } from '@/components/notifications'
import { useCategorias } from '@/hooks/use-categorias'
import {
  ICONOS_CATEGORIA,
  ICONO_POR_DEFECTO,
  contarProductosPorCategoria,
  eliminarCategoria,
  guardarCategoria,
  importarCategoriasDesdeProductos,
  type Categoria,
} from '@/services/categorias'
import { cn } from '@/lib/utils'

/**
 * Administración de las categorías de producto (`tblCategorias`).
 *
 * El nombre es la clave que guarda el producto, así que renombrar acá actualiza
 * los productos que la usaban. No se puede borrar una categoría en uso: se
 * desactiva para que deje de aparecer en los filtros y en el formulario.
 */
export function CategoriasTab() {
  const { toast, confirm } = useNotifications()
  const { categorias, loading } = useCategorias()
  const [conteos, setConteos] = React.useState<Record<string, number>>({})
  const [nombre, setNombre] = React.useState('')
  const [icono, setIcono] = React.useState(ICONO_POR_DEFECTO)
  const [guardando, setGuardando] = React.useState(false)
  const [importando, setImportando] = React.useState(false)
  const [editando, setEditando] = React.useState<{ id: string; nombre: string; icono: string } | null>(null)

  const recargarConteos = React.useCallback(() => contarProductosPorCategoria().then(setConteos), [])

  React.useEffect(() => {
    let vigente = true
    contarProductosPorCategoria()
      .then((c) => {
        if (vigente) setConteos(c)
      })
      .catch((e) => console.error('❌ Conteo de productos por categoría:', e))
    return () => {
      vigente = false
    }
  }, [])

  async function crear() {
    if (!nombre.trim()) return toast('Escribí el nombre de la categoría', 'error')
    setGuardando(true)
    const r = await guardarCategoria({ nombre, icono })
    setGuardando(false)
    if (!r.success) return toast(r.error || 'No se pudo crear', 'error')
    setNombre('')
    setIcono(ICONO_POR_DEFECTO)
    toast(`Categoría "${nombre.trim()}" creada`, 'success')
  }

  async function guardarEdicion() {
    if (!editando) return
    if (!editando.nombre.trim()) return toast('El nombre no puede quedar vacío', 'error')
    const original = categorias.find((c) => c.id === editando.id)
    setGuardando(true)
    const r = await guardarCategoria({
      id: editando.id,
      nombre: editando.nombre,
      icono: editando.icono,
      nombreAnterior: original?.nombre,
    })
    setGuardando(false)
    if (!r.success) return toast(r.error || 'No se pudo guardar', 'error')
    const movidos = r.productosActualizados ?? 0
    toast(movidos > 0 ? `Guardado · ${movidos} producto${movidos === 1 ? '' : 's'} actualizado${movidos === 1 ? '' : 's'}` : 'Categoría actualizada', 'success')
    setEditando(null)
    recargarConteos()
  }

  async function alternarActivo(c: Categoria) {
    const r = await guardarCategoria({ id: c.id, nombre: c.nombre, orden: c.orden, activo: !c.activo, icono: c.icono })
    if (!r.success) return toast(r.error || 'No se pudo cambiar el estado', 'error')
    toast(c.activo ? `"${c.nombre}" desactivada` : `"${c.nombre}" activada`, 'success')
  }

  async function mover(c: Categoria, dir: -1 | 1) {
    const i = categorias.findIndex((x) => x.id === c.id)
    const vecina = categorias[i + dir]
    if (!vecina) return
    // Intercambia el orden con la vecina.
    await Promise.all([
      guardarCategoria({ id: c.id, nombre: c.nombre, orden: vecina.orden, icono: c.icono, activo: c.activo }),
      guardarCategoria({ id: vecina.id, nombre: vecina.nombre, orden: c.orden, icono: vecina.icono, activo: vecina.activo }),
    ])
  }

  async function borrar(c: Categoria) {
    const usados = conteos[c.nombre] ?? 0
    const ok = await confirm({
      title: 'Borrar categoría',
      message: usados > 0
        ? `"${c.nombre}" la usan ${usados} producto${usados === 1 ? '' : 's'}; no se puede borrar. ¿Querés desactivarla?`
        : `¿Borrar la categoría "${c.nombre}"?`,
      okText: usados > 0 ? 'Desactivar' : 'Borrar',
      destructive: usados === 0,
    })
    if (!ok) return
    if (usados > 0) return alternarActivo(c)
    const r = await eliminarCategoria(c.id, c.nombre)
    if (!r.success) return toast(r.error || 'No se pudo borrar', 'error')
    toast(`Categoría "${c.nombre}" borrada`, 'success')
  }

  async function importar() {
    setImportando(true)
    const r = await importarCategoriasDesdeProductos()
    setImportando(false)
    if (!r.success) return toast(r.error || 'No se pudo importar', 'error')
    toast(r.creadas > 0 ? `${r.creadas} categoría${r.creadas === 1 ? '' : 's'} importada${r.creadas === 1 ? '' : 's'} de los productos` : 'No había categorías nuevas para importar', r.creadas > 0 ? 'success' : 'info')
    recargarConteos()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <Tags className="h-5 w-5 text-primary" />
          <h2 className="font-bold">Categorías de productos</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Los productos se clasifican con estas categorías. Al crear o editar un producto hay que <span className="font-semibold">elegir una de la lista</span>; el
          orden de acá es el orden de los botones en Inventario y en el PDV.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <Label>Nueva categoría</Label>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Limpieza" className="mt-1" />
          </div>
          <div>
            <Label>Icono (app móvil)</Label>
            <select
              value={icono}
              onChange={(e) => setIcono(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm sm:w-44"
            >
              {ICONOS_CATEGORIA.map((i) => (
                <option key={i.icono} value={i.icono}>{i.label}</option>
              ))}
            </select>
          </div>
          <Button onClick={crear} disabled={guardando}>
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crear
          </Button>
        </div>

        <Button variant="secondary" className="mt-3" onClick={importar} disabled={importando}>
          {importando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Importar las que ya usan los productos
        </Button>
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">Listado</h2>
          <span className="text-xs text-muted-foreground">{categorias.length} categoría{categorias.length === 1 ? '' : 's'}</span>
        </div>

        {loading ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : categorias.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay categorías.</p>
        ) : (
          <div className="divide-y">
            {categorias.map((c, i) => {
              const usados = conteos[c.nombre] ?? 0
              const enEdicion = editando?.id === c.id
              return (
                <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="flex shrink-0 flex-col">
                    <button onClick={() => mover(c, -1)} disabled={i === 0} className={cn('cursor-pointer text-muted-foreground hover:text-foreground', i === 0 && 'opacity-30')} aria-label="Subir"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button onClick={() => mover(c, 1)} disabled={i === categorias.length - 1} className={cn('cursor-pointer text-muted-foreground hover:text-foreground', i === categorias.length - 1 && 'opacity-30')} aria-label="Bajar"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </div>

                  {enEdicion ? (
                    <div className="flex min-w-[12rem] flex-1 flex-wrap items-center gap-2">
                      <Input value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} className="h-9 w-40" />
                      <select value={editando.icono} onChange={(e) => setEditando({ ...editando, icono: e.target.value })} className="h-9 rounded-lg border bg-background px-2 text-xs">
                        {ICONOS_CATEGORIA.map((ic) => (
                          <option key={ic.icono} value={ic.icono}>{ic.label}</option>
                        ))}
                      </select>
                      <Button size="sm" onClick={guardarEdicion} disabled={guardando}>Guardar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditando(null)}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  ) : (
                    <div className="min-w-[7.5rem] flex-1">
                      <div className={cn('font-semibold', !c.activo && 'text-muted-foreground line-through')}>{c.nombre}</div>
                      <div className="text-xs text-muted-foreground">
                        {usados} producto{usados === 1 ? '' : 's'}
                        {!c.activo && ' · desactivada (no aparece en filtros ni al crear productos)'}
                      </div>
                    </div>
                  )}

                  {!enEdicion && (
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => alternarActivo(c)}>{c.activo ? 'Desactivar' : 'Activar'}</Button>
                      <Button size="sm" variant="outline" onClick={() => setEditando({ id: c.id, nombre: c.nombre, icono: c.icono || ICONO_POR_DEFECTO })}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => borrar(c)} disabled={usados > 0} title={usados > 0 ? 'Tiene productos: desactivala' : undefined}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
