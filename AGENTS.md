# AGENTS.md — appadm-web

## What this is

React + TypeScript SPA (point-of-sale / inventory admin) backed by Firebase (Auth + Firestore). No router — navigation is state-driven in `src/App.tsx`. UI language is Spanish.

**Repos relacionados** (los versiona el usuario, **no** este agente): la app móvil **`AppAdm`** (Expo/React Native) y el **backend `appadm-sunat`** (FastAPI + `sunat_py`, corre en `192.168.1.7:8000`). Un cambio puede tocar los tres: si un defecto se arregla acá y **el mismo defecto existe en la RN, se arregla también** y se avisa (no alcanza con arreglar el web).

## Estado actual

- **Punto de partida (checkpoint del 17/09)**: se unificó y commiteó el trabajo que estaba sin versionar de la **sesión paralela** — **cajas** (`services/cajas.ts`), **ventas pendientes / en espera** (`components/PanelVentasPendientes.tsx`), **rol VENDEDOR** (`constants/permisos.ts`, `services/usuarios.ts`) y reportes de proveedores — junto con los fixes de UI y del service worker. Ese trabajo **no es de esta sesión**: se revisó que no rompiera los invariantes (no borra las reglas únicas ni reintroduce fórmulas a mano) y se restauró el baseline de lint (dos `\-` innecesarios en `Pdv.tsx`).
- ⚠️ **Los índices compuestos viven en `firestore.indexes.json`** y se despliegan con `npx firebase deploy --only firestore:indexes` (**ya desplegados** el 17/09: `tblEgresos: proveedorId + categoria`, `tblDocumentos: cajaId + estado + fecha`). **Nunca** `--force`. Al agregar una consulta con igualdad + rango/orderBy, declarar el índice ahí **y** desplegarlo: sin eso la consulta falla con *"The query requires an index"* (el mismo síntoma del bloque ·5 del historial). ⚠️ El proyecto tiene **1 índice creado a mano en la consola que no está en el archivo**: por eso **nunca** `--force` (lo borraría).
- **Ventas pendientes / en espera → pedidos** (feature de la sesión paralela, **rediseñada el 17/09** según lo que pidió el usuario): el **vendedor** manda la venta a caja y el **cajero**, desde `PanelVentasPendientes`, toca **"Cobrar pedido"**, que **trae el pedido al carrito del PDV** (modo pedido) y ahí elige **comprobante** (NV / Boleta / Factura) y **forma de pago** —una sola UI de cobro, con las mismas validaciones del PDV—. **El comprobante se genera recién al cobrar**: el pedido nace con `tipo: 'PENDIENTE'`, **sin serie ni correlativo** (solo un código propio, `PED-000123`, de un contador aparte `pedido`) y sin forma de pago; ahí sí se asigna serie + correlativo del tipo elegido. **El pedido NO toca el stock** (se descuenta al cobrar, en un solo lugar) y al **eliminarlo** (btn *Eliminar*, motivo obligatorio) solo se marca `cancelado`: **no se anula ningún comprobante porque no existe y el stock no se toca porque nunca se descontó**. Esto eliminó las dos limitaciones anteriores: cada pendiente quemaba un correlativo y el cambio de tipo dejaba huecos (una NV pendiente podía repetir número, ver invariantes), y la reserva de stock dejaba dos caminos de escritura de inventario. ⚠️ Los documentos `PENDIENTE`/`cancelado` quedan fuera de los reportes fiscales solos, porque todo reporte filtra `tipoDoc` contra `NV/BOLETA/FACTURA/NC/ND`.
- **Verde**: `npm test` **215/215**, `npx tsc -b` ✓, `npm run lint` 0 errores / **80 warnings (baseline: no subirlo)**, `npm run build` ✓.
- **Producción real** (medida, no supuesta): ~93 turnos, ~234 documentos, 40 productos **todos exonerados (`'20'`)** porque la región está exenta de IGV.
- **Decisiones tomadas con el usuario** (16/09) sobre los controles del cierre: **conciliación por billetera opcional** (no bloquea el cierre), **conteo ciego configurable y apagado por defecto** (`config.conteoCiego`, Configuración → Empresa) y **firmas**: los PDF imprimen nombre/RUC del negocio, quién cerró el turno y dos líneas de firma (cajero / supervisor).
- 📌 **Alcance acordado (17/09)**: de acá en adelante este agente trabaja **solo en el web**; la app móvil `AppAdm` queda para otra sesión (tiene cambios sin commitear de la última pasada: `helper/Arqueo.js` nuevo, notas con `medio`, rótulos con `etiquetaFormaPago` y el arqueo con desglose/origen — lint 0 errores, verificada en aislado).
- **Rol ALMACEN** (19/09): nuevo rol para alaceneros con acceso a inventario, kardex, compras, proveedores, productos y costos. Sin acceso a ventas, caja, reportes financieros ni configuración.

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
- 🔑 **La BOLETA CONSOLIDADA (consolidación de las NV del día) tiene que declarar el descuento de las NV que agrupa**: `generarConsolidado` (`services/consolidado.ts`) suma los totales (ya netos) y arma las líneas con los items de cada NV **a precio de lista**, así que el descuento va **declarado aparte** (`descuentoTotal` + `descuento_total` = Σ `descuentoDeVenta(nv.venta)`). 📌 **Bug del 18/09/2026**: el consolidador **tiraba el descuento** y unía los items por `id` sin mirar el precio → una NV con promoción, consolidada, salía con las líneas a precio de lista, el **total menor** y **sin ninguna fila de descuento** que lo explicara; y como el XML arma su total con `Σ líneas`, SUNAT habría recibido **más de lo cobrado**. Las reglas viven en **`lib/consolidado.ts`** (`consolidarItems` — la clave de agrupación es **`id|precio|unidad`**: dos NV pueden vender el mismo producto a precios distintos y unirlas dejaría un precio unitario que no explica el subtotal, justo lo que el comprobante declara—, `totalConsolidado`, `descuentoConsolidado`), puras y testeadas. ⚠️ **La RN tiene el mismo defecto** en `helper/ConsolidadoHelper.js`: hay que portarlo cuando se retome la móvil.
- **El IGV solo existe en afectación `'10'`**: `valorUnitarioSunat(precio, afectacion)` divide entre 1.18 **solo** para `'10'`; exonerado `'20'`, inafecto `'30'` y gratuitas van tal cual (dividirlas haría que el comprobante declare **menos** de lo cobrado).
- **Los items manuales del PDV** usan `config.tipoAfectacionManual` (default `'20'`) y **debe coincidir con el catálogo**: si no, el comprobante declara más (o menos) de lo cobrado.
- **El backend vive aparte** (`appadm-sunat`): un cambio ahí **no hace efecto hasta reiniciarlo**, y lo despliega el usuario. El SDK `sunat_py` es de PyPI y **no se toca**: el backend parchea el XML por `replace` antes de firmar.
- 🔑 **Todo lo que se manda a la API de SUNAT va con 2 DECIMALES** (`cantidad`, `precio_unitario` y los totales): el backend valida con Pydantic (`cantidad = Field(gt=0, decimal_places=2)`, `precio_unitario = Field(decimal_places=2)`, `TotalesIn` igual, en `app/schemas/invoice.py`) y **rechaza el envío con *"decimal input should have no more that 2 decimal places"***. La regla vive en **`itemsParaSunat()`** (`lib/sunat-importes.ts`, puro y testeado): reparte el descuento y deja el precio unitario en 2 decimales **sin perder el total cobrado** (el residuo del redondeo se repone línea por línea, de la más flexible —cantidad 1— a la menos flexible, en pasos de `cantidad` céntimos); `cantidadSunat()` ajusta la cantidad (una venta por peso con 3 decimales se declara con 2); en las líneas **gravadas** el valor sin IGV (`precio / 1.18`) también se redondea; y **todos los totales** pasan por `redondear2()` — si no, la suma de floats manda `0.30000000000000004` y la API lo rechaza por el mismo motivo. ⚠️ **El backend IGNORA el bloque `totales`**: arma el XML con `cantidad × precio_unitario` de cada línea (`app/services/invoice_service.py`), así que lo que manda es el **precio unitario por línea**, no nuestro total. 📌 **Bug del 18/09/2026**: el web mandaba el precio unitario efectivo con hasta **6** decimales (`DECIMALES_PRECIO`): una línea con descuento daba `1.09 / 2 = 0.545` y el envío se caía (después de tocar `services/sunat.ts`, el error pasó de Firestore a Pydantic). ⚠️ **La RN tiene el mismo defecto** (`AppAdm/services/sunat.js`: `precio_unitario: valor` sin redondear).
- 🔑 **Los correlativos tienen DOS espacios y viven en `tblContadores`**: `notaVenta_{serie}` para **notas de venta** y `sunat_{serie}` para boletas, facturas y NC/ND. La clave se arma **siempre** con **`claveContador(tipoDoc, serie)`** y el campo es **`CAMPO_CONTADOR` = `ultimoCorrelativo`** (ambos en `lib/contadores.ts`, puro y testeado); se **siembra desde el máximo ya emitido** cuando el contador no existe. ⚠️ **Regla que ya se rompió**: el flujo de ventas pendientes usaba `sunat_{serie}` para todo y escribía el campo `contador` → nació un contador paralelo **`sunat_NV01` que arrancaba en 1** mientras las NV iban por `notaVenta_NV01 = 173`, y la siguiente NV pendiente habría **repetido un número ya emitido**. Nunca escribir la clave ni el campo a mano.

