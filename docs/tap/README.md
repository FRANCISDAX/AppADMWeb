# Paquete documental del TAP (`docs/tap/`)

Anexos técnicos de apoyo al **Trabajo de Aplicación Profesional (TAP)** del sistema de punto de venta,
inventario y facturación electrónica. Se generan a partir del código fuente del repositorio: **cada
afirmación técnica remite a un archivo real del proyecto**.

## Contenido

| Anexo | Archivo | Fuente de la que se deriva |
|---|---|---|
| 1 | `01-arquitectura.html` | Estructura de `src/` y del servicio `appadm-sunat` (capas, routers, flujo de emisión) |
| 2 | `02-modelo-datos.html` | `src/constants/colecciones.ts`, `src/services/*.ts`, `firestore.indexes.json` |
| 3 | `03-requerimientos.html` | `src/pages/`, `src/constants/permisos.ts`, `src/services/` |
| 4 | `04-pruebas.html` | `package.json`, `src/lib/*.test.ts`, `HISTORIAL-SESIONES.md`, `AGENTS.md` |
| 5 | `05-informe-TAP.html` | **Informe del proyecto en el índice exigido por la institución** (diagnóstico, descripción y desarrollo) |
| 6 | `06-sustentacion.html` + `guion-sustentacion.md` | Presentación y guion de la defensa |
| 8 | `08-cronograma-y-costos.html` | Cronograma y Gantt con las fechas reales del historial del repositorio; costos y financiamiento (montos por completar) |
| — | `05-informe.html` | Informe técnico ampliado: material de apoyo, con otro índice |
| — | `index.html` | Índice del paquete |

## Regenerar los PDF

Chrome en modo sin interfaz, sin abrir el navegador (mismo procedimiento que el manual de usuario).
Lo más simple es correr el script, que ya tiene la lista de documentos y usa rutas absolutas:

```powershell
powershell -ExecutionPolicy Bypass -File docs\tap\generar-pdfs.ps1
```

Y para comprobar el paquete (formato de página, PDFs al día, coherencia de cifras, índice institucional
completo y ausencia de credenciales):

```powershell
powershell -ExecutionPolicy Bypass -File docs\tap\verificar.ps1
```

⚠️ `docs/` **no** está en `public/` y la aplicación no lo enlaza: actualizar estos documentos **no requiere
desplegar** el sitio.

## Versión APA (formato que exige la institución)

El formato APA general que pide la institución es: **papel A4**, **márgenes de 2.54 cm** en los cuatro
lados, **Times New Roman 12** (o Arial 11), **interlineado doble**, **alineación a la izquierda** y
**numeración de páginas en la esquina superior derecha**.

| Archivo | Qué es | Estado |
|---|---|---|
| `tap-apa.css` | Hoja de estilo con el formato APA (se carga después de `tap.css` y lo sobrescribe) | ✅ listo |
| `05-informe-TAP-APA.html` | El informe con esa hoja enlazada | ✅ listo |
| `05-informe-TAP-APA.pdf` | Versión APA generada con Chrome: A4, márgenes de 2.54 cm, TNR 12, interlineado doble, alineación izquierda. Las **tablas** van a un espacio y en 11 pt porque a doble espacio resultan ilegibles (el propio formato APA lo admite en tablas y figuras) | ⚠️ **sin numeración de páginas** |
| `05-informe-TAP-APA.docx` | Versión editable con los números de página insertados como campo en el encabezado | ⏳ **pendiente: `generar-apa-word.ps1` no llegó a terminar** |

⚠️ **Por qué el PDF no lleva números de página**: la numeración en la esquina superior derecha **no se puede
hacer con CSS** (Chrome no soporta los márgenes de página de Paged Media) y `generar-pdfs.ps1` usa Chrome.
La única vía es Word, que la inserta como campo en el encabezado — y `generar-apa-word.ps1` **tarda más de
13 minutos en este equipo** y hubo que detenerlo (Word recompagina el informe entero, con ~100 tablas, a
doble espacio). Dos formas de cerrarlo, cuando se pueda:

1. Correr `powershell -ExecutionPolicy Bypass -File docs\tap\generar-apa-word.ps1` y dejarlo trabajar
   (funciona: los cuatro pasos se ejecutan; lo lento es el guardado del `.docx` y del `.pdf`).
2. **Abrir `05-informe-TAP-APA.html` con Word**, aplicar *Diseño → Márgenes → Normal*, fuente Times New
   Roman 12, interlineado doble y *Insertar → Número de página → Superior derecha*, y guardar como `.docx`.
   Es el camino más rápido y deja el documento listo para pegar en la plantilla institucional.

## Formato del informe

El informe del proyecto (`05-informe-TAP.html`) sigue el **índice exigido por la institución** (introducción,
tres capítulos —diagnóstico del problema, descripción del proyecto y desarrollo del proyecto—, conclusiones,
bibliografía y anexos). `verificar.ps1` comprueba que las 20 secciones de ese índice estén presentes, así que
si al adaptarlo se renombra una sección, el chequeo lo avisa.

## Reglas de este paquete

1. **Nada inventado**: no se incluyen métricas de operación ni afirmaciones que no se puedan verificar en el
   repositorio. Las cifras que aparecen (líneas de código, pruebas, colecciones, páginas) se miden sobre el código.
2. **Lo que depende del tesista va marcado** con `[COMPLETAR: …]`: portada institucional, formato exigido por la
   institución, marco teórico con citas en APA y redacción final del informe.
3. **Sin datos sensibles**: el paquete no reproduce credenciales, certificados, claves ni datos de clientes. La
   arquitectura menciona *dónde* viven los secretos (servicio de facturación y variables de entorno), nunca su valor.
4. **Trazabilidad**: cuando un requisito, una prueba o una incidencia se documenta, se indica el archivo —y la
   función cuando aporta— que lo respalda.
