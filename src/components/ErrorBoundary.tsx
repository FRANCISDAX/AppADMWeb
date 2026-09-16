import * as React from 'react'
import { ErrorFallback } from '@/components/ErrorFallback'
import { registrarError } from '@/services/errores'

type Props = {
  children: React.ReactNode
  /** De dónde viene lo que envuelve: `render`, `pantalla:pdv`, … */
  contexto?: string
  /** Permite reemplazar la pantalla de error sin tocar el boundary. */
  fallback?: (args: { error: Error; contexto: string; reintentar: () => void; recargar: () => void }) => React.ReactNode
}

type State = { error: Error | null }

/**
 * Aísla un trozo de la app: si algo revienta **dentro**, se muestra un mensaje
 * claro en lugar de la pantalla en blanco, y el error queda registrado.
 *
 * Se usa dos veces (arquitectura de contención):
 * - en `main.tsx`, envolviendo toda la app (último recurso);
 * - en `App.tsx`, alrededor del contenido de cada sección, para que un fallo en
 *   una pantalla no se lleve puesto el menú ni la navegación.
 *
 * Es un componente de clase porque React no tiene hoy otra forma de capturar
 * errores de render (`componentDidCatch`).
 *
 * Para que un fallo no deje la sección inutilizable, se monta con `key={seccion}`:
 * al cambiar de pantalla React lo vuelve a montar y el error se limpia solo
 * (recuperación por remontaje, sin `setState` en el ciclo de vida).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    void registrarError(error, this.props.contexto ?? 'render', {
      componente: (info.componentStack ?? '').slice(0, 800),
    })
  }

  private reintentar = (): void => this.setState({ error: null })

  private recargar = (): void => {
    if (typeof window !== 'undefined') window.location.reload()
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    const contexto = this.props.contexto ?? 'render'
    if (this.props.fallback) {
      return this.props.fallback({ error, contexto, reintentar: this.reintentar, recargar: this.recargar })
    }
    return <ErrorFallback error={error} contexto={contexto} onReintentar={this.reintentar} onRecargar={this.recargar} />
  }
}