### Pedidos (venta enviada a caja) y stock
- **Un pedido no es un comprobante**: `tipo: 'PENDIENTE'`, `serie: ''`, `numero: 0`, sin bloque `sunat`, sin forma de pago, y su código `PED-000123` sale del contador `pedido` (`CLAVE_PEDIDO` + `codigoPedido`, `lib/contadores.ts`). **La serie y el correlativo se asignan una sola vez, al cobrar** (`cobrarVentaPendiente`, con `claveContador(tipoFinal, serieDestino)`); eliminar un pedido **no deja huecos**. No volver a numerar en el alta.
- 🔑 **El pedido NO toca el stock: el inventario se descuenta recién al cobrar, en UN solo lugar** (`cobrarVentaPendiente`). Decisión explícita del usuario (17/09): *"un pedido es un ticket en espera, no una reserva"*. Antes reservaba stock con movimientos `venta_pendiente` y había que reponerlos al eliminar; eso creaba **dos caminos de escritura de stock** (alta y cobro) y dejaba stock retenido si el pedido quedaba colgado. **No reintroducir la reserva sin hablarlo**: si algún día se quiere apartar producto (seña, cliente que vuelve), va como **capa explícita y visible** (campo `reservado` mostrado en el catálogo), no como descuento silencioso.
- **Eliminar un pedido = marcarlo `cancelado`** (`cancelarVentaPendiente`, con motivo obligatorio): **una sola escritura** — no lee ni escribe `tblProductos` ni crea movimientos, porque no hay nada que deshacer. Se registra en `tblAuditLog` (`accion: 'eliminar_venta_pendiente'`). ⚠️ **No es un borrado físico**: el documento queda en `tblDocumentos` con `estado: 'cancelado'`, el motivo y quién lo eliminó — sirve para rastrear por qué un pedido no llegó a comprobante. Desaparece de la lista de pendientes (`obtenerVentasPendientes` filtra `estado == 'pendiente'`) y **de todos los reportes** (filtran `tipoDoc` contra `NV/BOLETA/FACTURA/NC/ND`).
- **Los pedidos los ve el cajero en el PDV**, no en una pantalla aparte: `PanelVentasPendientes` se monta arriba del carrito y solo si tiene `verVentasPendientes`. ⚠️ **La lista NUNCA debe depender de la caja para mostrarse**: `obtenerVentasPendientes()` trae **todos** los pendientes y el reparto lo decide **`repartirPedidos()`** (`lib/pedidos.ts`), no la consulta. Filtrar en Firestore (o esconder el panel con `if (!cajaId) return null`) fue el bug real del 17/09: el vendedor tenía `caja_principal`, **los cajeros no tenían caja**, y el pedido `PED-000001` era **imposible de cobrar** porque la lista salía vacía y el panel escondido. Un pedido que no se ve es una venta perdida: **ante la duda, mostrar**.
- ⚠️ **El cobro de un pedido usa las series de la caja del CAJERO** (`serieBoleta`/`serieFactura`/`serie_prefijo` de `usePermisos()`, con la config de la empresa como respaldo) igual que el PDV: si no, un cajero de la caja 2 emitiría con la serie de la caja 1.
- **Cajas = puntos de emisión** (`services/cajas.ts`): nombre + **8 series** (Boleta, Factura, NV, NC, ND, NCB, NDB). Se crean en **Configuración → Cajas** y se asignan al usuario en **Usuarios → Editar → Caja**. ⚠️ **Quien la necesita es el CAJERO** (es quien emite: define con qué serie sale el comprobante); el **vendedor no** — su caja solo **dirige** el pedido. Si un usuario no tiene caja, se usan las series de la configuración de la empresa (funciona, pero deja de ser explícito).
- 🔑 **Caída de una caja con pedidos abiertos (decisión del usuario, 17/09)**: un pedido lleva `cajaId` **de ruteo** y **nadie más lo lee** (no hay reportes ni arqueo que agrupen por caja; las series las pone la caja que **cobra**), así que hay dos mecanismos que deben convivir: **(A) transferir** los pedidos abiertos de una caja a otra (**Configuración → Cajas → Transferir pedidos**, `moverPedidosDeCaja()`: `writeBatch` + `tblAuditLog`, devuelve cuántos movió) y **(B) rescate**: el panel muestra los pedidos de **otra** caja en un bloque aparte y los deja cobrar con confirmación (*"se va a emitir con la serie de tu caja"*). Con (A) queda el orden; con (B) nunca se pierde una venta si nadie transfirió. El reparto lo hace **`repartirPedidos()`** (`lib/pedidos.ts`, puro y testeado): sin caja se ve todo, con caja se ven los propios + los sin caja, y los de otra caja van a `otrasCajas` (nunca se ocultan en silencio). El documento cobrado queda con **la caja que lo emitió**.
- 🔑 **Modo pedido: el cobro del pedido ocurre en el CARRITO, no en la tarjeta** (decisión del usuario, 17/09). `Cobrar pedido` (en `PanelVentasPendientes`) llama a `onCobrarPedido` y el PDV guarda `pedidoActivo` (`lib/pedidos.ts` → `pedidoParaCarrito()`): el carrito muestra **sus** items en solo lectura, con una franja ámbar, y el cajero elige **comprobante + forma de pago con la UI de abajo**; el botón del carrito pasa a ser **`Cobrar pedido S/ …`** → `cobrarVentaPendiente`. 🔑 **`total` en el PDV es el pedido cuando hay pedido activo** (`const total = pedidoActivo ? pedidoActivo.total : totalCarrito`), así el resumen de pagos, las validaciones y los botones no pueden contradecirse: **el monto es el COTIZADO por el vendedor y no se recalcula** con las promos del día. En modo pedido se ocultan **envío, descuentos, cliente, crédito** y las acciones del carrito (Vaciar/Pausar/Enviar a caja). ⚠️ **No volver a poner un cobro embebido en la tarjeta**: tenía su propia copia de comprobante, formas de pago y validaciones (RUC/DNI), o sea dos lugares y dos reglas para lo mismo — y el cajero elegía entre dos.
- 🔑 **El crédito se maneja directamente en caja (decisión del usuario, 17/09)**: un pedido del vendedor se cobra **siempre al contado** (efectivo / Yape / Plin / transferencia / tarjeta) y por eso **en modo pedido no se ofrece "Crédito"**. Si el cliente quiere fiado, el **cajero** arma la venta como cualquier otra y la cobra a crédito con la validación de saldo (`lib/credito.ts`). El vendedor tampoco puede elegir forma de pago al enviar (no ve esa sección), así que **un pedido nunca puede nacer con intención de crédito**. ⚠️ Si algún día se quisiera permitir, hay que resolver antes qué pasa con el saldo del cliente: `calcularSaldoCredito` lee `venta.tipoPago === 'credito'` y `cobrado`, y `cobrarVentaPendiente` no escribe `cobrado`.
- **Al cobrar, si el stock ya no alcanza, el cobro falla con un mensaje claro** (*"El stock de X se agotó mientras el pedido esperaba en caja"*): es el costo de no reservar (otro vendedor pudo vender esas unidades) y el cajero tiene que enterarse antes de cobrar, no después con el inventario mintiendo.
- **Dos personas en una venta = una regla, `lib/personal.ts`** (`personalDeVenta`, `lineasPersonal`, `textoPersonal`): **cuando hay vendedor y cajero distintos, los dos salen impresos; si trabajó una sola persona, sale una sola vez**. Se usan `venta.vendedor` (quien armó el pedido) y `venta.cajero` (quien cobró), con `doc.vendedorNombre`/`doc.cajero` como respaldo. ⚠️ **"Mostrar los dos campos" NO es lo mismo que "mostrar a las dos personas"**: `registrarVenta` escribe el **mismo usuario** en `cajero` y en `vendedorNombre` (venta directa del cajero), así que la regla **colapsa el nombre repetido** — si no, el ticket diría el mismo nombre dos veces. ⚠️ **`venta.cajero` de un pedido NO es el vendedor** (era el bug: al mandar a caja se escribía el vendedor en `cajero` y el comprobante lo imprimía como si hubiera cobrado él); al cobrar se guardan los dos: `venta.vendedor` + `venta.cajero`. Se imprime en el comprobante (`Vendedor: Ana · Cajero: Luis`) y en el arqueo, por comprobante, como `· Vend: Ana` (solo cuando no es el cajero del turno).
- ⚠️ **Los movimientos de stock siguen el formato del kardex** (`services/kardex.ts`): `tipoMovimiento`, `cantidad` **positiva** y el signo lo decide `esEntrada()`; además `stockAnterior`/`stockNuevo`/`fecha`. Un `tipo` suelto o una `cantidad` negativa no se leen (quedan invisibles en el kardex). El cobro de un pedido escribe un movimiento `venta` igual que `registrarVenta` (con `vecesVendido: increment(1)`).
- 🔑 **Un pedido tiene que declarar el DESCUENTO igual que una venta directa**: `crearVentaPendiente` guarda **`descuentoTotal`** (camelCase: el que leen `lib/pdf.ts` y `lib/sunat.ts`) **y** `descuento_total` (nombre viejo). 📌 **Bug del 18/09/2026**: el pedido guardaba **solo** `descuento_total`, así que al cobrarlo el comprobante **no veía descuento**: sumaba las líneas a **precio de lista** y declaraba el total ya descontado (2 huevos con promo «2 o más a S/ 0.50» + 2 galletas: líneas 2.20, `TOTAL IMPORTE` 2.00) **sin ninguna fila de descuento** que lo explicara — y el XML habría declarado 2.20. **La lectura es una sola regla: `descuentoDeVenta(venta)`** (`lib/sunat-importes.ts`, pura y testeada: camelCase con respaldo en snake_case) y la usan el PDF, el XML de SUNAT y el carrito del cajero (`pedidoParaCarrito().descuento`, que se muestra en la franja ámbar del modo pedido para que el cajero vea el descuento del vendedor). ⚠️ Los **precios de las líneas siguen siendo los de lista**: lo que se declara es el total con la fila `Descuento` (modelo SUNAT), no un precio unitario ya rebajado.
- 🔁 **Un pedido idéntico no se crea dos veces**: si el mismo vendedor manda la misma venta y ese pedido **sigue pendiente dentro de los 15 minutos** (`VENTANA_DUPLICADO_MINUTOS`), `crearVentaPendiente` **rechaza el alta** y devuelve el código del que ya existe (`{ duplicado: true, codigoPedido }`); el PDV entonces pide confirmación (*"¿Enviar otro igual?"*) para el caso legítimo —otra venta con los mismos productos—, y con `permitirDuplicado: true` el documento queda marcado `duplicadoConfirmado: true`. 📌 **Caso real (18/09/2026)**: un reenvío creaba `PED-000123` **y** `PED-000124`; el cajero cobraba uno y el otro quedaba colgado **para siempre** en su lista, aparentando *"un pedido ya procesado que sigue apareciendo"* (y el stock se descontaba una sola vez, así que el sobrante no se notaba por inventario). Las reglas viven en **`lib/pedidos.ts`** (`huellaPedido()`: vendedor + total + líneas ordenadas, **sin fecha** —para reconocer el reenvío— y sin cliente; y `pedidoDuplicado()`, que también recalcula la huella de los pedidos viejos que no la tienen guardada), puras y testeadas. ⚠️ La comprobación es **fail-open a propósito**: si la consulta de pendientes falla, el pedido se crea igual — es una ayuda contra el error humano, no un candado que pueda bloquear una venta.
- 🧭 **Listado de pedidos y quién ve qué (decisión del usuario, 18/09/2026)**: `Reportes → Pedidos` muestra los pedidos del mes con su ciclo completo —*En caja*, *Cobrado* (con **el comprobante emitido** y quién lo cobró) y *Eliminado* (con **el motivo**)— leyendo `obtenerPedidosDelMes()` (`services/ventas.ts`), que usa **una sola igualdad (`anioMes`) y filtra en JavaScript ⇒ sin índice compuesto**. Un pedido se reconoce **en cualquier estado** con **`esPedido()`** (`lib/pedidos.ts`): `tipoDoc === 'PENDIENTE'` mientras espera, y el campo **`pedido`** (el `PED-…` que `cobrarVentaPendiente` conserva al cobrar) cuando ya tiene comprobante — ⚠️ **sin esa segunda marca, un pedido cobrado sería indistinguible de una venta directa del cajero**. 🔑 **Visibilidad: `pedidosVisiblesPara()`** — `verTodo` (admin/supervisor) ve **todos**; el **vendedor** solo **los suyos** (`vendedorId`) y el **cajero** los que **cobró** (`cajeroId`) más los que haya armado. La regla vive en `lib/pedidos.ts` (pura y testeada) para que la pantalla no la reinterprete. Las tres acciones del ciclo quedan además en `tblAuditLog` con rótulo propio (*Enviar pedido a caja*, *Cobrar pedido*, *Eliminar pedido*) bajo el módulo **Pedidos**.

