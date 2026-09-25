/**
 * **Alertas proactivas**: lo que ya está mal **ahora** y que hasta hoy se descubría solo si alguien
 * entraba a mirar la pantalla que correspondía.
 *
 * 🔑 **Por qué existe** (pedido del usuario, 24/09/2026): el app ya **guarda** todo lo necesario
 * para saber que algo anda mal (el latido del puente, los turnos sin cerrar, el stock bajo, los
 * avisos de Yape sin usar, las diferencias de caja, los descuentos y las anulaciones), pero **nadie
 * lo mira**: `Auditoria` es a posteriori (hay que entrar y buscar) y los avisos de la app
 * (`components/notifications.tsx`) cuentan lo que **acaba de pasar**, no lo que está pasando. El
 * caso testigo es el puente caído: la plata entra al Yape del negocio y el PDV no muestra nada
 * hasta que alguien cierra el turno y ve *«hubo cobros por Yape y ningún aviso»*.
 *
 * 🔑 **Este módulo es la REGLA ÚNICA**: las pantallas no deciden nada por su cuenta, solo dibujan
 * lo que sale de acá. Los textos que ya existían (`textoDelPuente`, `recomendacionDelPuente`) se
 * **reusan** en vez de reescribirlos: si el PDV dice una cosa y el tablero otra, el usuario deja de
 * creerle a los dos.
 *
 * ⚠️ **Una alerta es un AVISO, no un candado** (mismo criterio que el cruce del cierre de Yape):
 * ninguna de estas reglas bloquea una venta, un cierre o un cobro. El sistema no le impone al
 * negocio lo que es «normal»; le muestra lo que se sale de lo que él mismo configuró.
 *
 * ⚠️ **Los umbrales con `0` están APAGADOS** (misma convención que `descuentoMaximoPorcentaje` y
 * `limiteCredito`), y los que no están configurados (una config guardada **antes** de esta función)
 * usan el valor por defecto de acá abajo: una config vieja no pierde las alertas útiles.
 *
 * ⚠️ **Solo web**: la RN no tiene este módulo (decisión del usuario, 24/09/2026).
 */
import {
  estadoDelPuente,
  minutosSinSenal,
  recomendacionDelPuente,
  textoDelPuente,
  type LatidoPuenteYape,
} from './puente.ts'
import {
  avisoYapeActivo,
  esAvisoDePrueba,
  etiquetaYape,
  haceCuantoYape,
  msDeFechaYape,
  situacionPagoYape,
  textoMonto,
  vigenciaYapeMinutos,
  type ConfigYape,
  type PagoYape,
} from './yape.ts'

// ─── Umbrales (los mismos números que arranca `CONFIG_POR_DEFECTO`) ───────────

/** Avisar por stock **agotado** y **bajo el mínimo**. Ausente = sí. */
export const ALERTA_STOCK_POR_DEFECTO = true
/** Minutos que un aviso de Yape puede quedar sin usar antes de avisar. `0` = apagada. */
export const ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO = 15
/** Horas que un turno puede estar abierto antes de avisar. `0` = apagada. */
export const ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO = 12
/** Diferencia de caja (en soles, sin importar el signo) que amerita un aviso. `0` = apagada. */
export const ALERTA_DIFERENCIA_CAJA_POR_DEFECTO = 1
/** Anulaciones en el día a partir de las cuales avisar. `0` = apagada. */
export const ALERTA_ANULACIONES_DIA_POR_DEFECTO = 3
/** Descuento (en % del bruto) a partir del cual avisar. `0` = apagada. */
export const ALERTA_DESCUENTO_PORCENTAJE_POR_DEFECTO = 0

/**
 * Lo que la app entiende de la configuración del negocio para armar alertas.
 * ⚠️ Todos opcionales: una config guardada antes de esta función no rompe nada.
 */
