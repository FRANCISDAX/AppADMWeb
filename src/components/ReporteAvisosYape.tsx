import { Download, Loader2, Search, Smartphone } from 'lucide-react'
import * as React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useNotifications } from '@/components/notifications'
import { exportarExcel } from '@/lib/excel'
import {
  COLUMNAS_AVISOS_YAPE,
  codigoDeSeguridadYape,
  conteoAvisosYape,
  detalleDeAviso,
  esAvisoDePrueba,
  etiquetaSituacionYape,
  fechaDeYape,
  filasDeAvisosYape,
  filtrarAvisosYape,
  horaDeYape,
  resumenHistorialYape,
  situacionPagoYape,
  vigenciaYapeMinutos,
  type EstadoFiltradoYape,
  type PagoYape,
} from '@/lib/yape'
import { obtenerAvisosYapeDelRango } from '@/services/yape'
import { cn } from '@/lib/utils'

const fmt = (n: number) => 'S/ ' + (n ?? 0).toFixed(2)

/** 🔑 Lo que se pagina es el DIBUJO: el rango puede traer cientos de avisos y pintarlos todos cuesta. */
const PAGE = 50

/** `YYYY-MM-DD` (lo que devuelve un `<input type="date">`) → el borde del día **local**. */
function bordeDelDia(iso: string, fin: boolean): Date {
  const [y, m, d] = String(iso ?? '').split('-').map(Number)
  if (!y || !m || !d) return new Date(fin ? Date.now() : 0)
  return fin ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0)
}

