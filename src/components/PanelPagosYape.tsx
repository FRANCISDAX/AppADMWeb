import { Bell, BellOff, Check, Loader2, Volume2 } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { useNotifications } from '@/components/notifications'
import { useConfiguracion } from '@/hooks/use-configuracion'
import { usePermisos } from '@/context/permisos'
import { fmt } from '@/lib/ui-utils'
import { cn } from '@/lib/utils'
import {
  aplicarYapeEnVenta,
  avisoYapeActivo,
  avisosDelMismoMonto,
  coincideConTotal,
  confirmarAntesDeAplicar,
  codigoDeSeguridadYape,
  esAvisoDePrueba,
  etiquetaYape,
  haceCuantoYape,
  horaDeYape,
  minutosRestantesYape,
  pagosYapeVisibles,
  resumenYape,
  situacionPagoYape,
  sonidoYapeActivo,
  vigenciaYapeMinutos,
  type PagoYape,
} from '@/lib/yape'
import { ignorarPagoYape, obtenerPagosYapeDelDia, suscribirPagosYape } from '@/services/yape'

/**
 * Avisos de pago de Yape, en el PDV.
 *
 * El cajero ve el aviso que llegó al celular del negocio y lo aplica a la venta en curso con
 * **«Usar en esta venta»** (el PDV lo reserva y carga el pago por Yape con el N° de operación)
 * o lo descarta con **«Ignorar»** (queda registrado quién y cuándo).
 *
 * ⚠️ **Acá no se cobra ni se toca el carrito**: igual que `PanelVentasPendientes`, este panel
 * solo avisa. La reserva del aviso, el pago en la venta y la confirmación los hace el PDV, que
 * es el único que sabe cuál es la venta en curso (una sola implementación del cobro).
 *
 * 🔑 **Un aviso dice un monto, no una venta**: Yape no informa a qué venta corresponde. Por eso
 * el monto que coincide con el total se **destaca** (lo normal es que el cliente yapee justo) y
 * el cruce real se hace en el cierre del turno.
 */
