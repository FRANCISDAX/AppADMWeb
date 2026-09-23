import { Wifi, WifiOff } from 'lucide-react'
import * as React from 'react'
import {
  estadoDelPuente,
  minutosSinSenal,
  recomendacionDelPuente,
  textoDelPuente,
  textoUltimoAviso,
  type EstadoPuenteYape,
  type LatidoPuenteYape,
} from '@/lib/puente'
import { suscribirPuenteYape } from '@/services/puente'
import { cn } from '@/lib/utils'

/** Cómo se ve cada estado (una sola paleta para las dos pantallas que lo muestran). */
const ESTILO: Record<EstadoPuenteYape, string> = {
  activo: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  demorado: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200',
  caido: 'border-destructive/50 bg-destructive/10 text-destructive',
  'sin-datos': 'border-dashed text-muted-foreground',
}

/**
 * **El latido del puente de Yape**, tal como lo ve el cajero (en el PDV) y el dueño (en
 * Configuración → Yape).
 *
 * 🔑 **Para qué sirve**: el puente vive en **otro aparato** (el celular que recibe los yapeos), así
 * que un panel vacío significa dos cosas muy distintas: *«no yapeó nadie»* (si el puente late) o
 * *«el puente se murió y la plata entró igual»* (si no late). Hasta ahora las dos se veían iguales
 * desde la caja y el problema se descubría **al cerrar el turno**. La regla de cuándo está activo,
 * demorado o caído vive en `lib/puente.ts` (pura y testeada); acá solo se dibuja.
 *
 * ⚠️ **No es una garantía**: el ciclo es de 5 minutos (un puente puede morir justo después de latir
 * y el aviso tarda hasta ~12 min en aparecer) y **no recupera** los avisos del rato sin puente. El
 * control de la plata sigue siendo el **cruce del cierre**.
 */
export function EstadoPuenteYape({ compacto = false }: { compacto?: boolean }) {
  /** `undefined` = todavía leyendo (no se inventa un estado), `null` = el puente nunca escribió. */
  const [latido, setLatido] = React.useState<LatidoPuenteYape | null | undefined>(undefined)
  /** Se refresca solo para que «hace 12 min» no quede congelado. */
  const [ahora, setAhora] = React.useState(() => Date.now())

  React.useEffect(() => suscribirPuenteYape(setLatido), [])

  React.useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // Mientras se lee no se muestra nada: decir «puente activo» sin datos sería mentir.
  if (latido === undefined) return null

  const estado = estadoDelPuente(latido, ahora)
  const minutos = minutosSinSenal(latido, ahora)
  const Icono = estado === 'activo' ? Wifi : WifiOff

  return (
    <div
      className={cn('rounded-lg border px-2 py-1.5 text-[11px]', ESTILO[estado], compacto && 'space-y-0.5')}
      title={recomendacionDelPuente(latido, ahora)}
    >
      <p className="flex flex-wrap items-center gap-x-1.5 font-semibold">
        <Icono className="h-3.5 w-3.5 shrink-0" />
        {textoDelPuente(latido, ahora)}
        {estado !== 'activo' && estado !== 'sin-datos' && (
          <span className="num font-normal opacity-80">(late cada 5 min)</span>
        )}
      </p>
      {/* La instrucción solo cuando hay algo que hacer: en verde sería ruido. */}
      {estado !== 'activo' && <p className="mt-0.5 opacity-90">{recomendacionDelPuente(latido, ahora)}</p>}
      {!compacto && (
        <p className="mt-0.5 opacity-80">
          {textoUltimoAviso(latido, ahora)}
          {latido?.dispositivo ? ` · ${latido.dispositivo}` : ''}
          {latido?.version ? ` · puente v${latido.version}` : ''}
        </p>
      )}
      {/* Un puente de la versión vieja no informa cuándo mandó el último aviso ni cuántos mandó:
          se dice, en vez de dejar la línea incompleta sin explicación. */}
      {!compacto && estado !== 'sin-datos' && Number.isFinite(minutos) && !latido?.ultimoAvisoEn && (
        <p className="mt-0.5 opacity-70">
          Para ver «hace cuánto» del último aviso hace falta actualizar el puente del celular a la v1.3.
        </p>
      )}
    </div>
  )
}
