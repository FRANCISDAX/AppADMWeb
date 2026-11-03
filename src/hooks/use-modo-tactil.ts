import * as React from 'react'
import {
  CLAVE_MODO_TACTIL,
  CLASE_MODO_TACTIL,
  CUALQUIER_PUNTERO_QUERY,
  PUNTERO_PRINCIPAL_QUERY,
  debeAvisarModoTactil,
  hayPantallaTactil,
  leerPreferencia,
  modoTactilActivo,
  preferenciaAlTocar,
} from '@/lib/modo-tactil'

/**
 * 🔑 **Una sola implementación del modo táctil**: la regla está en `lib/modo-tactil.ts` (pura y
 * testeada) y acá viven los tres efectos que sí tocan el navegador —leer `localStorage`, preguntarle al
 * sistema si hay pantalla táctil y poner la clase en `<html>`—. La usan `main.tsx` (antes del primer
 * pintado, para que el login ya salga grande) y el botón del `Shell` (`App.tsx`).
 */

/** Clave del aviso de la primera vez: se guarda aparte de la preferencia (una cosa es el modo, otra el aviso). */
const CLAVE_AVISO = 'appadm-modo-tactil-avisado'

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch (e) {
    // Modo privado o almacén bloqueado: sin preferencia guardada, decide la pantalla.
    console.warn('No se pudo leer una preferencia del modo táctil', e)
    return null
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor)
  } catch (e) {
    // QuotaExceededError / almacén bloqueado: el modo funciona igual, solo no se acuerda al recargar.
    console.warn('No se pudo guardar una preferencia del modo táctil', e)
  }
}

/** ¿El sistema dice que hay pantalla táctil? Las dos consultas, porque una sola deja afuera la caja con mouse. */
function pantallaTactil(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return hayPantallaTactil(
    window.matchMedia(PUNTERO_PRINCIPAL_QUERY).matches,
    window.matchMedia(CUALQUIER_PUNTERO_QUERY).matches
  )
}

/** ¿Toca aplicar el modo grande en este equipo? Solo lee: no toca el documento. */
function valorInicialModoTactil(): boolean {
  return modoTactilActivo(leerPreferencia(leer(CLAVE_MODO_TACTIL)), pantallaTactil())
}

/** Pone o saca la clase que gobierna `index.css`. */
function aplicarModoTactil(activo: boolean): void {
  document.documentElement.classList.toggle(CLASE_MODO_TACTIL, activo)
}

/**
 * Se llama desde `main.tsx` **antes** de montar React: así el login ya sale con el tamaño correcto (sin un
 * salto al entrar). Devuelve si quedó activo.
 */
export function leerYAplicarModoTactil(): boolean {
  const activo = valorInicialModoTactil()
  aplicarModoTactil(activo)
  return activo
}

export function useModoTactil() {
  const [modoTactil, setModoTactil] = React.useState(valorInicialModoTactil)
  const [preferencia, setPreferencia] = React.useState(() => leerPreferencia(leer(CLAVE_MODO_TACTIL)))
  const [avisoVisto, setAvisoVisto] = React.useState(() => leer(CLAVE_AVISO) === 'si')

  React.useEffect(() => {
    aplicarModoTactil(modoTactil)
  }, [modoTactil])

  /**
   * 🔑 **El aviso se deriva, no se dispara desde un efecto**: dice si corresponde explicar por qué el modo
   * está encendido (se encendió solo y nadie lo avisó todavía). Se apaga al tocarlo o al desactivar el modo.
   */
  const avisoModoTactil = debeAvisarModoTactil(preferencia, modoTactil, avisoVisto)

  const descartarAviso = React.useCallback(() => {
    guardar(CLAVE_AVISO, 'si')
    setAvisoVisto(true)
  }, [])

  const toggleModoTactil = React.useCallback(() => {
    // Se guarda **lo contrario de lo que se está viendo**: el primer toque hace la preferencia explícita y
    // desde ahí la detección de pantalla no vuelve a opinar.
    const siguiente = preferenciaAlTocar(modoTactil)
    guardar(CLAVE_MODO_TACTIL, siguiente)
    setPreferencia(siguiente)
    setModoTactil((prev) => !prev)
    // Si la persona ya lo tocó, el aviso sobra: sabía de qué se trataba.
    guardar(CLAVE_AVISO, 'si')
    setAvisoVisto(true)
  }, [modoTactil])

  return { modoTactil, toggleModoTactil, avisoModoTactil, descartarAviso }
}
