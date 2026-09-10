import { ChevronRight } from 'lucide-react'

type Props = {
  numTurnosCerrados: number
}

export function TurnosCerradosWidget({ numTurnosCerrados }: Props) {
  if (numTurnosCerrados <= 0) return null

  return (
    <div className="flex items-center gap-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
      <ChevronRight className="h-4 w-4" />
      <span>
        {numTurnosCerrados} turno{numTurnosCerrados !== 1 ? 's' : ''} cerrado{numTurnosCerrados !== 1 ? 's' : ''} hoy incluido{numTurnosCerrados !== 1 ? 's' : ''} en los totales
      </span>
    </div>
  )
}
