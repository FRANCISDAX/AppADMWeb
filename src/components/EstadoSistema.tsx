/**
 * **¿Está todo funcionando?** — el panel del **Estado del sistema** (Auditoría).
 *
 * 🔑 **Por qué existe**: el local depende de cuatro cosas que viven **fuera** de la pantalla donde se
 * trabaja y cada una se miraba en un lugar distinto —o no se miraba—: la **caja** (¿se guardan los
 * movimientos?), la **API de SUNAT** (¿se puede emitir?), el **puente de Yape** (¿llegan los avisos del
 * celular?) y el **respaldo** (¿hay copia?). Acá se ven las cuatro juntas, con una frase arriba.
 *
 * ⚠️ **Informa, no bloquea** nada (ni cobrar, ni emitir, ni cerrar) y **no escribe**: no hay colección
 * nueva, no se guarda la prueba de la API y el último movimiento se lee de `tblDocumentos`.
 *
 * 🔑 **La prueba de la API se hace al abrir la pantalla** (decisión del usuario) y se repite con el
 * botón: es una foto del momento, no un histórico.
 */
import * as React from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DatabaseBackup,
  Loader2,
  MonitorSmartphone,
  RefreshCw,
  Server,
  Smartphone,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { COL } from '@/constants/colecciones'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { db, PROYECTO_FIREBASE } from '@/lib/firebase'
import type { LatidoPuenteYape } from '@/lib/puente'
import type { EstadoRespaldoDatos } from '@/lib/respaldo-estado'
import {
  COLORES_SERVICIO,
  resumenSistema,
  servicioApi,
  servicioPuente,
  servicioRespaldo,
  servicioWeb,
  type IdServicio,
  type NivelServicio,
  type PingApi,
  type Servicio,
  type UltimoMovimiento,
} from '@/lib/servicios'
import { baseDeLaApi, endpointSunat } from '@/lib/sunat'
import { probarApiSunat, ultimoMovimiento } from '@/services/estado-sistema'
import { cn } from '@/lib/utils'

const ICONOS: Record<IdServicio, typeof Activity> = {
  web: MonitorSmartphone,
  api: Server,
  puente: Smartphone,
  respaldo: DatabaseBackup,
}

function IconoNivel({ nivel }: { nivel: NivelServicio }) {
  if (nivel === 'ok') return <CheckCircle2 className={cn('h-4 w-4 shrink-0', COLORES_SERVICIO[nivel])} />
  if (nivel === 'probando') return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
  if (nivel === 'sin-datos') return <Clock className={cn('h-4 w-4 shrink-0', COLORES_SERVICIO[nivel])} />
  if (nivel === 'atencion') return <AlertTriangle className={cn('h-4 w-4 shrink-0', COLORES_SERVICIO[nivel])} />
  return <XCircle className={cn('h-4 w-4 shrink-0', COLORES_SERVICIO[nivel])} />
}

