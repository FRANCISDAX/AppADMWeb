# AGENTS.md — appadm-web

## What this is

React + TypeScript SPA (point-of-sale / inventory admin) backed by Firebase (Auth + Firestore). No router — navigation is state-driven in `src/App.tsx`. UI language is Spanish.

## Resumen de sesiones

Formato compacto: `Objective`, `Important Details`, `Work State`, `Next Move`, `Relevant Files`.

### (2026-09 · 4 — Números de comprobante legibles en móvil)

**Objective**: el número de comprobante (`B001-00000123`) se aplastaba y se partía en dos líneas **solo en el celular**, en las listas de Reportes.

**Important Details**:
- **Causa**: la fila era `flex items-center` **sin** `flex-wrap` y el bloque de texto `flex-1 min-w-0`, o sea **encogible hasta cero**. En escritorio sobra ancho; a ~375 px el número competía con el total, el badge de estado y hasta 5 botones (PDF · NC · ND · Enviar · Pago) → se comprimía y se partía (el guion de `B001-00000…` es punto de corte válido para el navegador).
- **Criterio aplicado (usar en cualquier lista de comprobantes)**: la fila lleva `flex flex-wrap items-center gap-x-3 gap-y-2`; el **número** va con `num whitespace-nowrap` (cifras tabulares, **nunca** `truncate`: un número cortado es ilegible) dentro de un bloque con `min-w-[7.5rem] flex-1` (120 px, suficiente para 13 caracteres en `text-sm`); los bloques de la derecha (importe, badge, botones) van `shrink-0` y los botones con `flex-wrap justify-end`, así **bajan a una segunda línea** en vez de comerse el número. La línea secundaria (cliente · fecha · cajero) sí puede seguir `truncate`.
- **Aplicado en**: `Reportes.tsx` (fila compartida por Notas de Venta, Consolidado y Registro SUNAT — donde se reportó), `Turnos.tsx` (ventas del turno + `EnvioCard`), `ReporteTurnos.tsx`, `ReporteFechas.tsx`, `ClienteDetalle.tsx` (cobros pendientes y documentos del cliente) y `ArqueoCaja.tsx` (comprobantes del turno). En `ReporteSire.tsx` la tabla ya está en `overflow-x-auto`: solo se agregó `whitespace-nowrap` a la celda Serie/Número para que **desplace** en vez de partir el número.
- En escritorio no cambia nada: el bloque del número sigue creciendo con `flex-1`.

**Work State**: Completed y desplegado en https://appadm-b359e.web.app (commits `70bf133` y el de esta pasada). `npm run build` ✓, `npm run lint` 0 errores / 80 warnings (baseline). **Verificación visual pendiente en celular** (no se probó en navegador).

**Next Move**: confirmar en el celular que los números se leen en una línea en las 7 pantallas; si aparece otra lista con el mismo síntoma, aplicar el criterio de arriba (`num whitespace-nowrap` + `min-w-[7.5rem]` + fila `flex-wrap`).

**Relevant Files**: `src/pages/Reportes.tsx`, `src/pages/Turnos.tsx`, `src/pages/ReporteTurnos.tsx`, `src/pages/ReporteFechas.tsx`, `src/pages/ClienteDetalle.tsx`, `src/pages/ArqueoCaja.tsx`, `src/pages/ReporteSire.tsx`.

### (2026-09 · 3 — Series por cajero (incl. NC/ND) + consolidado)

**Objective**: que cada vendedor/cajero pueda tener **sus propias series** (también las de NC/ND) trabajando en **un solo establecimiento**, y que el consolidado de NV no las ignore.

