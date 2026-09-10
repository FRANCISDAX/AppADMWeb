import { doc, getDoc, setDoc } from 'firebase/firestore'
import * as React from 'react'
import { CONFIG_POR_DEFECTO } from '@/constants/tributario'
import { db } from '@/lib/firebase'

const REF = doc(db, 'tblConfiguracion', 'empresa')

export function useConfiguracion() {
  const [config, setConfig] = React.useState(CONFIG_POR_DEFECTO)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    let unsub = true
    getDoc(REF)
      .then((snap) => {
        if (!unsub) return
        if (snap.exists()) setConfig({ ...CONFIG_POR_DEFECTO, ...snap.data() })
      })
      .catch((e) => console.error('❌ Error cargando config:', e))
      .finally(() => unsub && setLoading(false))
    return () => {
      unsub = false
    }
  }, [])

  async function guardar() {
    setSaving(true)
    try {
      await setDoc(
        REF,
        {
          ...config,
          topeBoletaDni: Number(config.topeBoletaDni) > 0 ? Number(config.topeBoletaDni) : 700,
          regionExonerada: Boolean(config.regionExonerada),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
      return { success: true }
    } catch (e) {
      console.error('❌ Error guardando config:', e)
      return { success: false, error: (e as Error).message }
    } finally {
      setSaving(false)
    }
  }

  return { config, setConfig, loading, saving, guardar }
}