export type ConfigAlertas = ConfigYape & {
  alertaStockBajo?: boolean
  alertaYapeSinUsarMinutos?: number
  alertaTurnoAbiertoHoras?: number
  alertaDiferenciaCaja?: number
  alertaAnulacionesDia?: number
  alertaDescuentoPorcentaje?: number
}

/** Los umbrales ya resueltos (con los valores por defecto aplicados). */
export type UmbralesAlertas = {
  stockBajo: boolean
  yapeSinUsarMin: number
  turnoAbiertoHoras: number
  diferenciaCaja: number
  anulacionesDia: number
  descuentoPorcentaje: number
}

/** Resuelve los umbrales, aplicando el valor por defecto cuando el campo no está (o no es número). */
export function umbralesAlertas(config?: ConfigAlertas | null): UmbralesAlertas {
  const num = (v: unknown, porDefecto: number) => {
    const n = Number(v)
    // `0` es un valor VÁLIDO (apagada): solo se cae al default cuando el campo no está.
    return v == null || v === '' || !Number.isFinite(n) ? porDefecto : n
  }
  return {
    stockBajo: config?.alertaStockBajo !== false,
    yapeSinUsarMin: num(config?.alertaYapeSinUsarMinutos, ALERTA_YAPE_SIN_USAR_MINUTOS_POR_DEFECTO),
    turnoAbiertoHoras: num(config?.alertaTurnoAbiertoHoras, ALERTA_TURNO_ABIERTO_HORAS_POR_DEFECTO),
    diferenciaCaja: num(config?.alertaDiferenciaCaja, ALERTA_DIFERENCIA_CAJA_POR_DEFECTO),
    anulacionesDia: num(config?.alertaAnulacionesDia, ALERTA_ANULACIONES_DIA_POR_DEFECTO),
    descuentoPorcentaje: num(config?.alertaDescuentoPorcentaje, ALERTA_DESCUENTO_PORCENTAJE_POR_DEFECTO),
  }
}

// ─── Tipos ──────────────────────────────────────────────────────────────────

export type SeveridadAlerta = 'critico' | 'aviso' | 'info'

/** Qué regla la produjo. Sirve para agrupar y para que los tests fallen con el nombre a la vista. */
export type ReglaAlerta =
  | 'puente'
  | 'turno-abierto'
  | 'stock-agotado'
  | 'stock-bajo'
  | 'yape-sin-usar'
  | 'yape-raro'
  | 'diferencia-caja'
  | 'anulaciones'
  | 'descuentos'

export type Alerta = {
  /**
   * 🔑 **Id ESTABLE** (no depende de los números ni de la fecha): es lo que permite **posponer** una
   * alerta sin que vuelva a aparecer en la próxima recarga. Si el id cambiara con cada venta, el
   * «pospuesta» no serviría para nada.
   */
  id: string
  regla: ReglaAlerta
  severidad: SeveridadAlerta
  titulo: string
  detalle: string
  /** Qué hacer, en una línea. Un aviso sin instrucción deja al usuario sin saber si corre o sigue. */
  accion: string
  /** Sección del app a la que lleva el «Ver» (las mismas claves de `App.tsx`). */
  seccion?: string
}

/** Lo mínimo que se necesita de un producto del catálogo (el tipo real vive en `use-productos`). */
export type ProductoAlerta = {
  id: string
  nombre?: string
  stock?: number
  minStock?: number
  activo?: boolean
}

/** Un turno, como lo lee la app (`services/turnos.ts`). */
export type TurnoAlerta = {
  id?: string
  usuarioNombre?: string
  cajaId?: string
  estado?: string
  fechaApertura?: unknown
  diferencia?: number
}

/**
 * Un documento de venta, ya aplanado por el service.
 * ⚠️ La venta va **anidada** en `venta` (así la escribe `registrarVenta`): el total cobrado es
 * `venta.total` y el descuento `venta.descuentoTotal`, **no** los campos del nivel de arriba.
 */
export type DocumentoAlerta = {
  id?: string
  tipoDoc?: string
  serieNumero?: string
  estado?: string
  cajero?: string
  fecha?: unknown
  venta?: {
    total?: number
    importe_total?: number
    descuentoTotal?: number
  }
}