**Important Details**:
- **7 series por caja** en `tblUsuarios`: `serieBoleta`, `serieFactura`, `seriePrefijo` + **nuevas** `serieBoletaNC`, `serieBoletaND`, `serieFacturaNC`, `serieFacturaND`. `CAMPOS_SERIE` (`lib/series.ts`) ya son las 7 y `Usuario = SeriesUsuario & { uid, email, … }`.
- **Serie efectiva**: `seriesEfectivas(series, empresa)` = la propia o, si está vacía, la global de empresa. **Toda la validación se calcula sobre ese conjunto**, y así detecta el caso peligroso que antes se escapaba: una caja que **deja las notas vacías** (heredan la global `BC01`) y pone `serieBoleta = 'BC01'` → **bloquea** (mismo contador `sunat_BC01`). Antes eso se evaluaba con una heurística `esNota` sobre las series globales.
- **Motivos**: bloquean `campo_duplicado` (choca con otra serie **declarada** de la misma caja), `serie_nota` (choca con una **heredada** de la global), `otro_usuario` (otra caja **activa**). Avisan (no bloquean) `serie_empresa` (declarar exactamente la global del mismo campo), `usuario_inactivo` y `formato`. Formato por campo: `^B[A-Z0-9]{3}$` para boletas **y sus NC/ND**, `^F[A-Z0-9]{3}$` para facturas **y las suyas**; el prefijo de NV no tiene formato SUNAT.
- **`seriesEmpresa`** lleva ahora `campo: CampoSerie` (a qué campo del usuario respalda cada serie global). **`services/usuarios.ts`** maneja las 7 de forma genérica (`seriesDe`, `seriesParaGuardar`) para no repetir campos.
- **Emisión de NC/ND**: `Reportes.tsx` pasa las 4 series del cajero (`user.sunat` gana `puntoEmision`… ver bloque anterior) → `config: { ...cfg, serieBoletaNC: serieBoletaNC || cfg.serieBoletaNC, … }`. `notas.ts` ya elegía la clave por tipo de comprobante modificado.
- **Consolidado de NV**: en `Reportes.tsx`, si `miUid` está vacío **no** hay `verTodo` → el cajero consolida **solo sus NV** → se usa **su** `serieBoleta`; un supervisor consolida las de todos y sigue con la **global**. `generarConsolidado` no decide nada: numera con el `config.serieBoleta` que le pasa quien llama.
- **`permisos.tsx`** expone las 7 series. **`UsuarioDetalle.tsx`** pinta 7 inputs (3 de venta + 4 de notas) generados desde `CAMPOS_SERIE_UI`, con avisos/bloqueos en vivo y Guardar deshabilitado si hay conflictos.
- **App RN `AppAdm`**: `helper/Series.js` espejo con el mismo modelo + `configConSeriesDeCaja(config, seriesCaja)`; `UserContext` guarda las 7 (objeto `series` + alias planos `serieBoleta/serieFactura/seriePrefijo` para no romper `ventas.jsx`); `RegistroVentas.jsx` emite NC/ND con las series del cajero; `UsuarioDetalle.jsx` con los 7 inputs; `services/usuarios.js` genérico sobre `CAMPOS_SERIE`. **El consolidado de la RN NO se tocó a propósito**: `obtenerNVsPendientesConsolidacion` no filtra por usuario (agrupa las NV de todos), así que ahí la serie global es lo correcto.
- Aclaración de negocio: **un solo establecimiento** (el punto de emisión sigue siendo global, `'0000'`); lo que se reparte por cajero son las **series**, que es válido y habitual (varias cajas/PDV en un mismo local). En el Registro de Ventas cada serie sale como su propia línea.

**Work State**: Completed y desplegado en https://appadm-b359e.web.app (commit `3533994`). Verificado con scripts temporales (ya eliminados): **25** casos del validador web (14 de regresión + 10 de NC/ND + series efectivas) y **14** del helper de la RN, incluido `configConSeriesDeCaja` (las propias ganan, las vacías dejan la global, no muta el original). `npm run build` ✓, `npm run lint` 0 errores / 80 warnings (baseline). **Sin probar en navegador ni en dispositivo.**

**Next Move**: (1) probar en navegador: crear una 2ª caja con series propias y verificar que boletas/notas numeran por serie; (2) que el admin asigne las series de notas por cajero en Usuarios → Editar; (3) commitear la app RN (el usuario commitea manualmente allí).