/** Una tarjeta: el servicio, qué pasa y —si hay algo que hacer— la instrucción. */
function Tarjeta({ servicio }: { servicio: Servicio }) {
  const Icono = ICONOS[servicio.id]
  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-3 shadow-soft',
        servicio.nivel === 'critico' && 'border-destructive/40',
        servicio.nivel === 'atencion' && 'border-amber-400/50',
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <Icono className="h-3.5 w-3.5 shrink-0" /> {servicio.nombre}
      </div>
      <div className="mt-1 flex items-start gap-1.5">
        <IconoNivel nivel={servicio.nivel} />
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">{servicio.titulo}</p>
          {servicio.detalle && <p className="mt-0.5 text-[11px] text-muted-foreground">{servicio.detalle}</p>}
          {servicio.accion && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              <span className="font-semibold">Qué hacer: </span>
              {servicio.accion}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function EstadoSistema() {
  const { config } = useConfiguracion()
  const [latido, setLatido] = React.useState<LatidoPuenteYape | null | undefined>(undefined)
  const [datosRespaldo, setDatosRespaldo] = React.useState<EstadoRespaldoDatos | undefined>(undefined)
  const [ultimo, setUltimo] = React.useState<UltimoMovimiento | null | undefined>(undefined)
  const [ping, setPing] = React.useState<PingApi | null>(null)
  const [probando, setProbando] = React.useState(true)
  const [refresco, setRefresco] = React.useState(0)
  /**
   * «Ahora», en estado y no en el render: `Date.now()` dentro del render es una función impura (regla
   * `react(purity)` del lint). Se refresca solo cada 30 s para que «hace 3 h» no se quede viejo.
   */
  const [ahora, setAhora] = React.useState(() => Date.now())

  // La misma elección de URL que el envío (`endpointSunat`), sin la ruta de emisión.
  const base = React.useMemo(() => baseDeLaApi(endpointSunat(config, 'invoices')), [config])

  // El latido del celular del Yape y el del respaldo llegan en vivo (son documentos que otro escribe).
  React.useEffect(() => {
    const soltar = onSnapshot(
      doc(db, COL.PUENTE_YAPE, 'estado'),
      (snap) => setLatido(snap.exists() ? (snap.data() as LatidoPuenteYape) : null),
      (e) => {
        console.warn('⚠️ No se pudo leer el latido del puente:', e)
        setLatido(null)
      },
    )
    return soltar
  }, [])

  React.useEffect(() => {
    if (!PROYECTO_FIREBASE) return
    const soltar = onSnapshot(
      doc(db, COL.RESPALDO_ESTADO, PROYECTO_FIREBASE),
      (snap) => setDatosRespaldo(snap.exists() ? (snap.data() as EstadoRespaldoDatos) : null),
      (e) => {
        console.warn('⚠️ No se pudo leer el latido del respaldo:', e)
        setDatosRespaldo(null)
      },
    )
    return soltar
  }, [])

  // El último movimiento (una lectura) y la prueba de la API (un GET): se rehacen al tocar el botón.
  React.useEffect(() => {
    let vivo = true
    void ultimoMovimiento().then((r) => {
      if (vivo) setUltimo(r)
    })
    return () => {
      vivo = false
    }
  }, [refresco])

  React.useEffect(() => {
    if (!base) return
    let vivo = true
    void probarApiSunat(base).then((r) => {
      if (!vivo) return
      setPing(r)
      setProbando(false)
    })
    return () => {
      vivo = false
    }
  }, [base, refresco])

  // El reloj del panel: sin esto, «hace 3 h» se queda congelado en una pantalla abierta toda la tarde.
  React.useEffect(() => {
    const reloj = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(reloj)
  }, [])

  const ahoraMs = ahora
  const servicios: Servicio[] = [
    ultimo === undefined
      ? { id: 'web', nombre: 'Caja (app web)', nivel: 'probando', titulo: 'Buscando el último movimiento…', detalle: '', accion: '' }
      : servicioWeb(ultimo, ahoraMs),
    base
      ? servicioApi(probando ? null : ping, ahoraMs)
      : {
          id: 'api',
          nombre: 'API SUNAT',
          nivel: 'atencion',
          titulo: 'No hay URL de la API configurada',
          detalle: 'La config no tiene la dirección de la API de SUNAT.',
          accion: 'Cárgala en Configuración → SUNAT para poder emitir comprobantes.',
        },
    latido === undefined
      ? { id: 'puente', nombre: 'Puente Yape', nivel: 'probando', titulo: 'Leyendo el celular del Yape…', detalle: '', accion: '' }
      : servicioPuente(latido, ahoraMs),
    datosRespaldo === undefined
      ? { id: 'respaldo', nombre: 'Respaldo', nivel: 'probando', titulo: 'Leyendo el último respaldo…', detalle: '', accion: '' }
      : servicioRespaldo(datosRespaldo, new Date(ahoraMs)),
  ]
  const resumen = resumenSistema(servicios)

  const refrescar = () => {
    setPing(null)
    setProbando(true)
    setAhora(Date.now())
    setRefresco((n) => n + 1)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-card p-4 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-bold">
            <Activity className={cn('h-5 w-5', COLORES_SERVICIO[resumen.peor])} /> Estado del sistema
          </h3>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-xs font-bold',
                resumen.peor === 'ok' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                resumen.peor === 'atencion' && 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                resumen.peor === 'critico' && 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                (resumen.peor === 'sin-datos' || resumen.peor === 'probando') &&
                  'bg-muted text-muted-foreground',
              )}
            >
              {resumen.frase}
            </span>
            <Button variant="outline" size="sm" onClick={refrescar} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5" /> Probar de nuevo
            </Button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Solo informa: no bloquea el cobro, la emisión ni el cierre. La prueba de la API se hace ahora y no se guarda;
          «sin datos» no es «caído» (un negocio nuevo todavía no tiene respaldo).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {servicios.map((s) => (
          <Tarjeta key={s.id} servicio={s} />
        ))}
      </div>
    </div>
  )
}

export default EstadoSistema
