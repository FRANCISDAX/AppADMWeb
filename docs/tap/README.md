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

## Versión en Word (`.docx`)

El informe del TAP se entrega en la **plantilla de la institución**, así que además del PDF hay una versión
editable en Word (`05-informe-TAP.docx`), que se regenera con:

```powershell
powershell -ExecutionPolicy Bypass -File docs\tap\generar-docx.ps1
```

Sirve para pegar el contenido en la plantilla, dejar que Word genere el **índice con números de página**
automático y reemplazar las marcas `[COMPLETAR: …]`. Dos advertencias: Word **repagina** con su propio motor
(62 páginas en Chrome → 54 en Word para el mismo informe) y **los diagramas hechos con CSS** (el Gantt del
Anexo 8, los diagramas de capas del Anexo 1) pueden desarmarse: esos conviene insertarlos como imagen desde el PDF.

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