**Relevant Files**: `src/lib/series.ts`, `src/services/usuarios.ts`, `src/pages/UsuarioDetalle.tsx`, `src/pages/Reportes.tsx`, `src/context/permisos.tsx`, `src/services/consolidado.ts`. RN: `AppAdm/helper/Series.js`, `AppAdm/services/usuarios.js`, `AppAdm/context/UserContext.js`, `AppAdm/app/(drawer)/UsuarioDetalle.jsx`, `AppAdm/app/(drawer)/RegistroVentas.jsx`.

### (2026-09 · 2 — Series por caja: duplicados + correlativos de NC/ND)

**Objective**: cerrar los Next Move (a) y (c) de la sesión anterior: impedir que dos cajas guarden la **misma serie** de comprobante (comparten contador → numeración intercalada) y eliminar el riesgo de **correlativo duplicado** en notas de crédito/débito (SUNAT: "el comprobante ya existe").

**Important Details**:
- **Contadores**: `sunat_{serie}` lo comparten boletas, facturas y NC/ND; `notaVenta_{serie}` es de notas de venta. Dos series con el mismo texto **solo chocan si comparten espacio** (así, `NV01` en facturas no choca con `NV01` en notas de venta).
- **`src/lib/series.ts`** (módulo puro, nuevo): `normalizarSerie`, `espacioDe`, `seriesDeUsuario`, `seriesEmpresa`, `validarSeries` → `ConflictoSerie[]` con `bloqueante`. Motivos **bloqueantes**: `campo_duplicado` (misma serie en dos campos del propio usuario), `otro_usuario` (caja activa), `serie_nota` (serie de NC/ND). **Avisos** (no bloquean): `serie_empresa` (igual a la serie global), `usuario_inactivo`, `formato` (SUNAT exige `^B[A-Z0-9]{3}$` / `^F[A-Z0-9]{3}$`). Choques idénticos (motivo+serie) se reportan **una sola vez**.
- **`services/usuarios.ts`**: `obtenerSeriesOcupadas(uidExcluido?)`, `obtenerSeriesEmpresa()`, `validarSeriesUsuario()`. `crearUsuario` y `editarUsuario` **rechazan** con `{success:false,error}` si hay conflictos bloqueantes; al editar se lee el doc actual y se excluye el propio uid (no se auto-bloquea). Se agregó `COL.CONFIGURACION = 'tblConfiguracion'`.
- **`pages/UsuarioDetalle.tsx`**: valida con **debounce 300 ms**, muestra bloqueantes en rojo y avisos en ámbar dentro del bloque de series, deshabilita Guardar mientras haya bloqueantes y **respeta `{success:false}`** (antes llamaba a `onSaved()/onBack()` sin mirar el resultado: perdía el error de email duplicado o contraseña débil).
- **`services/notas.ts`**: `obtenerProximoCorrelativoSunat` ahora **siembra** el contador desde el máximo correlativo ya emitido (`where('serie','==',serie)`) cuando el doc de `tblContadores` no existe (restauración, o notas emitidas por la app RN con otro esquema); antes arrancaba en `000001` y SUNAT habría rechazado la nota. `prefijoSerie` se normaliza a mayúsculas para que la clave del contador coincida con la serie guardada en el documento.
- **Series globales** (`Configuracion.tsx` → Empresa): `validarSeriesEmpresa` compara las series de la empresa (boletas, facturas, NV y las 4 de NC/ND) contra las de cada caja — una caja que declare la serie global comparte contador con las cajas sin serie propia. Bloquea el botón Guardar si hay choques reales; formato SUNAT y cajas inactivas quedan como aviso. Se agregó el campo **Punto de emisión (anexo)**.
- **Punto de emisión**: `config.puntoEmision` (4 dígitos, `'0000'` = casa matriz) es el **código de establecimiento anexo** (catálogo 22). `puntoEmisionDe(doc, config)` en `lib/sunat.ts` lo agrega como `punto_emision` al payload y se guarda en `documento.sunat.puntoEmision`. ⚠️ `services/sunat.ts` **reescribe el objeto `sunat` completo** (`updateDoc({ sunat: {...} })`): el punto de emisión va dentro de `sunatBase` para no perderse en el primer envío.
  - **Decisión del usuario: global de empresa por ahora** (una sola sede). NO hacerlo por caja (sería espejo de las series: `tblUsuarios.puntoEmision` + campo en `UsuarioDetalle` + override en `Pdv.tsx` + RN; el backend no necesitaría cambios porque ya aplica el código que llega en cada request). Solo tiene sentido si se registran anexos en el RUC: SUNAT **valida el anexo contra los establecimientos registrados** y rechaza uno inexistente. Con `'0000'` el XML es idéntico al de antes, así que el campo es inerte hasta que se configure un anexo real.
  - La cañería ya es **por comprobante** (el payload toma `documento.sunat.puntoEmision` y `puntoEmisionDe` da prioridad al doc sobre la config); lo único único es la **fuente del valor**. `direccion_emisor`/`config.direccion` también es única de empresa (si algún día hay varios establecimientos, lo coherente es dirección por anexo).