/** Todo lo que hace falta para evaluar. Lo arma `services/alertas.ts` (+ el catálogo del hook). */
export type ContextoAlertas = {
  /** «Ahora» en ms. Se pasa explícito para poder testear. */
  ahora?: number
  config?: ConfigAlertas | null
  latido?: LatidoPuenteYape | null
  productos?: readonly ProductoAlerta[]
  turnosAbiertos?: readonly TurnoAlerta[]
  /** Turnos **cerrados hoy** (los que ya tienen `diferencia`). */
  turnosCerradosHoy?: readonly TurnoAlerta[]
  /** Documentos del día, **incluidas** las anulaciones. */
  documentosHoy?: readonly DocumentoAlerta[]
  /** Avisos de Yape del día (los mismos que ve el panel del PDV). */
  avisosYape?: readonly PagoYape[]
}

// ─── Utilidades de texto ────────────────────────────────────────────────────

const soles = (n: number) => `S/ ${(Number(n) || 0).toFixed(2)}`

/** Hasta 4 nombres y «y N más»: una alerta no puede ocupar media pantalla. */
export function listarNombres(nombres: readonly string[], max = 4): string {
  const limpios = nombres.map((n) => String(n || 'Sin nombre')).slice(0, max)
  const resto = nombres.length - limpios.length
  return resto > 0 ? `${limpios.join(', ')} y ${resto} más` : limpios.join(', ')
}

