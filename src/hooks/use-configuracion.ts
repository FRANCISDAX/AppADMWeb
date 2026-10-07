import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import * as React from 'react'
import { CONFIG_POR_DEFECTO } from '@/constants/tributario'
import { porcentajeValido } from '@/lib/igv'
import { db } from '@/lib/firebase'

const REF = doc(db, 'tblConfiguracion', 'empresa')

type Config = typeof CONFIG_POR_DEFECTO

/**
 * Configuración de la empresa (`tblConfiguracion/empresa`), **en vivo**.
 *
 * 🔑 **Por qué es un listener y no una lectura al montar**: antes era un `getDoc` único, así que
 * una pantalla ya abierta seguía con los valores viejos hasta recargar. El caso que lo destapó
 * (22/09/2026): el admin cambió la **vigencia de un aviso de Yape** de 10 a 5 minutos, mandó el
 * aviso de prueba y el PDV —abierto desde antes— seguía diciendo *«vence en 10 min»*, porque el
 * panel leía su propia copia al montar. Con `onSnapshot` el cambio llega a todas las pantallas
 * abiertas (PDV, panel de avisos, reportes) **sin recargar**, igual que el catálogo.
 *
 * ⚠️ **Pero lo que se está editando manda**: mientras el formulario de Configuración tenga cambios
 * sin guardar (`setConfig` se llamó y todavía no se guardó), el listener **no pisa** el estado; si
 * no, un cambio que llegue de otro dispositivo borraría lo que la persona está escribiendo. Al
 * guardar bien, la edición se considera terminada y la config vuelve a seguir la base.
 */
export function useConfiguracion() {
  const [config, setEstado] = React.useState<Config>(CONFIG_POR_DEFECTO)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  /** ¿Hay cambios locales sin guardar? Mientras sea `true`, la base no pisa lo que se edita. */
  const editando = React.useRef(false)

  React.useEffect(() => {
    const soltar = onSnapshot(
      REF,
      (snap) => {
        if (!editando.current && snap.exists()) setEstado({ ...CONFIG_POR_DEFECTO, ...snap.data() })
        setLoading(false)
      },
      (e) => {
        console.error('❌ Error cargando config:', e)
        setLoading(false)
      }
    )
    return soltar
  }, [])

  const setConfig = React.useCallback<React.Dispatch<React.SetStateAction<Config>>>((valor) => {
    editando.current = true
    setEstado(valor)
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
          igvRecuperable: Boolean(config.igvRecuperable),
          // 🔑 **La tasa del IGV de venta se guarda siempre válida**: un `0`, un vacío o un dedazo caerían
          // a las líneas gravadas sin impuesto (o a declarar cualquier cosa). Fuera de rango ⇒ 18%.
          igvPorcentaje: porcentajeValido(config.igvPorcentaje),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      )
      editando.current = false
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