- **Backend `appadm-sunat`** (repo aparte, **sin git**, corre en 192.168.1.7:8000): `InvoiceCreate`/`NotaCreate` aceptan `punto_emision` (opcional, `^\d{4}$`) y `app/xml_utils.py:aplicar_punto_emision` reemplaza el `cbc:AddressTypeCode` **hardcodeado en 0000** por el valor configurado, dentro de `AccountingSupplierParty` y **antes de firmar** (así entra al XML y al hash SUNAT). El SDK `sunat_py` es de PyPI (site-packages): no se toca, se parchea el XML por `replace`, igual que ya hacía el backend con `IssueTime`/`correlativos`. Retrocompatible: sin el campo o con `'0000'` el XML sale idéntico.
- **App RN `AppAdm`**: portado `helper/Series.js` (espejo de `lib/series.ts`, módulo puro sin Firebase), validación en `services/usuarios.js` (`validarSeriesUsuario`, se valida **antes** de crear el usuario en Auth) y `punto_emision` en `services/sunat.js` (`sunatBase` + body de comprobante y nota). El RN lee `config.puntoEmision` del mismo `tblConfiguracion/empresa`, así que el admin lo configura una sola vez desde el web. Su tab de empresa no expone series: siguen viniendo del web.
- ⚠️ **No clampear** ni bloquear de más: con una sola caja, `serieBoleta = B001` (= serie global) solo genera **aviso**; solo bloquea un choque real entre cajas.
- Verificado con 13 casos (script temporal, ya eliminado): bloqueo por caja activa, insensibilidad a mayúsculas/espacios, caja inactiva = aviso, espacios de contador separados, serie de NC en boletas, formato inválido, dedupe de mensajes y cero conflictos en configuración normal.

**Work State**: Completed y **desplegado** en https://appadm-b359e.web.app (`npm run build` ✓, `npm run lint` 0 errores / 80 warnings baseline, `firebase deploy --only hosting` ✓). Commits: `b294908` (checkpoint del trabajo acumulado sin versionar) y `49ba5d5` (series globales + punto de emisión). Verificado con scripts temporales ya eliminados: 13 casos de series por caja, 11 de series globales, 17 del backend (XML real de `sunat_py`) y 12 del helper de la RN. **No probado en navegador** (a pedido).

**Next Move**: (1) **opcional** mientras el anexo siga global: desplegar/reiniciar el backend `appadm-sunat` en 192.168.1.7:8000 (solo hace falta si algún día se configura un anexo ≠ `0000`; con `0000` el XML sale idéntico y el campo se ignora); (2) probar en navegador el bloqueo de series duplicadas; (3) correlativos perdidos por serie (detectar huecos, Next Move (c) pendiente); (4) commitear los cambios de la app RN (el usuario commitea manualmente allí).

**Relevant Files**: `src/lib/series.ts` (nuevo), `src/lib/sunat.ts`, `src/services/usuarios.ts`, `src/services/sunat.ts`, `src/services/notas.ts`, `src/services/ventas.ts`, `src/pages/UsuarioDetalle.tsx`, `src/pages/Configuracion.tsx`, `src/constants/tributario.ts`, `src/constants/colecciones.ts`. Otros repos: `appadm-sunat/app/schemas/invoice.py`, `appadm-sunat/app/xml_utils.py`, `appadm-sunat/app/services/{invoice_service,note_service}.py`, `AppAdm/helper/Series.js` (nuevo), `AppAdm/services/{usuarios,sunat}.js`.