### Descuentos
- 🔑 **Dos cosas distintas: descuento AUTOMÁTICO vs MANUAL.** Las promociones (volumen `tblPromocionesVolumen`, `descuentoPorcentaje` del producto, descuento del cliente, `precioEspecial`) son **configuración del negocio** y se aplican **siempre**, a todos los roles. El **descuento manual** (global S/ o % que carga una persona en el PDV) es una **decisión de mostrador** y es lo único que se controla.
- **Permiso `aplicarDescuento`** (`constants/permisos.ts`): sin él, el PDV **no muestra** la tarjeta "Descuentos" (avisa por qué). Default **true** en ADMIN/GERENTE/CAJERO/VENDEDOR (así el vendedor no pierde lo que ya hacía); el dueño lo quita o lo da por usuario en `Usuarios → Editar → Funciones`.
- **Tope `config.descuentoMaximoPorcentaje`** (Configuración → Empresa; **0 = SIN TOPE**, misma convención que `limiteCredito = 0`): la regla vive en **`revisarDescuentoManual()`** (`lib/descuentos.ts`, puro y testeado) y se aplica **dos veces**: en el PDV (avisa y deshabilita Cobrar/Enviar a caja) y en `crearVentaPendiente` (rechaza con el mensaje; segunda capa, porque el permiso solo se evalúa en el cliente). Un descuento **en soles** se mide como porcentaje del subtotal, así el tope es una sola unidad de medida. ⚠️ **No aplica a las promociones automáticas** ni a `registrarVenta` (para no bloquear al cajero en un caso autorizado).
- ✅ **Los cupones se ELIMINARON** (17/09/2026, a pedido del usuario: *"ya no se usan"*): se borró `services/cupones.ts`, `calcDescuentoCupon` y `COL.CUPONES`. **Eran código muerto**: nadie importaba el servicio, la función **nunca se llamaba** (ni siquiera dentro de `calcularDescuentos`) y no había UI en ningún lado; `tblCupones` quedó **vacía** en producción (0 documentos, verificado). **No reintroducir** sin pedido explícito; si vuelven, tienen que pasar por `revisarDescuentoManual()` para respetar el tope.

