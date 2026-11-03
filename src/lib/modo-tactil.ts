/**
 * 🔑 **Modo táctil: una sola regla para decidir si la letra y las áreas de toque se agrandan.**
 *
 * 📌 **Por qué existe** (pantalla táctil, 03/11/2026): el app está dibujado para un mouse — 945 usos de
 * `text-[10px]`/`text-[11px]`/`text-xs` contra 111 de `text-base` o más, y ~190 botones de 32-40 px
 * (`size="sm"`, `h-8`, `h-7`). En un monitor táctil de 15" a un brazo de distancia eso se lee mal y se
 * toca peor. El modo táctil agranda **solo esas dos cosas**, sin tocar la maqueta de escritorio.
 *
 * ⚠️ **La preferencia es del EQUIPO, no del negocio**: vive en `localStorage` (igual que el tema, en
 * `use-theme.ts`), porque el mismo local puede tener una PC normal y una pantalla táctil. **No** va a la
 * configuración de la empresa en Firestore: eso obligaría a todas las cajas a lo mismo.
 *
 * ⚠️ **La vidriera pública (`/pedido`) queda afuera**: es la cara del negocio para el cliente y tiene su
 * propia maqueta apretada; el modo es para las pantallas del local, no para el link que abre el cliente.
 *
 * 🔑 **Arranca solo en un equipo táctil**: nadie tiene que descubrir el botón para que funcione; y en un
 * equipo con mouse **no cambia nada** (ahí el modo grande sería una regresión visual).
 */

/** Clave de `localStorage`. Misma forma que `appadm-theme`: el equipo se acuerda de su preferencia. */
export const CLAVE_MODO_TACTIL = 'appadm-modo-tactil'

/** Clase que se pone en `<html>` (`<html class="modo-tactil">`) y a la que responde `index.css`. */
export const CLASE_MODO_TACTIL = 'modo-tactil'

/**
 * 🔑 **Las dos consultas con las que el navegador dice si hay pantalla táctil** (no se adivina «tocando»:
 * lo informa el sistema operativo y es la única señal que tenemos).
 *
 * - `PUNTERO_PRINCIPAL` (`pointer: coarse`) = el puntero **principal** es un dedo. Se cumple en un celular,
 *   en una tablet y en un POS sin mouse.
 * - `CUALQUIER_PUNTERO` (`any-pointer: coarse`) = el equipo **tiene** alguna entrada táctil, aunque el
 *   puntero principal sea el mouse.
 *
 * 📌 **Por qué hacen falta las dos** (el agujero que tenía el primer intento): un **monitor táctil de PC con
 * mouse conectado** —el caso normal de una caja con pantalla táctil— reporta `pointer: fine`, así que con
 * solo la primera el modo **no se activaba nunca** justo en el equipo que lo necesita. `any-pointer` es la
 * que contesta «este aparato tiene pantalla táctil».
 *
 * ⚠️ **Sobre-dispara a propósito en un caso**: una notebook con pantalla táctil que se usa siempre con
 * mouse/trackpad también enciende el modo. El costo es una letra más grande que se apaga con un toque (y
 * queda recordado en el equipo); el costo inverso —no activarlo en la caja táctil— es no poder tocar nada.
 */
export const PUNTERO_PRINCIPAL_QUERY = '(pointer: coarse)'
export const CUALQUIER_PUNTERO_QUERY = '(any-pointer: coarse)'

/** ¿Este equipo tiene pantalla táctil? Una u otra alcanza. */
export function hayPantallaTactil(punteroPrincipalGrueso: boolean, algunPunteroGrueso: boolean): boolean {
  return punteroPrincipalGrueso || algunPunteroGrueso
}

/**
 * Lo guardado en el equipo: `'si'` / `'no'` es lo que eligió una persona; `'auto'` es «todavía nadie
 * eligió» ⇒ decide la pantalla (`hayPantallaTactil`). Un valor desconocido (o basura en el almacén) vuelve
 * a `'auto'`: la app nunca se queda sin saber qué hacer.
 */
export type PreferenciaModoTactil = 'auto' | 'si' | 'no'

/** Lo que hay guardado (o lo que devolvió `localStorage`) → una preferencia válida. */
export function leerPreferencia(valor: string | null | undefined): PreferenciaModoTactil {
  if (valor === 'si' || valor === 'no') return valor
  return 'auto'
}

/**
 * La decisión: la persona manda sobre la detección. `'si'` enciende aunque haya mouse y `'no'` apaga
 * aunque sea una pantalla táctil — si alguien lo apagó a mano en la caja 2, no se lo vuelve a encender
 * la próxima vez que abra el app.
 */
export function modoTactilActivo(preferencia: PreferenciaModoTactil, hayTactil: boolean): boolean {
  if (preferencia === 'si') return true
  if (preferencia === 'no') return false
  return hayTactil
}

/**
 * 🔑 **¿Hay que avisarle a la persona?** Sí, y una sola vez: cuando el modo se encendió **solo** (nadie lo
 * eligió) y todavía no se le avisó. Ese aviso es la respuesta a «¿y cómo sé que esta pantalla es táctil?»:
 * el app lo dice, con la salida a mano. Si el modo se encendió porque lo pidió la persona, no se avisa nada
 * (ya lo sabe), y una vez descartado no vuelve — un cartel que reaparece en cada ingreso es ruido.
 */
export function debeAvisarModoTactil(
  preferencia: PreferenciaModoTactil,
  activo: boolean,
  yaAvisado: boolean
): boolean {
  return activo && preferencia === 'auto' && !yaAvisado
}


/**
 * Lo que se guarda al tocar el botón: **lo contrario de lo que se está viendo**. El botón no cicla por
 * tres estados (sería confuso en una pantalla táctil): a partir del primer toque la preferencia es
 * explícita y la detección deja de opinar.
 */
export function preferenciaAlTocar(activoAhora: boolean): Exclude<PreferenciaModoTactil, 'auto'> {
  return activoAhora ? 'no' : 'si'
}

/**
 * El texto del botón. 🔑 **Se dice el estado y qué hace el toque**: en una pantalla táctil no hay
 * `title` que valga (no hay hover), así que la etiqueta accesible tiene que alcanzar sola.
 */
export function textoModoTactil(activo: boolean): string {
  return activo
    ? 'Modo táctil activado: los textos y las áreas de toque están agrandados. Tocar para desactivarlo'
    : 'Modo táctil desactivado. Tocar para agrandar los textos y las áreas de toque'
}

/** Etiqueta corta y visible al lado del icono (desde `md`). */
export function etiquetaModoTactil(activo: boolean): string {
  return activo ? 'Táctil ✓' : 'Táctil'
}

/**
 * El aviso de la primera vez: **dice qué pasó, por qué y cómo se apaga**. Sin esto, un cajero encuentra la
 * letra más grande y no sabe si es una falla, en qué equipo está ni dónde se cambia.
 */
export function textoAvisoModoTactil(): string {
  return 'Este equipo tiene pantalla táctil: agrandamos los textos y las áreas de toque. Se cambia con el botón «Táctil» de arriba.'
}
