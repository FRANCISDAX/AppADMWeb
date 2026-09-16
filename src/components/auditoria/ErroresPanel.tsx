import { AlertTriangle, Loader2, RefreshCw, Search, Trash2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNotifications } from '@/components/notifications'
import { limpiarErrores, obtenerErrores, type ErrorApp } from '@/services/errores'

/**
 * Errores registrados por la app (`tblErrores`), para revisarlos sin abrir la
 * consola de Firebase. Vive aparte de la página de Auditoría para que esa siga
 * siendo solo el log de actividad.
 */
export function ErroresPanel() {
  const { toast, confirm } = useNotifications()
  const [errores, setErrores] = React.useState<ErrorApp[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [busqueda, setBusqueda] = React.useState('')
  const [filtroContexto, setFiltroContexto] = React.useState('')

  const cargar = React.useCallback(async () => {
    setCargando(true)
    setErrores(await obtenerErrores())
    setCargando(false)
  }, [])

  React.useEffect(() => {
    let vigente = true
    obtenerErrores()
      .then((lista) => {
        if (vigente) setErrores(lista)
      })
      .catch((e) => console.error('❌ Cargando errores:', e))
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [])

  const contextos = React.useMemo(() => [...new Set(errores.map((e) => e.contexto))].sort(), [errores])

  const filtrados = React.useMemo(() => {
    const t = busqueda.trim().toLowerCase()
    return errores.filter((e) => {
      if (filtroContexto && e.contexto !== filtroContexto) return false
      if (!t) return true
      return `${e.mensaje} ${e.contexto} ${e.usuario} ${e.ruta} ${e.stack ?? ''}`.toLowerCase().includes(t)
    })
  }, [errores, busqueda, filtroContexto])

  async function limpiar() {
    const ok = await confirm({ title: 'Limpiar errores', message: '¿Borrar los errores con más de 30 días?', okText: 'Borrar', destructive: true })
    if (!ok) return
    const borrados = await limpiarErrores(30)
    toast(borrados > 0 ? `${borrados} error${borrados === 1 ? '' : 'es'} borrado${borrados === 1 ? '' : 's'}` : 'No había errores con más de 30 días', borrados > 0 ? 'success' : 'info')
    cargar()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por mensaje, usuario o ruta…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="pl-9" />
        </div>
        <select value={filtroContexto} onChange={(e) => setFiltroContexto(e.target.value)} className="rounded-lg border bg-background px-3 py-2 text-sm">
          <option value="">Todos los orígenes</option>
          {contextos.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
          {cargando ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Actualizar
        </Button>
        <Button variant="outline" size="sm" onClick={limpiar} disabled={errores.length === 0}>
          <Trash2 className="h-4 w-4" /> Limpiar +30 días
        </Button>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>Registrados: <strong className="num">{errores.length}</strong></span>
        <span>Filtrados: <strong className="num">{filtrados.length}</strong></span>
      </div>

      {cargando ? (
        <div className="py-16 text-center"><Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : filtrados.length === 0 ? (
        <div className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
          {errores.length === 0 ? 'Sin errores registrados 🎉' : 'Ningún error coincide con el filtro'}
        </div>
      ) : (
        <div className="divide-y overflow-hidden rounded-xl border bg-card">
          {filtrados.map((e) => {
            const fecha = e.fecha ? new Date(e.fecha) : null
            return (
              <details key={e.id} className="px-4 py-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="shrink-0 rounded-md bg-destructive/10 px-2 py-0.5 text-[11px] font-bold text-destructive">{e.contexto}</span>
                  <span className="min-w-[12rem] flex-1 truncate font-medium">{e.mensaje}</span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {fecha ? `${fecha.toLocaleDateString('es-PE')} ${fecha.toLocaleTimeString('es-PE')}` : '—'}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{e.usuario}</span>
                </summary>
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {e.ruta && <p className="break-all">Ruta: {e.ruta}</p>}
                  {e.dispositivo && <p className="break-all">Equipo: {e.dispositivo}</p>}
                  {e.detalle && <p className="break-all">Detalle: {JSON.stringify(e.detalle)}</p>}
                  {e.stack && <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-2 text-[11px]">{e.stack}</pre>}
                  {!e.stack && !e.detalle && <p>Sin más información.</p>}
                </div>
              </details>
            )
          })}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5" /> Los errores repetidos se guardan una sola vez por minuto para no llenar la base.
      </p>
    </div>
  )
}