/** Hora local `HH:MM` de una fecha (tolerante: el dato puede venir de otro proceso o colección). */
export function horaLocal(valor: unknown): string {
  const ms = msDeFechaYape(valor)
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** ¿La fecha cae en un día local anterior a «ahora»? */
function esDeOtroDia(valor: unknown, ahora: number): boolean {
  const ms = msDeFechaYape(valor)
  if (!ms) return false
  const a = new Date(ms)
  const b = new Date(ahora)
  return (
    a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
  )
}

function horasDesde(valor: unknown, ahora: number): number {
  const ms = msDeFechaYape(valor)
  if (!ms) return 0
  return Math.max(0, (ahora - ms) / 3600000)
}

// ─── Reglas ─────────────────────────────────────────────────────────────────

/**
 * **El puente de Yape**: la regla más valiosa de todas, porque es la única que avisa de algo que
 * **no se ve desde la caja**. Un puente caído y «no yapeó nadie» se ven idénticos en el panel del
 * PDV; la diferencia es que en uno **la plata entró igual**. Ver `lib/puente.ts`.
 */
export function alertaPuente(ctx: ContextoAlertas, ahora: number): Alerta | null {
  if (!avisoYapeActivo(ctx.config)) return null
  const estado = estadoDelPuente(ctx.latido, ahora)
  if (estado === 'activo') return null
  const minutos = minutosSinSenal(ctx.latido, ahora)
  const comun = {
    id: 'puente',
    regla: 'puente' as const,
    detalle: textoDelPuente(ctx.latido, ahora),
    accion: recomendacionDelPuente(ctx.latido, ahora),
    seccion: 'pdv',
  }
  if (estado === 'sin-datos') {
    return {
      ...comun,
      severidad: 'critico',
      titulo: 'El puente de Yape nunca dio señales',
    }
  }
  if (estado === 'demorado') {
    // «Demorado» son dos ciclos de silencio: puede ser un bache de red del celular. Se avisa, pero
    // no se grita: si se grita de más, el usuario aprende a ignorar el rojo.
    return {
      ...comun,
      severidad: 'aviso',
      titulo: `El puente de Yape no da señales desde hace ${minutos} min`,
    }
  }
  return {
    ...comun,
    severidad: 'critico',
    titulo: `El puente de Yape está caído hace ${minutos} min`,
  }
}

/**
 * **Turnos abiertos.** Un turno abierto normal **no es una alerta** (es la caja trabajando): se
 * informa quién la tiene. Lo que sí avisa es un turno **de otro día** sin cerrar — esa plata nunca
 * se rindió y el arqueo del día no la ve — y, si el negocio lo configuró, un turno abierto
 * demasiadas horas.
 */
export function alertaTurnoAbierto(ctx: ContextoAlertas, ahora: number): Alerta | null {
  const abiertos = ctx.turnosAbiertos ?? []
  if (abiertos.length === 0) return null
  const umbrales = umbralesAlertas(ctx.config)
  const quien = (t: TurnoAlerta) => `${t.usuarioNombre || 'Sin nombre'} (desde las ${horaLocal(t.fechaApertura)})`

  const viejos = abiertos.filter((t) => esDeOtroDia(t.fechaApertura, ahora))
  if (viejos.length > 0) {
    return {
      id: 'turno-abierto',
      regla: 'turno-abierto',
      severidad: 'critico',
      titulo:
        viejos.length === 1
          ? 'Hay un turno de otro día sin cerrar'
          : `Hay ${viejos.length} turnos de otros días sin cerrar`,
      detalle: `${listarNombres(viejos.map(quien), 3)}. Un turno abierto no tiene contado, así que esa plata no se rindió.`,
      accion: 'Ciérralo desde Turnos (o Arqueo de caja) con el conteo real del cajón.',
      seccion: 'turnos',
    }
  }

  if (umbrales.turnoAbiertoHoras > 0) {
    const largos = abiertos.filter((t) => horasDesde(t.fechaApertura, ahora) >= umbrales.turnoAbiertoHoras)
    if (largos.length > 0) {
      return {
        id: 'turno-abierto',
        regla: 'turno-abierto',
        severidad: 'aviso',
        titulo: `${largos.length === 1 ? 'Un turno lleva' : `${largos.length} turnos llevan`} más de ${umbrales.turnoAbiertoHoras} h abiertos`,
        detalle: `${listarNombres(largos.map(quien), 3)}. Un turno largo junta muchas ventas en un solo documento y hace más difícil ubicar un descuadre.`,
        accion: 'Si el turno ya terminó, ciérralo; si el local sigue abierto, partí el día en turnos (mañana / tarde).',
        seccion: 'turnos',
      }
    }
  }

  return {
    id: 'turno-abierto',
    regla: 'turno-abierto',
    severidad: 'info',
    titulo: abiertos.length === 1 ? 'Caja abierta' : `${abiertos.length} cajas abiertas`,
    detalle: listarNombres(abiertos.map(quien), 4),
    accion: 'Nada que hacer: es la caja que está trabajando.',
    seccion: 'turnos',
  }
}

/**
 * **Stock.** Dos alertas separadas a propósito: *agotado* es una **venta perdida** (crítico) y
 * *bajo el mínimo* es un **aviso** para pedir antes de que se corte. Un producto con `minStock` en
 * `0` (el caso de casi todo el catálogo cargado rápido) **solo** puede disparar la de agotado —
 * igual que en `estadoStock()`, no se inventa un mínimo que el negocio no puso.
 */
export function alertasStock(ctx: ContextoAlertas): Alerta[] {
  const umbrales = umbralesAlertas(ctx.config)
  if (!umbrales.stockBajo) return []
  const activos = (ctx.productos ?? []).filter((p) => p.activo !== false)
  const agotados = activos.filter((p) => (Number(p.stock) || 0) <= 0)
  const bajos = activos.filter((p) => {
    const s = Number(p.stock) || 0
    const m = Number(p.minStock) || 0
    return s > 0 && m > 0 && s <= m
  })
  const salida: Alerta[] = []
  if (agotados.length > 0) {
    salida.push({
      id: 'stock-agotado',
      regla: 'stock-agotado',
      severidad: 'critico',
      titulo: `${agotados.length} producto(s) agotados`,
      detalle: `${listarNombres(agotados.map((p) => p.nombre || p.id))}. Un producto agotado no se puede vender: el cajero lo descubre con el cliente adelante.`,
      accion: 'Carga la compra en Inventario o revisa si el stock quedó mal por un ajuste.',
      seccion: 'inventario',
    })
  }
  if (bajos.length > 0) {
    salida.push({
      id: 'stock-bajo',
      regla: 'stock-bajo',
      severidad: 'aviso',
      titulo: `${bajos.length} producto(s) bajo el mínimo`,
      detalle: `${listarNombres(bajos.map((p) => p.nombre || p.id))}.`,
      accion: 'Pídele al proveedor antes de que se corte (el mínimo se carga por producto en Inventario).',
      seccion: 'inventario',
    })
  }
  return salida
}

/**
 * **Avisos de Yape sin usar.** Un aviso **vencido** con `estado: 'disponible'` significa que el
 * cliente yapeó y nadie lo aplicó a una venta… **o** que entró plata que no era de una venta (el
 * Yape del negocio también recibe pagos personales). Por eso la severidad es **aviso** y no
 * crítico, y la acción incluye la salida honesta: **ignorarlo** para que deje de figurar.
 *
 * ⚠️ Un aviso `ignorado` o `anulado` **no** es una alerta: alguien ya decidió sobre él.
 */
export function alertasYape(ctx: ContextoAlertas, ahora: number): Alerta[] {
  if (!avisoYapeActivo(ctx.config)) return []
  const umbrales = umbralesAlertas(ctx.config)
  const vigenciaMin = vigenciaYapeMinutos(ctx.config)
  const opciones = { ahora, vigenciaMin }
  const propios = (ctx.avisosYape ?? []).filter((p) => !esAvisoDePrueba(p))
  const salida: Alerta[] = []

  // Solo los que pasaron el umbral configurado: los recién llegados se ven en el PDV y no son noticia.
  const esperaMin = Math.max(0, umbrales.yapeSinUsarMin)
  const sinUsar = propios.filter((p) => {
    if (esperaMin === 0) return false
    const minutos = (ahora - (Number(p.fecha) || 0)) / 60000
    return minutos >= esperaMin && situacionPagoYape(p, opciones) === 'vencido'
  })
  if (sinUsar.length > 0) {
    const total = sinUsar.reduce((s, p) => s + (Number(p.monto) || 0), 0)
    salida.push({
      id: 'yape-sin-usar',
      regla: 'yape-sin-usar',
      severidad: 'aviso',
      titulo:
        sinUsar.length === 1
          ? `Un aviso de Yape de ${textoMonto(sinUsar[0].monto)} sigue sin usar`
          : `${sinUsar.length} avisos de Yape siguen sin usar (${soles(total)})`,
      detalle: listarNombres(
        sinUsar.map((p) => `${etiquetaYape(p)} (${haceCuantoYape(Number(p.fecha) || 0, ahora)})`),
        3,
      ),
      accion:
        'Si era el pago de una venta, revisa esa caja; si no era de una venta (o ya lo cobraste por otro medio), marcalo como ignorado para que deje de figurar.',
      seccion: 'pdv',
    })
  }

  const raros = propios.filter((p) => situacionPagoYape(p, opciones) === 'desconocido')
  if (raros.length > 0) {
    salida.push({
      id: 'yape-raro',
      regla: 'yape-raro',
      severidad: 'aviso',
      titulo: `${raros.length} aviso(s) de Yape con un estado que el sistema no reconoce`,
      detalle: `${listarNombres(raros.map((p) => etiquetaYape(p)), 3)}. Un aviso con un estado desconocido no se puede usar en el PDV: se muestra para que el problema no pase inadvertido.`,
      accion: 'Revisa la versión del puente instalada en el celular: probablemente escribe un estado que esta versión del app no conoce.',
      seccion: 'reportes',
    })
  }
  return salida
}

/**
 * **Diferencias de caja.** Solo mira los turnos **ya cerrados** (`diferencia` existe recién al
 * cerrar). El umbral es en soles y **sin importar el signo**: un faltante y un sobrante se revisan
 * igual, y el detalle dice cuál es.
 */
export function alertaDiferenciaCaja(ctx: ContextoAlertas): Alerta | null {
  const umbral = umbralesAlertas(ctx.config).diferenciaCaja
  if (umbral <= 0) return null
  const conDiferencia = (ctx.turnosCerradosHoy ?? []).filter(
    (t) => Math.abs(Number(t.diferencia) || 0) >= umbral,
  )
  if (conDiferencia.length === 0) return null
  // ⚠️ Se suman los **valores absolutos**: un faltante y un sobrante del mismo monto no se cancelan
  // (la plata no volvió al cajón por arte de magia: son dos cosas para revisar).
  const total = conDiferencia.reduce((s, t) => s + Math.abs(Number(t.diferencia) || 0), 0)
  const primera = Number(conDiferencia[0].diferencia) || 0
  return {
    id: 'diferencia-caja',
    regla: 'diferencia-caja',
    severidad: 'aviso',
    titulo:
      conDiferencia.length === 1
        ? `Cierre con ${primera < 0 ? 'faltante' : 'sobrante'} de ${soles(Math.abs(primera))}`
        : `${conDiferencia.length} cierres con diferencia (${soles(total)} en total)`,
    detalle: listarNombres(
      conDiferencia.map((t) => {
        const d = Number(t.diferencia) || 0
        return `${t.usuarioNombre || 'Sin nombre'}: ${d < 0 ? 'faltante' : 'sobrante'} de ${soles(Math.abs(d))}`
      }),
      3,
    ),
    accion: 'Mira el arqueo de ese turno: si el conteo estuvo mal, se rectifica con permiso y queda registrado.',
    seccion: 'auditoriaCaja',
  }
}

/**
 * **Anulaciones del día.** No dice que esté mal anular (pasa todos los días): dice que **hoy** se
 * anuló más de lo que el negocio considera normal, y **quién** lo hizo — que es el dato que no está
 * en ninguna pantalla sin buscarlo.
 */
export function alertaAnulaciones(ctx: ContextoAlertas): Alerta | null {
  const lim = umbralesAlertas(ctx.config).anulacionesDia
  if (lim <= 0) return null
  const anuladas = (ctx.documentosHoy ?? []).filter((d) => String(d.estado ?? '') === 'anulada')
  if (anuladas.length < lim) return null
  const porCajero = new Map<string, number>()
  for (const d of anuladas) {
    const k = String(d.cajero ?? '').trim() || 'Sin cajero'
    porCajero.set(k, (porCajero.get(k) || 0) + 1)
  }
  const detalle = [...porCajero.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
  return {
    id: 'anulaciones',
    regla: 'anulaciones',
    severidad: 'aviso',
    titulo: `${anuladas.length} comprobantes anulados hoy`,
    detalle: `${detalle.join(' · ')}. El umbral configurado es ${lim}.`,
    accion: 'Mira el motivo de cada anulación en Auditoría; si son ventas reales anuladas para no declararlas, es un problema fiscal, no de caja.',
    seccion: 'auditoria',
  }
}

/**
 * **Descuentos fuera de rango.** Mide el descuento sobre el **bruto** (`total + descuento`), que es
 * la única base con la que un porcentaje significa algo. ⚠️ El tope del descuento manual
 * (`descuentoMaximoPorcentaje`) es un control **distinto** y ya actúa en el PDV: esta alerta mira lo
 * que **igual** quedó registrado (incluye las ventas del admin, que no pasan por ese tope).
 */
export function alertaDescuentos(ctx: ContextoAlertas): Alerta | null {
  const lim = umbralesAlertas(ctx.config).descuentoPorcentaje
  if (lim <= 0) return null
  const casos: { etiqueta: string; pct: number; monto: number; cajero: string }[] = []
  for (const d of ctx.documentosHoy ?? []) {
    if (String(d.estado ?? '') === 'anulada') continue
    const desc = Number(d.venta?.descuentoTotal) || 0
    if (desc <= 0) continue
    const total = Number(d.venta?.importe_total ?? d.venta?.total ?? 0) || 0
    const bruto = total + desc
    if (bruto <= 0) continue
    const pct = (desc / bruto) * 100
    if (pct > lim) {
      casos.push({
        etiqueta: String(d.serieNumero || d.id || 'documento'),
        pct,
        monto: desc,
        cajero: String(d.cajero ?? '').trim() || 'Sin cajero',
      })
    }
  }
  if (casos.length === 0) return null
  casos.sort((a, b) => b.pct - a.pct)
  return {
    id: 'descuentos',
    regla: 'descuentos',
    severidad: 'aviso',
    titulo: `${casos.length} venta(s) con descuento mayor a ${lim}%`,
    detalle: listarNombres(
      casos.map((c) => `${c.etiqueta}: ${c.pct.toFixed(1)}% (${soles(c.monto)}) · ${c.cajero}`),
      3,
    ),
    accion: 'Revisa si el descuento estaba autorizado. (Este aviso es de control: no bloquea la venta.)',
    seccion: 'reportes',
  }
}

// ─── Evaluación ─────────────────────────────────────────────────────────────

const ORDEN: Record<SeveridadAlerta, number> = { critico: 0, aviso: 1, info: 2 }

/**
 * Corre todas las reglas y devuelve las alertas **ordenadas por severidad** (lo crítico primero) y,
 * dentro de cada severidad, en el orden en que las produce el sistema (las reglas más graves están
 * primero) — el orden es estable para que la lista no baile entre recargas.
 */
export function evaluarAlertas(ctx: ContextoAlertas): Alerta[] {
  const ahora = ctx.ahora ?? Date.now()
  const alertas: Alerta[] = []
  const puente = alertaPuente(ctx, ahora)
  if (puente) alertas.push(puente)
  const turno = alertaTurnoAbierto(ctx, ahora)
  if (turno) alertas.push(turno)
  alertas.push(...alertasStock(ctx))
  const dif = alertaDiferenciaCaja(ctx)
  if (dif) alertas.push(dif)
  alertas.push(...alertasYape(ctx, ahora))
  const anul = alertaAnulaciones(ctx)
  if (anul) alertas.push(anul)
  const desc = alertaDescuentos(ctx)
  if (desc) alertas.push(desc)
  return alertas.sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad])
}

