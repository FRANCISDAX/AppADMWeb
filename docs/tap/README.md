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
| 5 | `05-informe.html` | Todo lo anterior + el historial de sesiones (esqueleto del informe por capítulos) |
| 6 | `06-sustentacion.html` + `guion-sustentacion.md` | Presentación y guion de la defensa |
| — | `index.html` | Índice del paquete |

## Regenerar los PDF

Chrome en modo sin interfaz, sin abrir el navegador (mismo procedimiento que el manual de usuario):

```powershell
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
foreach ($f in @('index','01-arquitectura','02-modelo-datos','03-requerimientos','04-pruebas','05-informe','06-sustentacion')) {
  & $chrome --headless=new --disable-gpu --no-pdf-header-footer `
    --print-to-pdf="docs\tap\$f.pdf" "file:///C:/Users/aaval/OneDrive/Escritorio/appadm-web/docs/tap/$f.html"
}
```

⚠️ `docs/` **no** está en `public/` y la aplicación no lo enlaza: actualizar estos documentos **no requiere
desplegar** el sitio.

## Reglas de este paquete

1. **Nada inventado**: no se incluyen métricas de operación ni afirmaciones que no se puedan verificar en el
   repositorio. Las cifras que aparecen (líneas de código, pruebas, colecciones, páginas) se miden sobre el código.
2. **Lo que depende del tesista va marcado** con `[COMPLETAR: …]`: portada institucional, formato exigido por la
   institución, marco teórico con citas en APA y redacción final del informe.
3. **Sin datos sensibles**: el paquete no reproduce credenciales, certificados, claves ni datos de clientes. La
   arquitectura menciona *dónde* viven los secretos (servicio de facturación y variables de entorno), nunca su valor.
4. **Trazabilidad**: cuando un requisito, una prueba o una incidencia se documenta, se indica el archivo —y la
   función cuando aporta— que lo respalda.
