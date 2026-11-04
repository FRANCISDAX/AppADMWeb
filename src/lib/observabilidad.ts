/**
 * 🔑 **Observabilidad sin terceros: las reglas, en un solo lugar.**
 *
 * 📌 **Por qué existe** (03/11/2026): el app ya guardaba errores (`tblErrores`), latidos (`tblPuenteYape`,
 * `tblRespaldoEstado`) y un estado del sistema, pero **nadie los miraba juntos ni se veía la tendencia**:
 * `tblErrores` era una lista de documentos sueltos y la única forma de saber «¿esto pasa siempre o fue una
 * vez?» era leerla a ojo. Esto agrega lo que faltaba para usar esos datos:
 *
 * 1. **Agrupar** los errores por *huella* (contexto + mensaje normalizado), que es lo que un Sentry hace y
 *    acá no se podía: dos cajas con el mismo error son **un** problema, no dos.
 * 2. **Medir** el rendimiento real (Web Vitals) y resumirlo por día, en lugar de tener un número medido a
 *    mano una vez.
 * 3. Decidir con **umbrales explícitos** (los de Web Vitals) si un número está bien, regular o mal.
 *
 * ⚠️ **Todo acá es puro** (sin Firebase, sin React, sin `performance`): la captura vive en
 * `hooks/use-metricas.ts`, el guardado en `services/metricas.ts` y el dibujo en
 * `components/auditoria/ObservabilidadPanel.tsx`. Se testea en `lib/observabilidad.test.ts`.
 */

// ─── Errores: agrupación ─────────────────────────────────────────────────────

/** Lo mínimo de un error para poder agruparlo (una fila de `tblErrores`). */
export type ErrorObservado = {
  id?: string
  mensaje: string
  contexto: string
  /** ISO. Los registros viejos siempre lo tienen; si faltara, el grupo lo ignora. */
  fecha?: string
  usuario?: string | null
  dispositivo?: string | null
  /** Huella guardada al registrar. Si falta (errores viejos), se calcula igual. */
  huella?: string | null
}

/** Un problema agrupado: la misma falla repetida en varias cajas o momentos. */
export type GrupoDeErrores = {
  huella: string
  contexto: string
  /** El mensaje **más reciente** del grupo, que es el que mejor describe el estado actual. */
  mensaje: string
  cantidad: number
  primeraVez: string
  ultimaVez: string
  /** Quiénes lo vieron (sin repetir): dice si es de una caja o de todo el local. */
  usuarios: string[]
  /** Equipos (navegador/SO) donde apareció. */
  equipos: string[]
}

/**
 * Lo que cambia entre dos ocurrencias del *mismo* error: ids, números, horas, montos, tokens.
 * Si no se normalizara, «Error al cobrar 12» y «Error al cobrar 13» serían dos problemas distintos.
 */