### Afectación (IGV) — leer antes de tocar cualquier flujo de venta
- 🔑 **La afectación es de CADA PRODUCTO** (`Producto.tipoAfectacion`): manda por encima de cualquier configuración. `afectacionDe(item, { regionExonerada })` (`lib/sunat-importes.ts`, puro y testeado) es la **regla única**: si el item trae la suya, esa; si no, el default del negocio (`config.regionExonerada ? '20' : '10'`). **`config.regionExonerada` NO es un override** — es solo el default de lo que no trae dato (antes era **decorativa**: se mostraba en Configuración y no se usaba en ningún cálculo).
- 🔑 **Los items de un DOCUMENTO llevan otra forma que los del carrito**: el carrito usa `quantity` + `precioVenta` por presentación; el documento usa `cantidad`/`cantidadEnUnidadBase` en **unidades base**, `precioVenta` por **unidad base**, `subtotal`, `unidad`, `categoria` y **`tipoAfectacion`**. 📌 **El bug del 18/09/2026**: `enviarACaja` (pedido) mandaba el formato del carrito, así que los pedidos se guardaban **sin `tipoAfectacion`** → al cobrarlos, `it.tipoAfectacion || '10'` los declaraba **GRAVADOS** y un producto exonerado (`'20'`) salía con **Op. Gravadas + I.G.V. 18%** en el comprobante. Con una venta por presentación (factor > 1) el `subtotal` además habría salido inflado por el factor. **Al agregar un flujo nuevo de venta, copiar el formato de `registrarVenta`**, no el del carrito.
- **Los items de "Embalaje y Otros"** (sin producto en el catálogo) llevan su **propia `afectacion`**: arranca con `config.tipoAfectacionManual` y el cajero la cambia por item con el selector del carrito (catálogo `TIPO_AFECTACION`). Viaja igual en la venta directa y en el pedido; `VentaPausada` la guarda para no perderla al pausar/recuperar.
- **Revisar la afectación con los ojos en el PDF**: si un comprobante muestra filas *Op. Gravadas / I.G.V.*, hay al menos un item declarado `'10'`. En una región exonerada eso es un error, no una cuestión de criterio.

