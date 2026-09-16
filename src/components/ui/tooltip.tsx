import * as React from 'react'
import { cn } from '@/lib/utils'

type TooltipProps = {
  children: React.ReactNode
  content: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

export function Tooltip({ children, content, side = 'top', className }: TooltipProps) {
  const [abierto, setAbierto] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const mostrar = React.useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setAbierto(true)
  }, [])

  const ocultar = React.useCallback(() => {
    timeoutRef.current = setTimeout(() => setAbierto(false), 100)
  }, [])

  const toggle = React.useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setAbierto((a) => !a)
  }, [])

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const posiciones = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={mostrar}
      onMouseLeave={ocultar}
      onTouchStart={toggle}
      ref={(el) => {
        if (el) {
          const handler = (e: MouseEvent) => {
            if (abierto && !(e.target as Element)?.closest?.('[data-tooltip]')) {
              setAbierto(false)
            }
          }
          document.addEventListener('click', handler)
          return () => document.removeEventListener('click', handler)
        }
      }}
    >
      {children}
      {abierto && (
        <div
          data-tooltip
          role="tooltip"
          className={cn(
            'absolute z-50 max-w-[220px] rounded-lg bg-gray-900 px-3 py-2 text-xs text-white shadow-lg animate-in fade-in-0 zoom-in-95',
            posiciones[side],
            className
          )}
        >
          {content}
          <div
            className={cn(
              'absolute h-2 w-2 rotate-45 bg-gray-900',
              side === 'top' && 'bottom-full left-1/2 -translate-x-1/2 translate-y-1',
              side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 -translate-y-1',
              side === 'left' && 'right-full top-1/2 -translate-y-1/2 translate-x-1',
              side === 'right' && 'left-full top-1/2 -translate-y-1/2 -translate-x-1'
            )}
          />
        </div>
      )}
    </div>
  )
}
