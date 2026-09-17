# AGENTS.md — appadm-web

## What this is

React + TypeScript SPA (point-of-sale / inventory admin) backed by Firebase (Auth + Firestore). No router — navigation is state-driven in `src/App.tsx`. UI language is Spanish.

**Repos relacionados** (los versiona el usuario, **no** este agente): la app móvil **`AppAdm`** (Expo/React Native) y el **backend `appadm-sunat`** (FastAPI + `sunat_py`, corre en `192.168.1.7:8000`). Un cambio puede tocar los tres: si un defecto se arregla acá y **el mismo defecto existe en la RN, se arregla también** y se avisa (no alcanza con arreglar el web).

## Estado actual

- **Punto de partida (checkpoint del 17/09)**: se unificó y commiteó el trabajo que estaba sin versionar de la **sesión paralela** — **cajas** (`services/cajas.ts`), **ventas pendientes / en espera** (`components/PanelVentasPendientes.tsx`), **rol VENDEDOR** (`constants/permisos.ts`, `services/usuarios.ts`) y reportes de proveedores — junto con los fixes de UI y del service worker. Ese trabajo **no es de esta sesión**: se revisó que no rompiera los invariantes (no borra las reglas únicas ni reintroduce fórmulas a mano) y se restauró el baseline de lint (dos `\-` innecesarios en `Pdv.tsx`).
- ⚠️ **Los índices compuestos nuevos se despliegan aparte**: `npx firebase deploy --only firestore:indexes` (`tblEgresos: proveedorId + categoria`, `tblDocumentos: cajaId + estado + fecha`). **Nunca** `--force`. Sin desplegarlos, las consultas nuevas fallan con *"The query requires an index"* (el mismo síntoma del bloque ·5 del historial).
- **Verde**: `npm test` **98/98**, `npx tsc -b` ✓, `npm run lint` 0 errores / **80 warnings (baseline: no subirlo)**, `npm run build` ✓.
- **Producción real** (medida, no supuesta): ~93 turnos, ~234 documentos, 40 productos **todos exonerados (`'20'`)** porque la región está exenta de IGV.
- **Decisiones tomadas con el usuario** (16/09) sobre los controles del cierre: **conciliación por billetera opcional** (no bloquea el cierre), **conteo ciego configurable y apagado por defecto** (`config.conteoCiego`, Configuración → Empresa) y **firmas**: los PDF imprimen nombre/RUC del negocio, quién cerró el turno y dos líneas de firma (cajero / supervisor).
- 📌 **Alcance acordado (17/09)**: de acá en adelante este agente trabaja **solo en el web**; la app móvil `AppAdm` queda para otra sesión (tiene cambios sin commitear de la última pasada: `helper/Arqueo.js` nuevo, notas con `medio`, rótulos con `etiquetaFormaPago` y el arqueo con desglose/origen — lint 0 errores, verificada en aislado).

## Invariantes y trampas (leer antes de tocar código)

Reglas que ya costaron un bug o que salieron de una decisión explícita del usuario. **No "arreglarlas" por iniciativa propia.**