### Firestore
- **Igualdad + rango/orderBy ⇒ índice compuesto** declarado en `firestore.indexes.json` y desplegado con `npx firebase deploy --only firestore:indexes`. ⚠️ **Nunca `firebase deploy --force`** (borra índices que no estén declarados ahí).
- 🔑 **`undefined` NO es un valor válido: Firestore lo RECHAZA al escribir** (*"Function transaction.set() called with invalid data. Unsupported field value: undefined"*) y **TypeScript no avisa** (un campo opcional `string | undefined` compila perfecto). Fue un bug real: **enviar una venta a caja fallaba siempre** porque el payload llevaba `descuentoGlobalTipo: undefined` y `envio: undefined`, y el `tsc` en verde no dijo nada (0 pedidos en producción: nunca había funcionado). **Reglas**: (a) los opcionales que pueden faltar van con **spread condicional** (`...(x ? { campo: x } : {})`) o en **`null`** (`?? null`); (b) **en el borde de escritura**, envolver el payload en **`limpiarUndefined()`** (`lib/limpio.ts`, puro y testeado) — es la red de seguridad: borra los `undefined` en profundidad, descarta los sueltos dentro de arrays y **respeta `null`, `Date`, `Timestamp`, `deleteField()` e `increment()`** (son instancias de clase). Ya se usa en `ventas.ts` (alta, pedido, cobro, anulación), en el guardado de productos de `Inventario.tsx` y en **`services/sunat.ts`** — donde la respuesta del CDR **no siempre trae** `cdr_code`/`cdr_desc`/`hash` y el `updateDoc` del bloque `sunat` fallaba con ese error **aunque SUNAT ya hubiera aceptado el comprobante** (el usuario veía el texto de Firestore y no el resultado del envío); los campos del CDR se normalizan en `datosCdr()` (`?? null`) **y** el payload pasa por `limpiarUndefined()`, y el `actualizar()` del `catch` va en su propio `try` para que un fallo al guardar el estado de error no tape el error real. Para diagnosticar antes de escribir: `rutaConUndefined(payload)` devuelve la ruta del campo culpable.
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