/** Cuántas cosas hay para mirar (lo crítico y lo que amerita un aviso; lo informativo no cuenta). */
export function contarPendientes(alertas: readonly Alerta[]): number {
  return alertas.filter((a) => a.severidad !== 'info').length
}

/**
 * Las alertas que corresponden mostrar **ahora**: las pospuestas quedan ocultas hasta su hora.
 * ⚠️ Lo **informativo** (por ejemplo «caja abierta») no se pospone nunca: no molesta a nadie y es
 * contexto útil.
 */
export function alertasVisibles(
  alertas: readonly Alerta[],
  opciones: { pospuestas?: Record<string, number>; ahora?: number } = {},
): Alerta[] {
  const ahora = opciones.ahora ?? Date.now()
  const pospuestas = opciones.pospuestas ?? {}
  return alertas.filter((a) => {
    if (a.severidad === 'info') return true
    const hasta = Number(pospuestas[a.id]) || 0
    return hasta <= ahora
  })
}

/** El texto del encabezado de la tarjeta. Una sola frase para todas las pantallas. */
export function resumenAlertas(alertas: readonly Alerta[]): string {
  const criticos = alertas.filter((a) => a.severidad === 'critico').length
  const avisos = alertas.filter((a) => a.severidad === 'aviso').length
  if (criticos > 0 && avisos > 0) return `${criticos} urgente(s) y ${avisos} para revisar`
  if (criticos > 0) return `${criticos} urgente(s)`
  if (avisos > 0) return `${avisos} para revisar`
  return 'Todo en orden'
}