### Caja y arqueo
- **El arqueo cuadra el efectivo, y nada más**: `efectivoEsperado = montoInicial + totalEfectivo − gastosEfectivo − vueltoTransferencia`. Las transferencias **no entran** (ni ahí, ni en `totalNeto = totalVentas − totalGastos`, ni en la diferencia). Cambiar `totalTransferencia` de un turno **no puede** mover el esperado, el contado ni la diferencia: en el arqueo la transferencia es **informativa**.
- 🔑 **Esa fórmula vive en UN solo lugar: `efectivoEsperadoDe()` (`lib/arqueo.ts`).** Estaba escrita a mano en **6** sitios y **dos** de ellos **sin restar `vueltoTransferencia`** (el modal de cierre que ve el cajero y `analizarCierre`): el cajero podía estar comparando contra un número distinto al que el sistema guardaba. **No volver a escribirla a mano** (la usan `turnos.ts` ×2, `reportes.ts`, `egresos.ts`, `compras.ts`, `CierreCaja.tsx` y `auditoria-caja.ts`). Verificado: **92/92 turnos cerrados** dan idéntico al `efectivoEsperado` guardado.
- ⚠️ **El consolidado "Caja del día" suma SOLO turnos cerrados.** Un turno abierto tiene esperado pero **todavía no tiene contado**, así que incluirlo inventa una diferencia: con el 16/09 (un cerrado + uno abierto) daba **−11.00** falso. Ahora `montoInicialTotal` / `efectivoEsperadoTotal` / `efectivoContadoTotal` se acumulan solo si `estado === 'cerrado'`, y el rótulo avisa cuántos quedaron abiertos.
- **`tipo` = bolsillo, `medio` = detalle.** Se guarda `{ tipo: 'efectivo' | 'transferencia', medio: 'efectivo' | 'yape' | 'plin' | 'transferencia' | 'tarjeta', monto, operacion? }`. `tipo` es lo que ya entienden el arqueo, los reportes, las anulaciones, el cobro y la RN: **poner `tipo: 'yape'` rompe ~8 lugares en silencio**.
- ⚠️ **`bolsilloDe()` devuelve `'credito'` para `'credito'`, `'mixto'` y cualquier valor desconocido** — **nunca cae a efectivo**. Un medio desconocido que cayera a efectivo **infla el cajón** y produce un faltante fantasma (fue un bug real, ver bloque ·10). Reparto de una venta: **`bolsillosDeVenta()`** (`lib/pagos.ts`) como **regla única**, usada por el alta **y** la anulación.
- **Una venta a crédito no entra a ningún bolsillo** (queda por cobrar); **un cobro de crédito sí**, en el bolsillo del medio con que se cobró.
- **Cada bolsillo tiene dos ejes**: el **total** (plata que entró al cajón/banco: contra eso se concilia) y el **origen** (`lib/arqueo.ts`: ventas del día / cobranza de crédito / notas). Ahí `ventas` es el **residuo** — las partes siempre suman el total guardado, y `consistente: false` avisa si lo derivado no lo explica.
- **Conciliación por billetera (`mediosDelTurno`, `lib/arqueo.ts`)** = lo que el sistema dice que entró por Yape/Plin/tarjeta, para cruzarlo contra la app/banco. Se declara al cerrar (**opcional**, se guarda como `conciliacion` en el turno y en `tblCierresCaja`) y se muestra en el arqueo y en el PDF del cierre. ⚠️ **El `medio` fino (yape/plin/tarjeta) existe desde el 16/09/2026**: antes todo cae en **"Transferencia (sin detalle)"** — no inventar un medio. Y una **NC** también cae ahí, porque `notas.ts` guarda el bolsillo del original, no su medio. Verificado: en **49/49** turnos con medios, la suma por medio coincide con el `totalTransferencia` guardado.
- **Conteo ciego** (`config.conteoCiego`, Configuración → Empresa, **apagado por defecto**): al cerrar, el cajero escribe el conteo **sin ver** el "Debería haber"; la diferencia aparece recién en el paso de análisis. Es el control que evita que alguien "cuadre" copiando el esperado.
- **Los documentos de caja van identificados y firmados**: `abrirPDFArqueo`/`abrirPDFCierreCaja` reciben `empresa` (`EmpresaPDF`: nombre, RUC, dirección) e imprimen **dos líneas de firma** (cajero —con quién cerró el turno— y supervisor). ⚠️ Si se agrega un PDF de caja nuevo, **pasarle la empresa y las firmas**: el dato ya está en Configuración → Empresa, solo hay que pasarlo.
- **`tblTurnos` es registro de caja: no se reescribe.** Para corregir un turno histórico se pide permiso, se toca **solo** el campo necesario (el turno **y** su doc de `tblCierresCaja`), se deja `observaciones` y se registra en `tblAuditLog`.
- ⚠️ **Las fechas de los items del turno se guardan en UTC**; las de turno/reportes son locales. Un cobro de las 21:43 del 14 figura como **15/09 02:43Z**: un turno del 14 puede tener items "del 15" sin que nada esté mal.
- El cajero opera con **su** turno, salvo `verTodo` (supervisor). No se emite comprobante **ni se cobra crédito** con el turno cerrado.

### Fiscal (SUNAT)
- **`Producto.precio` es precio FINAL al público (con IGV incluido)**: no se recarga el 18% al cobrar ni se guarda el precio sin IGV.
- **El comprobante declara lo que se COBRA**: `lib/sunat-importes.ts` reparte el descuento por línea **antes** de despejar el IGV. Al revés, el descuento se aplicaría sobre una base que ya no es la cobrada.
- **El IGV solo existe en afectación `'10'`**: `valorUnitarioSunat(precio, afectacion)` divide entre 1.18 **solo** para `'10'`; exonerado `'20'`, inafecto `'30'` y gratuitas van tal cual (dividirlas haría que el comprobante declare **menos** de lo cobrado).
- **Los items manuales del PDV** usan `config.tipoAfectacionManual` (default `'20'`) y **debe coincidir con el catálogo**: si no, el comprobante declara más (o menos) de lo cobrado.
- **El backend vive aparte** (`appadm-sunat`): un cambio ahí **no hace efecto hasta reiniciarlo**, y lo despliega el usuario. El SDK `sunat_py` es de PyPI y **no se toca**: el backend parchea el XML por `replace` antes de firmar.
- Los correlativos son **por serie** (`sunat_{serie}` en `tblContadores`, se siembra del máximo ya emitido); dos cajas con la misma serie comparten contador.

