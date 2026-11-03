/**
 * **¿El respaldo está corriendo?** — tarjeta de estado del respaldo (03/10/2026).
 *
 * 🔑 **Por qué existe**: el respaldo corre solo a las 23:30 en la PC del negocio, y **hasta ahora no se
 * veía en ningún lado**: el **01/10/2026** no hubo copia (la PC estaba apagada) y se descubrió mirando la
 * carpeta a mano. La herramienta de respaldo deja un **latido** en `tblRespaldoEstado/<projectId>` y esta
 * tarjeta lo muestra: **último respaldo, cuánto copió y si salió bien**, con aviso si se atrasó.
 *
 * ⚠️ Es de **solo lectura** y no bloquea nada: informa. La regla de Firestore deja leer ese documento a
 * quien ve reportes (ADMIN y GERENTE) y **no deja escribirlo desde el app** (lo escribe la herramienta,
 * con la cuenta de servicio).
 */
import * as React from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, Clock, DatabaseBackup } from 'lucide-react'

import { db, PROYECTO_FIREBASE } from '@/lib/firebase'
import { COL } from '@/constants/colecciones'
import { COLORES_RESPALDO, estadoDelRespaldo, type EstadoRespaldoDatos } from '@/lib/respaldo-estado'
import { cn } from '@/lib/utils'

export function EstadoRespaldo() {
  const [datos, setDatos] = React.useState<EstadoRespaldoDatos | undefined>(undefined)

  // En vivo: cuando la herramienta avisa el latido, la tarjeta se actualiza sola.
  React.useEffect(() => {
    // ⚠️ Sin `setState` acá: un `setState` sincrónico dentro de un efecto son renders en cascada
    // (baseline de lint del repo). El caso «no hay project id» se resuelve **en el render**.
    if (!PROYECTO_FIREBASE) return
    const soltar = onSnapshot(
      doc(db, COL.RESPALDO_ESTADO, PROYECTO_FIREBASE),
      (snap) => setDatos(snap.exists() ? (snap.data() as EstadoRespaldoDatos) : null),
      (e) => {
        console.warn('⚠️ No se pudo leer el estado del respaldo:', e)
        setDatos(null)
      },
    )
    return soltar
  }, [])

  if (!PROYECTO_FIREBASE) return null
  if (datos === undefined) return null // todavía no se sabe: no se muestra nada (ni un parpadeo)

  const estado = estadoDelRespaldo(datos)
  const Icono = estado.nivel === 'ok' ? CheckCircle2 : estado.nivel === 'sin-datos' ? Clock : AlertTriangle

  return (
    <div
      className={cn(
        'rounded-xl border bg-card p-4 shadow-soft',
        estado.nivel === 'critico' && 'border-destructive/40',
        estado.nivel === 'atencion' && 'border-amber-400/50',
      )}
    >
      <div className="flex items-start gap-2">
        <DatabaseBackup className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icono className={cn('h-4 w-4 shrink-0', COLORES_RESPALDO[estado.nivel])} />
            <h3 className="font-bold">{estado.titulo}</h3>
          </div>
          {estado.detalle && <p className="mt-0.5 text-xs text-muted-foreground">{estado.detalle}</p>}
          <p className="mt-1 text-[10px] text-muted-foreground">
            El respaldo corre todos los días a las <b>23:30</b> en la PC del negocio (fuera del app) y se
            guarda 30 días. Esta tarjeta solo avisa cómo salió el último.
          </p>
        </div>
      </div>
    </div>
  )
}

export default EstadoRespaldo