const RUIDO_EN_MENSAJE: [RegExp, string][] = [
  // UUID / ids largos (Firestore: 20 caracteres alfanuméricos)
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#'],
  [/\b[0-9A-Za-z]{20,}\b/g, '#'],
  // Documentos del negocio (2026-9_BOLETA-B001-000001) y códigos (PED-000123)
  [/\b\d{4}-\d{1,2}_[A-Z]+-[A-Z0-9]+-\d+\b/g, '#'],
  [/\b[A-Z]{2,4}-\d{3,}\b/g, '#'],
  // Fechas, horas y números con decimales (montos, cantidades, ms)
  [/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '#'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '#'],
  [/\b\d+([.,]\d+)?\b/g, '#'],
  // URLs absolutas (la ruta cambia de equipo a equipo)
  [/https?:\/\/[^\s'"]+/gi, '<url>'],
]

/** El mensaje sin la parte que cambia en cada ocurrencia, en minúsculas y sin espacios de más. */
export function normalizarMensaje(mensaje: string): string {
  let texto = String(mensaje ?? '')
  for (const [patron, reemplazo] of RUIDO_EN_MENSAJE) texto = texto.replace(patron, reemplazo)
  return texto.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 300)
}

/**
 * 🔑 **La huella**: `contexto` + mensaje normalizado. Es la identidad del problema y tiene que ser
 * **estable entre equipos y versiones**, porque se guarda con el error y se usa para agrupar.
 * El contexto entra porque el mismo texto en dos pantallas es una causa distinta.
 */
export function huellaDeError(e: Pick<ErrorObservado, 'mensaje' | 'contexto'>): string {
  return `${String(e.contexto ?? '').trim()}|${normalizarMensaje(e.mensaje)}`.slice(0, 400)
}

/** Etiqueta corta del equipo, para el panel: «Chrome · Windows», «Safari · iOS». */
export function equipoDe(dispositivo: string | null | undefined): string {
  const ua = String(dispositivo ?? '')
  if (!ua) return 'equipo desconocido'
  const navegador = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Chrome\//.test(ua) ? 'Chrome'
        : /Firefox\//.test(ua) ? 'Firefox'
          : /Safari\//.test(ua) ? 'Safari'
            : 'otro navegador'
  const sistema = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
          : /Linux/.test(ua) ? 'Linux'
            : ''
  return sistema ? `${navegador} · ${sistema}` : navegador
}

/**
 * Agrupa los errores por huella y ordena por lo que más duele: **cantidad** y después **lo más reciente**.
 * ⚠️ Los errores viejos no traen `huella` guardada: se les calcula, así el panel funciona con el
 * histórico sin migrar nada.
 */
export function agruparErrores(errores: readonly ErrorObservado[], maxGrupos = 50): GrupoDeErrores[] {
  const grupos = new Map<string, GrupoDeErrores & { _visto: number }>()

  for (const e of errores) {
    const huella = e.huella?.trim() || huellaDeError(e)
    const fecha = String(e.fecha ?? '')
    // `> 0` = fecha válida: un registro sin fecha no puede ganar «lo más reciente» ni romper el orden.
    const cuando = fecha ? Date.parse(fecha) : 0
    const existente = grupos.get(huella)

    if (!existente) {
      grupos.set(huella, {
        huella,
        contexto: String(e.contexto ?? ''),
        mensaje: String(e.mensaje ?? ''),
        cantidad: 1,
        primeraVez: Number.isNaN(cuando) ? '' : fecha,
        ultimaVez: Number.isNaN(cuando) ? '' : fecha,
        usuarios: e.usuario ? [e.usuario] : [],
        equipos: e.dispositivo ? [equipoDe(e.dispositivo)] : [],
        _visto: Number.isNaN(cuando) ? 0 : cuando,
      })
      continue
    }

    existente.cantidad += 1
    if (!Number.isNaN(cuando) && cuando > 0) {
      if (cuando >= existente._visto) {
        existente._visto = cuando
        existente.ultimaVez = fecha
        existente.mensaje = String(e.mensaje ?? existente.mensaje)
      }
      // `primeraVez` vacía (0) se completa con la primera fecha válida que aparezca.
      if (!existente.primeraVez || Number.isNaN(Date.parse(existente.primeraVez))) existente.primeraVez = fecha
      else if (cuando < Date.parse(existente.primeraVez)) existente.primeraVez = fecha
    }
    if (e.usuario && !existente.usuarios.includes(e.usuario)) existente.usuarios.push(e.usuario)
    const equipo = e.dispositivo ? equipoDe(e.dispositivo) : null
    if (equipo && !existente.equipos.includes(equipo)) existente.equipos.push(equipo)
  }

  return [...grupos.values()]
    .sort((a, b) => b.cantidad - a.cantidad || b._visto - a._visto)
    .slice(0, maxGrupos)
    .map(({ _visto, ...g }) => g)
}

/** Los números del panel, en un solo objeto (para no recalcular en cada render). */
export function resumenDeErrores(errores: readonly ErrorObservado[]): {
  total: number
  grupos: GrupoDeErrores[]
  problemas: number
  usuarios: number
  equipos: number
} {
  const grupos = agruparErrores(errores)
  return {
    total: errores.length,
    grupos,
    problemas: grupos.length,
    usuarios: new Set(errores.map((e) => e.usuario).filter(Boolean)).size,
    equipos: new Set(errores.map((e) => equipoDe(e.dispositivo))).size,
  }
}

// ─── Rendimiento: Web Vitals ─────────────────────────────────────────────────

/** Las métricas que se capturan (nombres cortos, como los usa el panel y la colección). */
export type MetricaWeb = 'lcp' | 'inp' | 'cls' | 'fcp' | 'ttfb'
export const METRICAS_WEB: readonly MetricaWeb[] = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const

/** Cómo se llama cada una en pantalla. */
export const NOMBRE_METRICA: Record<MetricaWeb, string> = {
  lcp: 'LCP · aparece el catálogo',
  inp: 'INP · responde al toque',
  cls: 'CLS · la pantalla no salta',
  fcp: 'FCP · primer pintado',
  ttfb: 'TTFB · primera respuesta',
}

/** Cómo se lee la unidad de cada métrica (ms o «puntos» de CLS). */
export function formatoMetrica(metrica: MetricaWeb, valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return 's/d'
  if (metrica === 'cls') return valor.toFixed(3)
  return `${Math.round(valor)} ms`
}

/**
 * 🔑 **Umbrales oficiales de Web Vitals** (los publica web.dev), en **una sola regla**: `ok` / `atencion` /
 * `malo`. Se usan acá y en el panel, así el color y el número no pueden contradecirse.
 */
export const UMBRALES: Record<MetricaWeb, { ok: number; atencion: number }> = {
  lcp: { ok: 2500, atencion: 4000 },
  inp: { ok: 200, atencion: 500 },
  cls: { ok: 0.1, atencion: 0.25 },
  fcp: { ok: 1800, atencion: 3000 },
  ttfb: { ok: 800, atencion: 1800 },
}

export type NivelMetrica = 'ok' | 'atencion' | 'malo'

export function nivelDeMetrica(metrica: MetricaWeb, valor: number | null | undefined): NivelMetrica | null {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return null
  const u = UMBRALES[metrica]
  if (valor <= u.ok) return 'ok'
  if (valor <= u.atencion) return 'atencion'
  return 'malo'
}

/** Percentil (0-100) de una lista de números. Devuelve `null` si no hay muestras. */
export function percentil(valores: readonly number[], p: number): number | null {
  const limpios = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (limpios.length === 0) return null
  const posicion = Math.min(1, Math.max(0, p / 100)) * (limpios.length - 1)
  const abajo = Math.floor(posicion)
  const arriba = Math.ceil(posicion)
  if (abajo === arriba) return limpios[abajo]
  return limpios[abajo] + (limpios[arriba] - limpios[abajo]) * (posicion - abajo)
}

// ─── Métricas agregadas por día (`tblMetricas`) ──────────────────────────────

/**
 * Un día de métricas **de rendimiento**. Se guarda **agregado** (sumas y contadores, no cada muestra): una
 * escritura por visita en vez de una por métrica, y el panel divide.
 * `id` = fecha local `YYYY-MM-DD` (el día del negocio, no UTC: un turno de las 21:00 pertenece a ese día).
 *
 * ⚠️ **Acá NO va el conteo de errores**: los errores tienen **una sola fuente** (`tblErrores`, leído por
 * rango de fechas) y de ahí salen tanto los grupos como la serie diaria del panel. Tener un contador aparte
 * hacía que las barras por día y la lista agrupada **pudieran no coincidir** — dos fuentes del mismo número.
 * Ver `serieDeErrores()`.
 *
 * ⚠️ **Campos planos** (`suma_lcp`, `peor_inp`…) a propósito: `increment()` sobre un campo anidado obliga a
 * `FieldPath`, y así el servicio escribe `{ suma_lcp: increment(x), peor_lcp: max(...) }` sin trucos.
 */
export type DiaDeMetricas = {
  id: string
  /** Visitas medidas del día (denominador de los promedios). */
  muestras?: number
  suma_lcp?: number
  suma_inp?: number
  suma_cls?: number
  suma_fcp?: number
  suma_ttfb?: number
  // El promedio esconde el pico: se guarda también el peor valor del día.
  peor_lcp?: number
  peor_inp?: number
  peor_cls?: number
  peor_fcp?: number
  peor_ttfb?: number
}

/** Los dos acumuladores de una métrica, con el nombre real del campo en Firestore. */
export function campoDeMetrica(metrica: MetricaWeb, tipo: 'suma' | 'peor'): keyof DiaDeMetricas {
  return `${tipo}_${metrica}` as keyof DiaDeMetricas
}

/** El valor numérico de un campo de métrica (o `null` si el día no la midió). */
export function valorDeMetrica(dia: DiaDeMetricas, metrica: MetricaWeb, tipo: 'suma' | 'peor'): number | null {
  const v = dia[campoDeMetrica(metrica, tipo)]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** `YYYY-MM-DD` en hora local. Única implementación: la usan el servicio y el panel. */
export function diaDeHoy(ahora: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`
}

/** Resumen del período: promedio y peor de cada métrica. */
export type ResumenMetricas = {
  dias: number
  muestras: number
  porMetrica: { metrica: MetricaWeb; promedio: number | null; peor: number | null; nivel: NivelMetrica | null; dias: number }[]
}

export function resumirMetricas(dias: readonly DiaDeMetricas[]): ResumenMetricas {
  const ordenados = [...dias].sort((a, b) => a.id.localeCompare(b.id))
  const muestras = ordenados.reduce((s, d) => s + (d.muestras ?? 0), 0)

  const porMetrica = METRICAS_WEB.map((metrica) => {
    // 🔑 Se acumula por métrica: si un día no midió INP, las muestras de ese día no entran en el promedio
    // de INP. Dividir por el total de muestras haría que un día sin datos **hunda** el número.
    let suma = 0
    let muestrasDeLaMetrica = 0
    let diasConDato = 0
    let peor: number | null = null
    for (const d of ordenados) {
      const s = valorDeMetrica(d, metrica, 'suma')
      if (s !== null) {
        suma += s
        muestrasDeLaMetrica += d.muestras ?? 0
        diasConDato += 1
      }
      const p = valorDeMetrica(d, metrica, 'peor')
      if (p !== null && (peor === null || p > peor)) peor = p
    }
    const promedio = muestrasDeLaMetrica > 0 ? suma / muestrasDeLaMetrica : null
    return { metrica, promedio, peor, nivel: nivelDeMetrica(metrica, promedio), dias: diasConDato }
  })

  return { dias: ordenados.length, muestras, porMetrica }
}

// ─── Errores por día ────────────────────────────────────────────────────────

/** `YYYY-MM-DD` **local** de una fecha ISO. El día del negocio, no UTC. */
export function diaLocalDe(fechaIso: string | null | undefined): string {
  const d = fechaIso ? new Date(fechaIso) : new Date(Number.NaN)
  if (Number.isNaN(d.getTime())) return ''
  return diaDeHoy(d)
}

/**
 * 🔑 **La serie de errores por día, calculada de los MISMOS registros que se agrupan.**
 *
 * 📌 **Por qué no un contador aparte** (03/11/2026): la primera versión guardaba un contador diario en
 * `tblMetricas` y las barras salían de ahí mientras la lista agrupada salía de `tblErrores`: dos fuentes del
 * mismo número, que **podían no coincidir** (el contador suma todo; la lista muestra los últimos N). Es
 * exactamente la trampa que el repo evita: *si lo que se ve y lo que se cuenta salen de distinto lado, se
 * contradicen*. Ahora la serie y los grupos salen de la misma lectura.
 *
 * Devuelve **todos** los días del rango (con 0 si no hubo errores): un día sin errores es información.
 */
export function serieDeErrores(
  errores: readonly Pick<ErrorObservado, 'fecha'>[],
  dias: number,
  ahora: Date = new Date()
): { dia: string; cantidad: number }[] {
  const cuantos = Math.max(1, Math.floor(dias))
  const cubeta = new Map<string, number>()
  for (let i = cuantos - 1; i >= 0; i--) {
    const d = new Date(ahora)
    d.setDate(d.getDate() - i)
    cubeta.set(diaDeHoy(d), 0)
  }
  for (const e of errores) {
    const dia = diaLocalDe(e.fecha)
    // Los errores fuera del rango (o sin fecha válida) no entran: no son parte del período que se muestra.
    if (cubeta.has(dia)) cubeta.set(dia, (cubeta.get(dia) ?? 0) + 1)
  }
  return [...cubeta.entries()].map(([dia, cantidad]) => ({ dia, cantidad }))
}

/**
 * Los eventos que se guardan con cada error (bitácora de la sesión). Se limita el largo para que un
 * documento de error no crezca sin techo.
 */
export type LineaBitacora = { t: number; tipo: string; detalle?: string }

/** Texto plano de la bitácora, como se guarda en el documento del error. */
export function textoDeBitacora(eventos: readonly LineaBitacora[], maximo = 20): string[] {
  return eventos.slice(-maximo).map((e) => `${e.tipo}${e.detalle ? `: ${e.detalle}` : ''}`.slice(0, 160))
}