### Firestore
- **Igualdad + rango/orderBy ⇒ índice compuesto** declarado en `firestore.indexes.json` y desplegado con `npx firebase deploy --only firestore:indexes`. ⚠️ **Nunca `firebase deploy --force`** (borra índices que no estén declarados ahí).
- `orderBy` **descarta** los documentos a los que les falta el campo: si puede faltar, ordenar en JS.
- **Borrados y actualizaciones masivas, por lotes** (`writeBatch`, 500) devolviendo **lo que realmente se hizo** (nunca 0 por un fallo parcial).
- Nunca `undefined` como valor de campo (spread condicional) ni `!` en lecturas.
- Diagnóstico contra producción: **solo lectura** con la service account (`firebase-admin` instalado en una carpeta temporal **fuera** de los repos, y borrada al terminar). Los `uid` tienen 28 caracteres: no truncarlos.

### Código
- **Capas**: `lib/` puro (sin Firebase ni React, testeable) → `services/` (Firestore) → `components/` + `pages/` (UI). En la RN: Screen → Service → Helper.
- **Una regla, una implementación**: si algo lo usan dos pantallas —o el alta y la anulación— vive en `lib/`. Si lo que se ve y lo que se permite salen del mismo cálculo, no pueden contradecirse.
- Los módulos de `lib/` que se **testean** importan con **extensión `.ts` explícita** (`./dinero.ts`).
- `npm test` corre `src/lib/*.test.ts` con el runner nativo de Node: **al agregar un test, sumarlo a la lista del script**.
- **Baseline de lint: 80 warnings / 0 errores.** No subirlo (para evitar el warning de `setState` en efectos, derivar el estado en vez de sincronizarlo con un efecto).
- ⚠️ **Un test que pasa no valida la intención, solo la repite**: leer el *motivo* de cada assert. El bug del bolsillo estaba "documentado" por un test que lo aprobaba.

### Reportes y datos
- **Un cobro de crédito y una nota NO son ventas** (`esVentaReal`); la NC **resta** del total.
- Los reportes por **categoría** son **histórico** (leen `items[].categoria` guardado). No se "arreglan" por iniciativa propia.
- **`limiteCredito = 0` significa SIN LÍMITE** (no "cero permitido": interpretarlo así rompería toda venta a crédito).
- Antes de afirmar un problema de caja o fiscal, **mirar la producción en solo lectura**. Ya pasó dos veces que la alarma inicial era falsa.

## Historial de sesiones

El detalle de cada sesión —objective, decisiones con su porqué, evidencias, `Next Move` y archivos tocados— está en **`HISTORIAL-SESIONES.md`** (más reciente primero, hasta el bloque ·10).

⚠️ **Por qué está separado**: el entorno carga `AGENTS.md` como instrucciones con un presupuesto (~64 KB) y lo **trunca** si se pasa; con 72 KB se estaba perdiendo el final del archivo (tabla de colecciones incluida). Acá queda solo lo que **gobierna** el trabajo. Al cerrar una sesión: el bloque va **al historial**, y en `## Estado actual` solo se actualiza lo que cambió de fondo.

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc -b && vite build` (TypeScript check + bundle to `dist/`)
- `npm run lint` — Oxlint (NOT ESLint). Config: `.oxlintrc.json`
- `npm test` — **runner nativo de Node** sobre `src/lib/*.test.ts` (`node --test`, sin dependencias ni framework: los módulos de `lib/` son puros). Al agregar un test, sumarlo a la lista del script.
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
- `meta name="mobile-web-app-capable"` (NOT `apple-mobile-web-app-capable`, deprecated)

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
| ERRORES | tblErrores | Errores de la app web: `{ mensaje, stack, contexto, ruta, dispositivo, usuario, fecha }` (ver Auditoría → Errores) |
| CATEGORIAS | tblCategorias | Categorías de producto administradas: `{ nombre, orden, activo, icono }` (id = slug; el producto guarda el nombre en `categoria`) |