### (2026-09 — POS: pago mixto, precio especial, series por caja, NC/ND, reglas de turno)

**Objective**: cerrar brechas funcionales del PDV y reportes: pago mixto con vuelto, precio de venta especial (promo), series de comprobante por caja, emisión y **envío de notas de crédito/débito a SUNAT**, y reglas de turno (no emitir con turno cerrado; turno **propio** salvo `verTodo`).

**Important Details**:
- **Pago mixto**: `venta.pagos[] = [{tipo, monto}]`; `tipoPago='mixto'` si hay >1. En mixto **solo se ingresa la transferencia**; el **efectivo se autocalcula** (`total − transferencia`) y queda **bloqueado**. Si `transferencia ≥ total` → efectivo = 0 y vuelto = `transferencia − total` (se devuelve en efectivo). `cambio = max(0, efectivoRecibido + transferencia − total)`. Se guarda `vueltoTransferencia` en el turno y el **arqueo lo resta**: `efectivoEsperado = montoInicial + totalEfectivo − gastosEfectivo − vueltoTransferencia`. ⚠️ **No clampear `totalEfectivo` a 0** (el float `montoInicial` absorbe el reembolso; si se clampea, aparece **faltante**).
- **Precio especial**: `Producto.precioEspecial` (>0 = promo activa). El PDV muestra promo (rojo + original tachado + badge PROMO) y permite **elegir por línea** promo/normal; el item se registra con `usarPrecioEspecial` y `precioDe(prod, item)` en `services/ventas.ts`.
- **Series por caja**: `tblUsuarios` gana `serieBoleta/serieFactura/seriePrefijo` (por usuario, editables en `UsuarioDetalle`; el **admin** las configura). Si están vacías → serie **global** de empresa. El PDV sobreescribe `config.serie*`. El contador es **transaccional por serie** (`sunat_{serie}` / `notaVenta_{serie}`) y se auto-inicializa con el máximo correlativo ya emitido.
- **NC/ND**: `crearNotaCreditoDebito` valida **monto ≤ comprobante original** (solo NC), **exige turno abierto**, y registra la nota en el turno (`ventasDelTurno` con `tipo: 'nota_credito'/'nota_debito'`; `total` negativo en NC) reduciendo `totalEfectivo`/`totalTransferencia` según el pago del original. Envío a SUNAT con `enviarNotaASunat` → **`/v1/notes/emitir`** (`construirPayloadNota` en `lib/sunat.ts`). El ticket imprime **"Documento relacionado"**, **"Motivo de emisión"** y el **Vuelto**. Guarda `usuarioId` y `venta.cajero`.
- **Reglas de turno**: los comprobantes **y el cobro de crédito** exigen turno abierto. `buscarTurnoAbierto(uid, tienePermiso('verTodo'))` → devuelve **solo el turno propio**, salvo `verTodo` (supervisor) que puede usar cualquier turno abierto. El cobro de crédito también **suma al turno** (`ventasDelTurno` con `tipo: 'cobro_credito'`). Al **cerrar turno**: confirmación + **aviso disuasivo** si hay NC/ND pendientes de enviar a SUNAT (no bloquea).
- **Reportes**: la **NC resta** del total de ventas (`signoDoc` en `services/reportes.ts`; aplicado en `ReporteFechas` y `Dashboard`). Los **cobros de crédito y las notas NO cuentan como ventas** (`esVentaReal` en `services/reportes.ts`).
- **Despliegue**: `npm run build` → `firebase deploy --only hosting`. ⚠️ **Nunca** `firebase deploy --force` (intenta borrar índices que no están en `firestore.indexes.json`); para índices usar `firebase deploy --only firestore:indexes`.

