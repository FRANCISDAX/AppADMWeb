import { doc, getDoc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { WIDGETS_POR_DEFECTO, type DashboardWidget } from '@/components/dashboard/types'

export async function cargarWidgetOrder(uid: string): Promise<DashboardWidget[]> {
  try {
    const snap = await getDoc(doc(db, 'tblUsuarios', uid))
    if (!snap.exists()) return WIDGETS_POR_DEFECTO
    const data = snap.data()
    const guardado = data.dashboardWidgets as DashboardWidget[] | undefined
    if (!guardado || !Array.isArray(guardado)) return WIDGETS_POR_DEFECTO

    const ids = new Set(WIDGETS_POR_DEFECTO.map((w) => w.id))
    const fusionado: DashboardWidget[] = []

    for (const w of guardado) {
      if (ids.has(w.id)) {
        fusionado.push({ ...WIDGETS_POR_DEFECTO.find((d) => d.id === w.id)!, visible: w.visible, orden: w.orden })
        ids.delete(w.id)
      }
    }

    let orden = fusionado.length
    for (const w of WIDGETS_POR_DEFECTO) {
      if (ids.has(w.id)) {
        fusionado.push({ ...w, orden: orden++ })
      }
    }

    return fusionado.sort((a, b) => a.orden - b.orden)
  } catch {
    return WIDGETS_POR_DEFECTO
  }
}

export async function guardarWidgetOrder(uid: string, widgets: DashboardWidget[]): Promise<void> {
  const serializado = widgets.map((w, i) => ({
    id: w.id,
    visible: w.visible,
    orden: i,
  }))
  await setDoc(doc(db, 'tblUsuarios', uid), {
    dashboardWidgets: serializado,
  }, { merge: true })
}