export function PanelPagosYape({
  total,
  pagoEnVentaId,
  onUsar,
  onAvisos,
}: {
  /** Total de la venta en curso: sirve para destacar el aviso que coincide con el monto. */
  total: number
  /** Aviso ya aplicado a la venta en curso (lo lleva el PDV): no se repite en la lista. */
  pagoEnVentaId?: string | null
  /** El PDV reserva el aviso y lo carga como forma de pago de la venta en curso. */
  onUsar: (pago: PagoYape) => void | Promise<void>
  /**
   * 🔑 **Cuántos avisos están sin usar**, para avisarlo con el carrito cerrado.
   * 📌 Mismo motivo que en `PanelVentasPendientes`: en el celular el panel vive dentro del carrito, y un
   * «yapeó el cliente» que solo se ve abriendo la venta llega tarde. El número es el de la **lista visible**
   * (`pagosYapeVisibles`: descarta vencidos y los que ya se usaron en otra caja).
   */
  onAvisos?: (cantidad: number) => void
}) {
  const { config: cfg } = useConfiguracion()
  const { tienePermiso, nombre: nombreUsuario } = usePermisos()
  const { toast, confirm } = useNotifications()
  const [pagos, setPagos] = React.useState<PagoYape[]>([])
  const [cargando, setCargando] = React.useState(true)
  const [procesandoId, setProcesandoId] = React.useState<string | null>(null)
  /** Se refresca solo para que «hace 2 min» y «vence en 7 min» no queden congelados. */
  const [ahora, setAhora] = React.useState(() => Date.now())
  /** Avisos ya vistos: sirve para sonar **solo** con los que llegan nuevos. */
  const vistos = React.useRef<Set<string>>(new Set())
  const primeraCarga = React.useRef(true)

  const vigenciaMin = vigenciaYapeMinutos(cfg)
  const activo = avisoYapeActivo(cfg)
  const conSonido = sonidoYapeActivo(cfg)

  const cargar = React.useCallback(async () => {
    try {
      setPagos(await obtenerPagosYapeDelDia())
    } catch (e) {
      console.error('❌ Avisos de Yape:', (e as Error).message)
    } finally {
      setCargando(false)
    }
  }, [])

  React.useEffect(() => {
    if (!activo) return
    // 🔑 En vivo (`onSnapshot`): el aviso aparece en el PDV apenas llega, y el que usa otra caja
    // sale de la lista de todas al instante. Si el canal se corta, se cae al refresco periódico
    // para que el panel no quede congelado mostrando un aviso que ya se usó.
    let timer: ReturnType<typeof setInterval> | null = null
    const soltar = suscribirPagosYape(
      (lista) => {
        setPagos(lista)
        setCargando(false)
      },
      () => {
        console.warn('⚠️ Se perdió el canal en vivo de los avisos de Yape: se refresca cada 30 s')
        cargar()
        timer = setInterval(() => { cargar() }, 30000)
      },
    )
    return () => {
      soltar()
      if (timer) clearInterval(timer)
    }
  }, [activo, cargar])

  React.useEffect(() => {
    if (!activo) return
    const t = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(t)
  }, [activo])

  const visibles = React.useMemo(
    () => pagosYapeVisibles(pagos, { ahora, vigenciaMin }),
    [pagos, ahora, vigenciaMin],
  )
  const resumen = React.useMemo(() => resumenYape(pagos, { ahora, vigenciaMin }), [pagos, ahora, vigenciaMin])

  // Avisar al PDV cuántos avisos están sin usar (para la barra del celular). Usa la MISMA lista que se
  // dibuja —si el número dijera algo distinto de lo que hay adentro, el aviso mentiría— y **apagado
  // informa 0**: un contador viejo no puede quedar prendido cuando la función está desactivada.
  React.useEffect(() => {
    onAvisos?.(activo ? visibles.length : 0)
  }, [onAvisos, visibles.length, activo])

  // ─── El pitido ────────────────────────────────────────────────────────────
  /** Un beep corto con la WebAudio del navegador: no hace falta ningún archivo de sonido. */
  const sonar = React.useCallback(() => {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.value = 0.08
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.18)
      // Se cierra el contexto al terminar: un AudioContext por aviso, abierto para siempre,
      // termina siendo un problema (los navegadores limitan cuántos se pueden abrir).
      window.setTimeout(() => { void ctx.close().catch(() => {}) }, 600)
    } catch (e) {
      // ⚠️ Un sonido que no suena no puede romper la venta: el aviso se ve igual.
      console.warn('⚠️ No se pudo sonar el aviso de Yape:', e)
    }
  }, [])

  React.useEffect(() => {
    if (!activo) return
    const disponibles = pagos.filter((p) => situacionPagoYape(p, { ahora: Date.now(), vigenciaMin }) === 'disponible')
    const nuevos = disponibles.filter((p) => !vistos.current.has(p.id))
    for (const p of disponibles) vistos.current.add(p.id)
    // En la primera carga NO suena: al abrir el PDV sonarían todos los avisos que ya estaban.
    if (primeraCarga.current) {
      primeraCarga.current = false
      return
    }
    if (nuevos.length > 0 && conSonido) sonar()
  }, [pagos, activo, conSonido, vigenciaMin, sonar])

  async function usar(pago: PagoYape) {
    const revision = aplicarYapeEnVenta(pago, total)
    if (!revision.ok) return toast(`⚠️ ${revision.motivo}`)
    // 🔑 Con varias cajas abiertas todos ven la misma lista (la plata entra a una sola cuenta Yape),
    // así que un aviso que **no coincide** con el total de la venta se confirma: es el momento de
    // mirar el monto y el N° de operación con el cliente delante, antes de cargarlo al cobro.
    if (confirmarAntesDeAplicar(pago, total)) {
      const otros = avisosDelMismoMonto(pago, pagos, { ahora, vigenciaMin })
      const ok = await confirm({
        title: 'El aviso no coincide con el total',
        message:
          `${etiquetaYape(pago)}\n` +
          `Yapeó a las ${horaDeYape(pago.fecha)} (${haceCuantoYape(pago.fecha)}).\n\n` +
          `La venta es de ${fmt(total)}.\n\n` +
          (otros.length > 0
            ? `⚠️ Hay ${otros.length + 1} avisos disponibles por ${fmt(pago.monto)}: cotejá el código de seguridad (o el N° de operación) con lo que muestra el cliente para no cargarle el pago de otro.\n\n`
            : '') +
          '¿Es el yapeo de este cliente?',
        okText: 'Sí, aplicar',
      })
      if (!ok) return
    }
    // ⚠️ Un aviso de PRUEBA no es un pago: si se aplica a una venta, esa venta queda registrada
    // como pagada por Yape sin que haya entrado plata. Se puede hacer (es para probar el circuito),
    // pero nunca por accidente.
    if (esAvisoDePrueba(pago)) {
      const ok = await confirm({
        title: 'Es un aviso de PRUEBA',
        message: `${etiquetaYape(pago)}\n\nLo creaste desde Configuración → Yape: NO entró plata. Si lo aplicas, la venta va a quedar registrada como pagada por Yape (y en el cruce del cierre va a figurar como PRUEBA).\n\n¿Seguir?`,
        okText: 'Usar igual',
      })
      if (!ok) return
    }
    setProcesandoId(pago.id)
    try {
      // El PDV reserva el aviso (transaccional) y lo carga como pago: si la reserva falla, el
      // motivo lo muestra él, que es el que sabe en qué estado quedó el carrito.
      await onUsar(pago)
      if (revision.aviso) toast(`⚠️ ${revision.aviso}`)
    } finally {
      setProcesandoId(null)
    }
  }

  async function ignorar(pago: PagoYape) {
    const ok = await confirm({
      title: '¿Ignorar este aviso?',
      message: `${etiquetaYape(pago)}\n\nDeja de aparecer en el PDV. No se borra: queda registrado que lo ignoraste, por si después hay que revisar el cruce de Yape en el cierre.`,
      okText: 'Ignorar',
    })
    if (!ok) return
    setProcesandoId(pago.id)
    try {
      const r = await ignorarPagoYape({
        pagoId: pago.id,
        usuario: nombreUsuario || 'sistema',
        vigenciaMin,
      })
      if (!r.success) return toast(`❌ ${r.error || 'No se pudo ignorar el aviso'}`)
      setPagos((prev) => prev.map((p) => (p.id === pago.id ? { ...p, estado: 'ignorado' } : p)))
      toast('Aviso ignorado')
    } finally {
      setProcesandoId(null)
    }
  }

  // Sin nada que mostrar, el panel no ocupa lugar en el PDV (ni deja una línea de borde suelta).
  // Tampoco se muestra si está apagado en Configuración → Yape.
  if (!activo) return null
  if (cargando) return null
  if (visibles.length === 0 && resumen.desconocidos === 0) return null

  const puedeCobrar = tienePermiso('cobrarVenta')

  return (
    <div className="space-y-2 border-b px-5 py-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Bell className="h-4 w-4 text-primary" />
          Yape
          {resumen.disponibles > 0 && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white num">
              {resumen.disponibles} · {fmt(resumen.montoDisponible)}
            </span>
          )}
        </h3>
        {conSonido && resumen.disponibles > 0 && <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>

      {visibles.map((pago) => {
        const situacion = situacionPagoYape(pago, { ahora, vigenciaMin })
        const coincide = coincideConTotal(pago, total)
        const enEstaVenta = pagoEnVentaId === pago.id
        const revision = aplicarYapeEnVenta(pago, total)
        const procesando = procesandoId === pago.id
        const restantes = minutosRestantesYape(pago, { ahora, vigenciaMin })
        const esPrueba = esAvisoDePrueba(pago)
        /** El código que Yape le muestra al que paga ('' si el aviso no lo trae). */
        const codigoSeguridad = codigoDeSeguridadYape(pago)
        /** Otros avisos **disponibles** por el mismo monto: con varias cajas, el monto no alcanza. */
        const repetidos = avisosDelMismoMonto(pago, pagos, { ahora, vigenciaMin })
        const pedirConfirmacion = confirmarAntesDeAplicar(pago, total)

        return (
          <div
            key={pago.id}
            className={cn(
              'rounded-xl border p-3 space-y-2',
              esPrueba
                ? 'border-dashed border-slate-400 bg-muted/30'
                : situacion === 'usado'
                  ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950'
                  : enEstaVenta
                    ? 'border-primary bg-primary/5'
                    : coincide
                      ? 'border-emerald-400 bg-card'
                      : 'bg-card',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-extrabold num">{fmt(pago.monto)}</span>
                  {esPrueba && (
                    <span className="rounded bg-slate-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      PRUEBA
                    </span>
                  )}
                  {coincide && situacion !== 'usado' && (
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                      coincide con el total
                    </span>
                  )}
                  {situacion === 'reservado' && !enEstaVenta && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
                      en uso{pago.reservadoPor ? ` por ${pago.reservadoPor}` : ''}
                    </span>
                  )}
                  {situacion === 'usado' && (
                    <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      usado{pago.documento ? ` en ${pago.documento}` : ''}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate text-sm font-semibold">
                  {pago.pagadorNombre || 'Sin nombre'}
                </p>
                {/* 🔑 La hora **con segundos** y el «hace 12 s» son el dato que permite reconocer el
                    aviso propio cuando varias cajas ven la misma lista: el monto solo no alcanza. */}
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className="num font-semibold text-foreground">{horaDeYape(pago.fecha)}</span>
                  <span>{haceCuantoYape(pago.fecha, ahora)}</span>
                  {pago.nroOperacion && <span className="num truncate">op. {pago.nroOperacion}</span>}
                </p>
              </div>
              {situacion === 'disponible' && (
                <span className="num shrink-0 text-[10px] font-bold text-muted-foreground">
                  {restantes <= 1 ? '⚠️ vence ya' : `vence en ${restantes} min`}
                </span>
              )}
            </div>

            {/* 🔑 El **código de seguridad** que Yape le muestra al que paga: el cliente lo dice o lo
                muestra y el cajero lo coteja acá. Es el control más rápido que hay, y hace falta
                porque estos avisos NO traen N° de operación (ver `codigoDeSeguridadYape`). */}
            {codigoSeguridad && situacion !== 'usado' && (
              <div className="flex items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  Código
                </span>
                <span className="num text-xl font-extrabold tracking-wider">{codigoSeguridad}</span>
                <span className="text-[10px] text-muted-foreground">
                  el que muestra el cliente en su Yape
                </span>
              </div>
            )}

            {esPrueba && situacion !== 'usado' && (
              <p className="text-[11px] text-muted-foreground">
                Aviso de <b>prueba</b> (creado en Configuración → Yape): <b>no entró plata</b>. Sirve
                para comprobar que el circuito funciona.
              </p>
            )}

            {/* ⚠️ Dos avisos por el mismo monto son indistinguibles por el monto: con varias cajas
                trabajando a la vez hay que decirlo, o el cajero elige a ciegas. */}
            {situacion === 'disponible' && repetidos.length > 0 && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                ⚠️ Hay <b>{repetidos.length + 1} avisos disponibles de {fmt(pago.monto)}</b>. Cotejá el{' '}
                <b>código de seguridad</b> (o el N° de operación) con lo que muestra el cliente antes de usar.
              </p>
            )}

            {situacion === 'usado' ? (
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                ✅ Confirmado{pago.usadoPor ? ` por ${pago.usadoPor}` : ''} en el comprobante.
              </p>
            ) : situacion === 'reservado' ? (
              <p className="text-[11px] text-muted-foreground">
                {enEstaVenta
                  ? 'En esta venta: el pago por Yape ya está cargado abajo.'
                  : 'Otra caja lo está usando. Si no se confirma en un par de minutos, se libera solo.'}
              </p>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1"
                  disabled={!puedeCobrar || procesando || !revision.ok}
                  title={revision.ok ? undefined : revision.motivo}
                  onClick={() => void usar(pago)}
                >
                  {procesando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Usar en esta venta
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={procesando}
                  onClick={() => void ignorar(pago)}
                  title="No corresponde a esta venta: deja de aparecer (queda registrado quién lo ignoró)"
                >
                  <BellOff className="h-3.5 w-3.5" />
                  Ignorar
                </Button>
              </div>
            )}

            {situacion === 'disponible' && !revision.ok && (
              <p className="text-[10px] text-muted-foreground">{revision.motivo}</p>
            )}

            {situacion === 'disponible' && revision.ok && pedirConfirmacion && (
              <p className="text-[10px] text-muted-foreground">
                No coincide con el total ({fmt(total)}): al usarlo te va a pedir confirmación.
              </p>
            )}
          </div>
        )
      })}

      {/* 🛡️ Un aviso con un estado que no se entiende significa que el **puente** (el que lee el
          aviso real) está escribiendo otra cosa: se dice, en vez de esconderlo. */}
      {resumen.desconocidos > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          ⚠️ Hay {resumen.desconocidos} aviso(s) de Yape con un estado que el sistema no reconoce. No se
          muestran para no aplicar algo que no se entiende: revisa el puente de Yape.
        </p>
      )}
    </div>
  )
}