El detalle de cada sesión —objective, decisiones con su porqué, evidencias, `Next Move` y archivos tocados— está en **`HISTORIAL-SESIONES.md`** (más reciente primero, hasta el bloque ·11).

⚠️ **Por qué está separado**: el entorno carga `AGENTS.md` como instrucciones con un presupuesto (~64 KB) y lo **trunca** si se pasa; con 72 KB se estaba perdiendo el final del archivo (tabla de colecciones incluida). Acá queda solo lo que **gobierna** el trabajo. Al cerrar una sesión: el bloque va **al historial**, y en `## Estado actual` solo se actualiza lo que cambió de fondo.

## Commands

- `npm run dev` — Vite dev server (port 5173)
- `npm run build` — `tsc -b && vite build` (TypeScript check + bundle to `dist/`)
- `npm run lint` — Oxlint (NOT ESLint). Config: `.oxlintrc.json`
- `npm test` — **runner nativo de Node** sobre `src/lib/*.test.ts` (`node --test`, sin dependencias ni framework: los módulos de `lib/` son puros). Al agregar un test, sumarlo a la lista del script.
- `npm run preview` — serve production build locally
- `npx firebase deploy --only hosting` — deploy to Firebase Hosting

### Documentos del producto (`docs/`)

`docs/manual-usuario.html` (manual de usuario, con su PDF) y `docs/resumen-app.html` (resumen comercial). Los PDF se regeneran **sin abrir el navegador a mano** con Chrome headless:

```
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="docs/manual-usuario.pdf" "file:///C:/ruta/al/repo/docs/manual-usuario.html"
```

⚠️ **Actualizarlos NO requiere deploy**: `docs/` no está en `public/` y la app no los linkea (son archivos para compartir con el cliente). Si el manual cambia de fondo, subir la versión en la portada y en el footer. **Los PDF están versionados en el repo a pedido del usuario** (17/09).

No test framework is configured. No CI workflows exist.

## Path alias

`@` → `src/` (configured in `tsconfig.app.json`, `vite.config.ts` resolve alias). Always use `@/...` imports.

## Env vars

Copy `.env.example` → `.env.local`. Required: `VITE_FIREBASE_*` keys. Optional: `VITE_APIS_PERU_TOKEN`, `VITE_SUNAT_API_BASE` for SUNAT DNI/RUC lookup.

## Key architecture

- **Entry**: `src/main.tsx` → `AuthProvider` → `PermisosProvider` → `NotificationsProvider` → `App` (Shell)
- **Navigation**: `src/App.tsx` holds `seccion` state — no react-router. Pages are in `src/pages/`.
- **Firebase init**: `src/lib/firebase.ts` — uses `browserLocalPersistence` (auth persists across tabs). Firestore offline persistence: `persistentLocalCache` + `persistentMultipleTabManager`.
- **Permissions**: Role-based (ADMIN / GERENTE / CAJERO / VENDEDOR / ALMACEN / PERSONALIZADO). Defaults in `src/constants/permisos.ts`. Live-synced from Firestore `tblUsuarios/{uid}.permisos`.
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
3. **Client discount** — `descuentoPorcentaje` field on `Cliente` (frequent customer discount)
4. **Global discount** — manual input in PDV (percentage or fixed amount), sujeto al permiso `aplicarDescuento` y al tope `config.descuentoMaximoPorcentaje` (ver invariante de Descuentos)

Calculation order: product → volume → client → global. Each layer applies on the subtotal from the previous layer. **Los cupones se eliminaron** (17/09/2026) — ver el invariante de Descuentos.

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
| PROMOCIONES_VOLUMEN | tblPromocionesVolumen | Volume-based promotions (incl. monto_fijo) |
| ERRORES | tblErrores | Errores de la app web: `{ mensaje, stack, contexto, ruta, dispositivo, usuario, fecha }` (ver Auditoría → Errores) |
| CATEGORIAS | tblCategorias | Categorías de producto administradas: `{ nombre, orden, activo, icono }` (id = slug; el producto guarda el nombre en `categoria`) |
