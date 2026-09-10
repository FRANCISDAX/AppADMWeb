import * as React from 'react'
import { useAuth } from '@/context/auth'
import { cargarWidgetOrder, guardarWidgetOrder } from '@/services/dashboard'
import { WIDGETS_POR_DEFECTO, type DashboardWidget, type DashboardWidgetId } from '@/components/dashboard/types'
import { useToast } from '@/lib/ui-utils'

export function useDashboardWidgets() {
  const { user } = useAuth()
  const [widgets, setWidgets] = React.useState<DashboardWidget[]>(WIDGETS_POR_DEFECTO)
  const [editando, setEditando] = React.useState(false)
  const [cargando, setCargando] = React.useState(true)
  const { setToast } = useToast()

  React.useEffect(() => {
    if (!user) return
    let mounted = true
    cargarWidgetOrder(user.uid).then((w) => {
      if (mounted) {
        setWidgets(w)
        setCargando(false)
      }
    })
    return () => { mounted = false }
  }, [user])

  const toggleWidget = React.useCallback((id: DashboardWidgetId) => {
    setWidgets((prev) => prev.map((w) => w.id === id ? { ...w, visible: !w.visible } : w))
  }, [])

  const reordenar = React.useCallback((fromIndex: number, toIndex: number) => {
    setWidgets((prev) => {
      const copia = [...prev]
      const [movido] = copia.splice(fromIndex, 1)
      copia.splice(toIndex, 0, movido)
      return copia.map((w, i) => ({ ...w, orden: i }))
    })
  }, [])

  const guardar = React.useCallback(async () => {
    if (!user) return
    try {
      await guardarWidgetOrder(user.uid, widgets)
      setEditando(false)
      setToast('✅ Dashboard actualizado')
    } catch {
      setToast('❌ Error al guardar')
    }
  }, [user, widgets, setToast])

  const widgetsVisibles = React.useMemo(
    () => widgets.filter((w) => w.visible).sort((a, b) => a.orden - b.orden),
    [widgets]
  )

  const widgetsColumnaIzq = React.useMemo(
    () => widgetsVisibles.filter((w) => ['ventasMes', 'ventasDiarias', 'ventasCategoria', 'topProductos'].includes(w.id)),
    [widgetsVisibles]
  )

  const widgetsColumnaDer = React.useMemo(
    () => widgetsVisibles.filter((w) => !['ventasMes', 'ventasDiarias', 'ventasCategoria', 'topProductos'].includes(w.id)),
    [widgetsVisibles]
  )

  return {
    widgets,
    widgetsVisibles,
    widgetsColumnaIzq,
    widgetsColumnaDer,
    editando,
    cargando,
    setEditando,
    toggleWidget,
    reordenar,
    guardar,
  }
}