/** `YYYY-MM-DD` de hoy (o de hace N días), en hora local. */
function isoDeHoy(offsetDias = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDias)
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`
}

/**
 * Reporte **`Reportes → Yape`**: el historial de avisos de Yape.
 *
 * 🔑 **Por qué existe** (pedido del usuario, 22/09/2026): los avisos se veían **solo el día que
 * llegaban** (el panel del PDV lee los del día) y los confirmados de un turno **solo al cerrarlo**
 * (la foto del cierre no queda en el PDF ni en Auditoría). Después de eso, un yapeo anterior era
 * invisible desde la app aunque el documento siga en `tblPagosYape` para siempre. Esta pantalla lo
 * lee por **rango de fechas** y muestra **quién usó cada aviso, en qué comprobante, y cuáles
 * quedaron sin usar** — que es lo que hace falta para responder *«¿y este yapeo dónde quedó?»*
 * cuando el cliente vuelve al día siguiente.
 *
 * ⚠️ **No es un reporte de ventas**: los avisos dicen *«el negocio recibió plata»*; el cruce con lo
 * cobrado sigue siendo el cierre del turno. Acá los de **PRUEBA** se marcan y **no suman**.
 *
 * 🔒 El filtro por situación y el buscador se hacen **en memoria** (`filtrarAvisosYape`), no en la
 * consulta: pedirlos a Firestore exigiría un índice compuesto (ver `services/yape.ts`).
 */
export function ReporteAvisosYape() {
  const { config } = useConfiguracion()
  const { toast } = useNotifications()
  const vigenciaMin = vigenciaYapeMinutos(config)

  const [desde, setDesde] = React.useState(() => isoDeHoy().slice(0, 8) + '01')
  const [hasta, setHasta] = React.useState(() => isoDeHoy())
  const [estado, setEstado] = React.useState<EstadoFiltradoYape>('todos')
  const [texto, setTexto] = React.useState('')

  const [pagos, setPagos] = React.useState<PagoYape[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [error, setError] = React.useState('')
  /** El rango trajo más avisos que el tope de la lectura: hay que decirlo, no esconderlo. */
  const [tope, setTope] = React.useState(false)
  const [visibles, setVisibles] = React.useState(PAGE)

  /** Cada lectura lleva su número: si el usuario cambia las fechas rápido, la que llega tarde no pisa. */
  const pedido = React.useRef(0)

  const cargar = React.useCallback(async () => {
    const mio = ++pedido.current
    setCargando(true)
    setError('')
    const r = await obtenerAvisosYapeDelRango({
      desde: bordeDelDia(desde, false),
      hasta: bordeDelDia(hasta, true),
    })
    if (mio !== pedido.current) return
    setPagos(r.pagos)
    setTope(r.tope)
    setError(r.error ?? '')
    setCargando(false)
  }, [desde, hasta])

  React.useEffect(() => {
    // Se dispara dentro de una función async (no de forma sincrónica en el efecto) y la lectura que
    // llega tarde no pisa la del rango nuevo: eso lo garantiza el número de pedido de arriba.
    void (async () => {
      await cargar()
    })()
  }, [cargar])

  const opciones = React.useMemo(() => ({ vigenciaMin }), [vigenciaMin])
  const filtrados = React.useMemo(
    () => filtrarAvisosYape(pagos, { estado, texto, opciones }),
    [pagos, estado, texto, opciones],
  )
  const conteo = React.useMemo(() => conteoAvisosYape(pagos, opciones), [pagos, opciones])
  const resumen = React.useMemo(() => resumenHistorialYape(filtrados, opciones), [filtrados, opciones])

  /** El filtro se aplica en el evento (y ahí se vuelve a la primera página), no en un efecto. */
  function cambiarEstado(v: EstadoFiltradoYape) {
    setEstado(v)
    setVisibles(PAGE)
  }
  function cambiarTexto(v: string) {
    setTexto(v)
    setVisibles(PAGE)
  }
  function cambiarRango(d: string, h: string) {
    setDesde(d)
    setHasta(h)
    setVisibles(PAGE)
  }

  async function exportar() {
    if (filtrados.length === 0) {
      toast('No hay avisos para exportar', 'warning')
      return
    }
    try {
      await exportarExcel(
        [{ name: 'Avisos de Yape', headers: [...COLUMNAS_AVISOS_YAPE], rows: filasDeAvisosYape(filtrados, opciones) }],
        `Avisos_Yape_${desde}_${hasta}.xlsx`,
        { empresa: config?.nombre || 'AppADM', titulo: `Avisos de Yape — ${desde} a ${hasta}` },
      )
      toast('Excel exportado', 'success')
    } catch (e) {
      toast('❌ No se pudo exportar: ' + (e as Error).message)
    }
  }

  const dibujados = filtrados.slice(0, visibles)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          Avisos de Yape del rango · los que <b>no</b> se usaron en ninguna venta quedan a la vista
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => cambiarRango(isoDeHoy(), isoDeHoy())}>Hoy</Button>
          <Button variant="outline" size="sm" onClick={() => cambiarRango(isoDeHoy(-1), isoDeHoy(-1))}>Ayer</Button>
          <Button variant="outline" size="sm" onClick={() => cambiarRango(isoDeHoy().slice(0, 8) + '01', isoDeHoy())}>Este mes</Button>
          <Button variant="outline" size="sm" onClick={exportar} disabled={filtrados.length === 0}>
            <Download className="mr-1 h-3.5 w-3.5" /> Excel
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-card">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Desde
          <input
            type="date"
            value={desde}
            onChange={(e) => cambiarRango(e.target.value, hasta)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Hasta
          <input
            type="date"
            value={hasta}
            onChange={(e) => cambiarRango(desde, e.target.value)}
            className="h-9 rounded-lg border bg-background px-2 text-sm"
          />
        </label>
        <select
          value={estado}
          onChange={(e) => cambiarEstado(e.target.value as EstadoFiltradoYape)}
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="todos">Todas las situaciones ({conteo.todos})</option>
          <option value="usado">Usados ({conteo.usado})</option>
          <option value="disponible">Disponibles ({conteo.disponible})</option>
          <option value="reservado">En uso ({conteo.reservado})</option>
          <option value="ignorado">Ignorados ({conteo.ignorado})</option>
          <option value="anulado">Anulados ({conteo.anulado})</option>
          <option value="vencido">Vencidos ({conteo.vencido})</option>
          {conteo.desconocido > 0 && <option value="desconocido">No reconocidos ({conteo.desconocido})</option>}
        </select>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={texto}
            onChange={(e) => cambiarTexto(e.target.value)}
            placeholder="Buscar pagador, N° de operación, comprobante o monto…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => { void cargar() }} disabled={cargando}>
          {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Actualizar'}
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm font-bold">
            <Smartphone className="h-4 w-4 text-primary" /> Avisos de Yape
          </span>
          <span className="num text-sm text-muted-foreground">
            {filtrados.length} aviso(s) · cobrado con aviso {fmt(resumen.cobrado)}
            {resumen.sinUsar > 0 && ` · sin usar ${resumen.sinUsar} (${fmt(resumen.montoSinUsar)})`}
            {resumen.pruebas > 0 && ` · ${resumen.pruebas} de PRUEBA`}
          </span>
        </div>

        {/* ⚠️ Que un rango traiga más avisos que el tope de lectura tiene que verse: si no, parece
            que «esos avisos no están» cuando en realidad no se leyeron. */}
        {tope && (
          <p className="border-b bg-amber-50 px-4 py-2 text-[11px] text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            ⚠️ El rango tiene más avisos de los que se leen de una vez: achicá las fechas para no perderte ninguno.
          </p>
        )}
        {resumen.desconocidos > 0 && (
          <p className="border-b bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
            {resumen.desconocidos} aviso(s) con un estado que el sistema no reconoce: revisá el puente.
          </p>
        )}
        {resumen.pruebas > 0 && (
          <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
            {resumen.pruebas} aviso(s) de <b>PRUEBA</b> ({fmt(resumen.montoPruebas)}): los creó
            Configuración → Yape, <b>no entró plata</b> y no suman a lo cobrado.
          </p>
        )}

        {cargando ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />Leyendo los avisos…
          </p>
        ) : error ? (
          <p className="py-16 text-center text-sm text-destructive">
            No se pudieron leer los avisos: {error}
          </p>
        ) : filtrados.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Sin avisos de Yape en este rango{estado !== 'todos' || texto ? ' con este filtro' : ''}
          </p>
        ) : (
          <div className="divide-y">
            {dibujados.map((p) => {
              const situacion = situacionPagoYape(p, opciones)
              const detalle = detalleDeAviso(p, opciones)
              return (
                <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="num text-sm font-bold">{horaDeYape(p.fecha)}</span>
                      <span className="num text-[11px] text-muted-foreground">{fechaDeYape(p.fecha)}</span>
                      <Badge
                        variant={
                          situacion === 'usado'
                            ? 'success'
                            : situacion === 'ignorado' || situacion === 'anulado'
                              ? 'destructive'
                              : situacion === 'desconocido'
                                ? 'destructive'
                                : 'secondary'
                        }
                      >
                        {etiquetaSituacionYape(situacion)}
                      </Badge>
                      {esAvisoDePrueba(p) && (
                        <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">PRUEBA</span>
                      )}
                      <span className="num text-sm font-bold">{fmt(p.monto)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm font-semibold">{p.pagadorNombre || 'Sin nombre'}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                      {p.nroOperacion && <span className="num">op. {p.nroOperacion}</span>}
                      {codigoDeSeguridadYape(p) && (
                        <span className="num font-semibold text-foreground">cód. {codigoDeSeguridadYape(p)}</span>
                      )}
                      {situacion === 'usado' && (
                        <>
                          {p.usadoPor && <span>lo usó {p.usadoPor}</span>}
                          {p.documento && <span className="num">en {p.documento}</span>}
                        </>
                      )}
                      {detalle && <span className={cn(situacion === 'desconocido' && 'text-destructive')}>{detalle}</span>}
                      {p.origen && !esAvisoDePrueba(p) && <span>origen: {p.origen}</span>}
                    </p>
                  </div>
                  {esAvisoDePrueba(p) && <span className="num shrink-0 text-[11px] text-muted-foreground">no es plata</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {filtrados.length > dibujados.length && (
        <div className="flex items-center justify-center gap-3">
          <span className="text-xs text-muted-foreground">
            Mostrando {dibujados.length} de {filtrados.length}
          </span>
          <Button variant="outline" size="sm" onClick={() => setVisibles((n) => n + PAGE)}>Ver más</Button>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Un aviso dice <b>«el negocio recibió plata»</b>, no «se cobró una venta»: el cruce con lo
        cobrado se hace en el <b>cierre del turno</b> (Caja → Cerrar Turno) y el detalle del cobro
        queda en el comprobante. Los avisos viven para siempre en <span className="font-mono">tblPagosYape</span>.
      </p>
    </div>
  )
}