**Work State**: Completed (desplegado en https://appadm-b359e.web.app).

**Next Move**: a definir — (a) validar **series duplicadas** entre usuarios al guardar; (b) campo **`puntoEmision`** explícito en comprobante/hash SUNAT; (c) detectar correlativos perdidos por serie; (d) portar estas features a la app RN (que está atrasada).

**Relevant Files**: `src/pages/Pdv.tsx`, `src/services/ventas.ts`, `src/services/notas.ts`, `src/services/sunat.ts`, `src/lib/sunat.ts`, `src/lib/pdf.ts`, `src/pages/Reportes.tsx`, `src/context/permisos.tsx`, `src/pages/UsuarioDetalle.tsx`, `src/services/turnos.ts`, `src/services/reportes.ts`, `src/pages/ReporteFechas.tsx`, `src/pages/Dashboard.tsx`, `src/pages/ClienteDetalle.tsx`, `src/pages/Turnos.tsx`.

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc -b && vite build` (TypeScript check + bundle to `dist/`)
- `npm run lint` — Oxlint (NOT ESLint). Config: `.oxlintrc.json`
- `npm run preview` — serve production build locally
- `npx firebase deploy --only hosting` — deploy to Firebase Hosting

No test framework is configured. No CI workflows exist.

## Path alias

`@` → `src/` (configured in `tsconfig.app.json`, `vite.config.ts` resolve alias). Always use `@/...` imports.

## Env vars

Copy `.env.example` → `.env.local`. Required: `VITE_FIREBASE_*` keys. Optional: `VITE_APIS_PERU_TOKEN`, `VITE_SUNAT_API_BASE` for SUNAT DNI/RUC lookup.

## Key architecture

- **Entry**: `src/main.tsx` → `AuthProvider` → `PermisosProvider` → `NotificationsProvider` → `App` (Shell)
- **Navigation**: `src/App.tsx` holds `seccion` state — no react-router. Pages are in `src/pages/`.
- **Firebase init**: `src/lib/firebase.ts` — uses `browserLocalPersistence` (auth persists across tabs). Firestore offline persistence: `persistentLocalCache` + `persistentMultipleTabManager`.
- **Permissions**: Role-based (ADMIN / GERENTE / CAJERO / PERSONALIZADO). Defaults in `src/constants/permisos.ts`. Live-synced from Firestore `tblUsuarios/{uid}.permisos`.
- **Single-session enforcement**: `src/context/auth.tsx` writes `activeSession.deviceId` to Firestore; different device triggers logout for non-admin users.
- **Firestore collections**: All prefixed `tbl` — see `src/constants/colecciones.ts` for exact names.
- **Services layer**: `src/services/*.ts` — one file per domain (ventas, inventario, clientes, etc.). All talk to Firestore directly.
- **UI components**: shadcn/ui (`src/components/ui/`). Use `cn()` from `@/lib/utils` for class merging.
- **Dark mode**: Class-based (`darkMode: ['class']`). Toggle via `useTheme` hook. Theme stored in `localStorage('appadm-theme')`.
- **Offline indicator**: Banner in `App.tsx` header + content area when offline.
- **App Check**: REMOVED — was causing CSP violations.

## Dev proxy

`/api-sunat` → `https://api.apis.net.pe` (rewrites path). Used for DNI/RUC lookups without CORS issues. See `vite.config.ts:18`.

## Build notes

- Firebase SDK is chunked separately (`manualChunks` in `vite.config.ts`). `firebase: ^12.18.0`.
- `chunkSizeWarningLimit` is 600 KB.
- `tsconfig.json` uses project references: `tsconfig.app.json` (src) and `tsconfig.node.json` (vite config only).
- Strict TS: `noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly` are enabled.

## Conventions

- Components use default exports for pages, named exports for shared components.
- All user-facing strings are in Spanish.
- Custom Tailwind utilities: `brand-grad`, `glass`, `bg-app`, `num` (tabular nums), `scrollbar-none`. Defined in `src/index.css`.
- Custom font: DM Sans (loaded via Google Fonts in `index.html`).
- Brand color: orange (`--primary: 16 100% 60%`).

## Quality Requirements (MANDATORY)

All code changes and new features MUST follow these practices. No exceptions.

### Firestore
- Use `writeBatch` or `runTransaction` when updating multiple documents (never sequential `await` loops for related writes).
- Never use non-null assertions (`!`) on Firestore reads — always guard with `if (!x) return`.
- Never pass `undefined` as Firestore field value — use conditional spread: `...(val ? { field: val } : {})`.

### TypeScript
- No `any` types. Use proper types or `unknown` + narrowing.
- No non-null assertions (`!`) on optional fields — use `?? 0`, `?? ''`, or guard.
- Export types from services/hooks for reuse.

### React
- Extract reusable logic into custom hooks (`src/hooks/`) or utility modules (`src/lib/`).
- Deduplicate shared code (`fmt`, `estadoStock`, toast logic, etc.) into `src/lib/ui-utils.ts` or domain-specific utils.
- Components > 300 lines should be split into sub-components.
- Use `React.memo` for expensive list items if re-renders are frequent.

### Styling
- No hardcoded `bg-white` — use `bg-background` or `bg-card` for dark mode compatibility.
- Use `cn()` from `@/lib/utils` for conditional classes.
- Menu items with long labels: use `items-start` (not `items-center`) so icons align top when text wraps.
- Horizontal scroll containers: use `scrollbar-none` utility class.

### Error handling
- All async operations must have try/catch with user-facing error messages.
- `localStorage` writes must catch `QuotaExceededError`.
- Prefer `console.warn`/`console.error` over silent `catch {}`.

### Architecture
- Services (`src/services/`) handle Firestore logic — keep it out of components.
- Pages (`src/pages/`) handle UI only.
- Shared utilities go in `src/lib/`.
- Constants go in `src/constants/`.

## Feature Reference

### Discount System (`src/lib/descuentos.ts`)
Central engine that calculates all discount types in order:
1. **Product discount** — `descuentoPorcentaje` field on `Producto` type (0-100%)
2. **Volume promotions** — rules in `tblPromocionesVolumen` (3×2, 2da al 50%, "Llevá 4 pagá 3", % por volumen, monto fijo)
3. **Coupon** — codes in `tblCupones` (percentage or fixed amount, validity dates, usage limits)
4. **Client discount** — `descuentoPorcentaje` field on `Cliente` type (frequent customer discount)
5. **Global discount** — manual input in PDV (percentage or fixed amount)

Calculation order: product → volume → coupon → client → global. Each layer applies on the subtotal from the previous layer.

### Volume Promotions (`src/services/promociones-volumen.ts`)
- Types: `3x2`, `2da_50`, `lleva_paga`, `por_volumen`, `monto_fijo`
- `monto_fijo`: `valor` = units required, `descuento` = fixed total price
- CRUD: `src/services/promociones-volumen.ts` — guardar, eliminar, listar
- Config UI: `src/pages/Configuracion.tsx` → Promociones tab
- Firestore: `tblPromocionesVolumen`

### Price Lists
- Config: `listasPrecios[]` in company config (`tblConfiguracion/empresa`)
- Per-product: `Producto.precios` map `{ listaId: number }`
- Client assignment: `Cliente.listaPrecio`
- PDV override: buttons for each price list when client is selected
- Admin CRUD: Configuración → Listas de Precio tab

### Margin Protection
- Per-product: `Producto.precioMinimo` (cost floor)
- Auto-exception: products ≤7 days to expiry bypass minimum price
- PDV alerts: "BAJO COSTO" (below min), "VENCIDO" (expired), days-to-expiry badge

### Supplier System
- **Collection**: `tblProveedores` (renamed from `Proveedor`)
- **Type**: `Proveedor` in `src/services/proveedores.ts` — contactos, notas, activo, credito, saldo
- **CRUD**: `src/services/proveedores.ts` — guardar, obtener, eliminar, buscar, cargar
- **Payments**: `src/services/pagos-proveedores.ts` — registro de pagos, historial
- **Pages**: `src/pages/Proveedores.tsx` (5 tabs: Lista, Dashboard, Compras, Precios, Ranking), `src/pages/ProveedorDetalle.tsx`
- **Reports**: `src/components/reportes/` — ComprasPorProveedor, EvolucionPrecios, DashboardProveedores, RankingConfiabilidad
- **Product link**: `Producto.proveedorId` / `Producto.proveedorNombre`
- **Delete protection**: Cannot delete supplier with registered purchases
- **Matching**: Case-insensitive + accent-normalized

### Customer Display
- **Service**: `src/lib/customer-display.ts` — Firestore-based cross-device sync via `tblDisplaySessions`
- **Page**: `src/pages/PantallaCliente.tsx` — standalone page, no auth, `?session=XXX` URL param
- **QR**: `qrcode` library for QR generation in PDV
- **App.tsx**: intercepts `?session=XXX` before auth/loading checks
- **Note**: QR URL must NOT be uppercased — `URLSearchParams.get('session')` is case-sensitive

### Smart Arqueo
- **Diagnostics**: `src/lib/diagnosticos.ts` — 9 diagnostic rules for cash register
- **UI**: `DiagnosticoPanel` in `src/pages/ArqueoCaja.tsx`
- **Comprobantes display**: Shows payment type + operation number for cobros (`📱 Yape · Op: 12345`)

### Cobro Operación
- When collecting credit payments via Yape/Transferencia/Plin, "N° de operación" field appears
- Stored in `pago.operacion` and `turno.ventasDelTurno[].operacion`
- Shows in Arqueo as `tipoLabel · Op: N` (or `SN` if missing)
- Labels: 💵 Efectivo, 📲 Transferencia, 📱 Yape, 📱 Plin

### Client Balance
- `calcularSaldoCredito` in `src/services/clientes.ts`
- `corregirCobrosExcedidos()` — caps cobrado at total for documents where cobrado > total
- "Recalcular saldo" button in `ClienteDetalle.tsx`
- Clientes page: "Todos" button with infinite scroll (25/page, cursor-based pagination)

### Shipping/Delivery
- **Config**: `envioHabilitado`, `zonasEnvio` in company config
- **PDV**: shipping fields (address, reference, zone, cost, notes)
- **Service**: `src/services/envios.ts`
- **Turnos**: delivery tracking UI

### Plantillas Manuales (shared)
- Stored in `tblConfiguracion/empresa` as `plantillasManuales[]`
- Admin creates in Configuración → Plantillas tab
- Used in PDV for "Embalaje y Otros" quick-add

### Quick Sale (PDV)
- `Producto.esFavorito` — marks products as favorites
- `Producto.vecesVendido` — sales counter
- Top 12 auto-populated in PDV quick-sale section

### Camera Barcode Scanner
- `html5-qrcode` library in `src/pages/EscanearCodigo.tsx`
- Rear camera default, camera switch support

## Service Worker (`public/sw.js`)

- Version: `jorfel-static-v6` / `jorfel-v6`
- Cache-first for CSS, images, fonts (NOT scripts)
- Scripts (JS): stale-while-revalidate (avoids Vite modulepreload conflicts)
- Network-first for Firebase/API calls
- `fonts.gstatic.com` excluded from SW caching (browser handles font preloading)
- CSP in `firebase.json`: `default-src 'self'`, `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com`, `worker-src 'self' blob:`, `connect-src` includes `https://fonts.gstatic.com`

## Firestore Collections

| Key | Collection | Description |
|-----|-----------|-------------|
| PRODUCTOS | tblProductos | Products with pricing, stock, promotions, precioMinimo, esFavorito, vecesVendido |
| MOVIMIENTOS | tblMovimientos | Stock movements (ventas, compras, ajustes) |
| DOCUMENTOS | tblDocumentos | Sales documents (boletas, facturas, NV) |
| CONTADORES | tblContadores | Correlative counters |
| TURNOS | tblTurnos | Cash register shifts (ventasDelTurno[].operacion for cobros) |
| CIERRES | tblCierresCaja | Shift closing records |
| CLIENTES | tblClientes | Customers with credit, discount %, listaPrecio, montoTotal |
| USUARIO | tblUsuarios | Users with roles and permissions |
| PROVEEDOR | tblProveedores | Suppliers with contacts, credit |
| EGRESOS | tblEgresos | Expenses and payments |
| HISTORIAL_PRECIOS | tblHistorialPrecios | Price history |
| CUPONES | tblCupones | Discount coupons |
| PROMOCIONES_VOLUMEN | tblPromocionesVolumen | Volume-based promotions (incl. monto_fijo) |
