/**
 * **Envío automático a SUNAT** en la pantalla (opción A, pedido del usuario 24/09/2026).
 *
 * 🔑 **Cuándo corre**: al abrir la app, cada `sunatAutoIntervaloMinutos` (10 por defecto) mientras
 * haya una pantalla abierta, y **cuando vuelve la conexión** (un corte de internet es justo el caso
 * en el que quedan comprobantes sin declarar). Corre en **cualquier** pantalla del app: cuantas más
 * abiertas, más chance de que un comprobante se declare a tiempo — y **dos pestañas no pueden mandar
 * lo mismo** (el reclamo transaccional de `services/sunat-auto.ts`).
 *
 * ⚠️ **No hace nada si**: no hay sesión, el envío automático está apagado
 * (`config.sunatAutoEnvio === false`), no hay URL de API SUNAT configurada, o el equipo está **sin
 * conexión**. Nada de eso toca al **botón manual**, que sigue funcionando igual.
 *
 * ⚠️ **Ruido controlado**: un intento fallido por conexión **no avisa** (se reintenta solo y el aviso
 * quedaría repitiéndose cada 10 minutos en cada pantalla); lo que **sí avisa** es un **rechazo de
 * SUNAT**, que es un problema real, ocurre **una sola vez** por comprobante (un rechazado no se
 * reintenta) y necesita que alguien lo arregle.
 *
 * ⚠️ **La configuración se lee por `ref`, no por dependencia**: editar cualquier campo de
 * Configuración cambia el objeto de config en **cada tecla**, así que si `correr()` dependiera de él,
 * el admin estaría disparando un envío a SUNAT por cada letra que escribe.
 */
import * as React from 'react'
import { useAuth } from '@/context/auth'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { useNotifications } from '@/components/notifications'
import { autoEnvioSunatActivo, intervaloAutoSunatMs } from '@/lib/sunat-auto'
import { enviarPendientesSunatAutomatico, type ResultadoSunatAuto } from '@/services/sunat-auto'

/** Identifica a esta pestaña en el reclamo (`sunat.enviandoPor`): sirve para saber quién lo tomó. */
const ID_EQUIPO = `web-${Math.random().toString(36).slice(2, 8)}`

/** Cada cuánto, como mucho, se avisa que los envíos están fallando (una vez por hora). */
export const AVISO_ERROR_MS = 3600000

/** `Date.now()` envuelto: deja claro que es una lectura de reloj fuera del render. */
function ahoraMs(): number {
  return Date.now()
}

export type UseSunatAuto = {
  /** ¿Está activo en la configuración del negocio? (con el automático apagado, `enviarAhora` sirve igual) */
  activo: boolean
  /** ¿Hay una pasada corriendo ahora mismo? */
  enviando: boolean
  /** La última pasada (para mostrar «enviados N» en Configuración, por ejemplo). */
  ultima: ResultadoSunatAuto | null
  /** Una pasada a pedido (el botón «Enviar pendientes ahora»). Devuelve `null` si no se pudo correr. */
  enviarAhora: () => Promise<ResultadoSunatAuto | null>
}

export function useSunatAuto(): UseSunatAuto {
  const { user } = useAuth()
  const { config, loading } = useConfiguracion()
  const { toast } = useNotifications()
  const [enviando, setEnviando] = React.useState(false)
  const [ultima, setUltima] = React.useState<ResultadoSunatAuto | null>(null)

  const usuarioId = user?.uid ?? ''
  const activo = autoEnvioSunatActivo(config)
  /** El intervalo sale de la config, pero es un **número**: no cambia con cada tecla. */
  const intervalo = intervaloAutoSunatMs(config)

  // La config viva, para que `correr()` no dependa de su identidad (ver la cabecera).
  const configRef = React.useRef(config)
  React.useEffect(() => {
    configRef.current = config
  }, [config])

  /** Evita que dos pasadas se pisen (el intervalo y el evento `online` pueden coincidir). */
  const corriendo = React.useRef(false)
  /** Cuándo se avisó, por última vez, que los envíos están fallando (freno del aviso: 1 por hora). */
  const ultimoAvisoError = React.useRef(0)

  const correr = React.useCallback(async (): Promise<ResultadoSunatAuto | null> => {
    if (corriendo.current) return null
    if (!usuarioId || !autoEnvioSunatActivo(configRef.current)) return null
    // Sin URL de API no hay a dónde mandar (es el mismo control que hace el botón manual, que avisa).
    if (!String(configRef.current.sunatApiUrlProd ?? '').trim()) return null
    // Sin conexión no se intenta: cada intento esperaría el timeout completo (60 s) para nada.
    if (!navigator.onLine) return null

    corriendo.current = true
    setEnviando(true)
    try {
      const r = await enviarPendientesSunatAutomatico({ config: configRef.current, dispositivo: ID_EQUIPO })
      setUltima(r)
      // El barrido lee el interruptor **del servidor**: si lo apagaron, la config cacheada de esta
      // pantalla puede decir lo contrario y acá no se avisa de nada.
      if (r.apagado) return r
      if (r.rechazados > 0) {
        const cuales = r.detalle.filter((d) => !d.ok && d.mensaje).slice(0, 2).map((d) => d.etiqueta)
        toast(
          `SUNAT rechazó ${r.rechazados} comprobante(s)${cuales.length ? `: ${cuales.join(', ')}` : ''}. Revisa el Registro SUNAT: no se reintentan solos.`,
          'error',
        )
      } else if (r.conError > 0 && r.aceptados === 0 && ahoraMs() - ultimoAvisoError.current > AVISO_ERROR_MS) {
        // 🔑 **Un envío que falla siempre no puede fallar en silencio**: el caso real es la API
        // inalcanzable (dirección mal configurada, o el navegador bloqueando el pedido por la política
        // de seguridad de la página), donde el automático queda «encendido» y no manda nada nunca. El
        // aviso va **como mucho una vez por hora y por equipo**: repetirlo en cada pasada (10 min)
        // convertiría el aviso en ruido y el usuario dejaría de mirarlo.
        ultimoAvisoError.current = ahoraMs()
        const motivo = r.detalle.find((d) => !d.ok && d.mensaje)?.mensaje ?? 'sin detalle'
        toast(`No se pudo enviar a SUNAT (${r.conError} comprobante(s)): ${motivo}`, 'warning')
      }
      return r
    } catch (e) {
      // Un fallo de lectura no puede romper la pantalla: se deja rastro y se reintenta en la próxima.
      console.warn('⚠️ No se pudo revisar los comprobantes pendientes de SUNAT:', (e as Error).message)
      return null
    } finally {
      corriendo.current = false
      setEnviando(false)
    }
  }, [toast, usuarioId])

  // Primera pasada: **diferida un tick** (mismo criterio que las alertas) para no hacer trabajo
  // pesado durante el primer pintado.
  React.useEffect(() => {
    if (loading) return
    const id = window.setTimeout(() => void correr(), 0)
    return () => window.clearTimeout(id)
  }, [correr, loading])

  // Revisión periódica mientras la pantalla está abierta.
  React.useEffect(() => {
    if (loading) return
    const id = window.setInterval(() => void correr(), intervalo)
    return () => window.clearInterval(id)
  }, [correr, intervalo, loading])

  // Al volver la conexión se revisa en el acto: es el caso típico de comprobantes que quedaron
  // pendientes por un corte.
  React.useEffect(() => {
    const alVolver = () => void correr()
    window.addEventListener('online', alVolver)
    return () => window.removeEventListener('online', alVolver)
  }, [correr])

  return { activo, enviando, ultima, enviarAhora: correr }
}
