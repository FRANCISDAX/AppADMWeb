# Plan para vender AppADM a otros negocios

> **Estado: borrador para revisar.** Nada de lo que dice acá está implementado todavía. Se escribió
> el **29/09/2026** a pedido del usuario (*«lo voy a vender a otros negocios»*), después de un
> diagnóstico del código. Lo técnico está verificado en el repositorio; lo legal y lo fiscal lo tiene
> que confirmar un abogado y el contador (**no es asesoría legal**).

## 1. Dónde estamos parados (hechos, no supuestos)

Verificado en el código el 29/09/2026:

- 🔴 **El app es de UN solo negocio.** Una sola configuración (`tblConfiguracion/empresa`), una sola
  base, un solo sitio publicado (`appadm-b359e.web.app`). No existe `empresaId` en ninguna colección.
- 🔴 **`firestore.rules` permite leer y escribir TODO a cualquier usuario con sesión**
  (`match /{document=**} { allow read, write: if signedIn(); }`). Los permisos de la app
  (`tblUsuarios/{uid}.permisos`) se leen **en vivo** desde Firestore ⇒ con estas reglas, **cualquier
  usuario con sesión puede escribir su propio documento de permisos** y, en la práctica, darse
  `verTodo` o rol ADMIN. *(Se deduce de las reglas + de cómo la app lee los permisos; no se probó
  explotándolo contra producción.)*
- 🔴 **No hay respaldo automático de Firestore** ni monitoreo de infraestructura: un error humano hoy
  es una pérdida sin vuelta.
- ⚠️ **App Check está apagado** (se quitó por un problema de CSP) y no hay límite de altas.
- ⚠️ **Las claves de servicio (service accounts) viven dentro de OneDrive** y hay más de una copia.
- ✅ **Lo que ya está bien**: el catálogo público se lee **sin sesión** solo en `tblPublico/catalogo`
  (nombre, precio y stock; **sin fotos ni datos internos**), la sesión es única por persona, existe
  `tblAuditLog`, hay alertas proactivas, y el manual de usuario (2.22) está listo para capacitar.
- ⚠️ **Las claves de Firebase van fijas en la compilación** (`VITE_FIREBASE_*` en `.env.local`): hoy
  **un cliente = una compilación y un despliegue**. Eso condiciona todo el punto 3.

## 2. Decisión 1 — ¿de quién es el proyecto de Firebase del cliente?

| | **A) Del cliente** (recomendada) | **B) Tuyo, como servicio** |
|---|---|---|
| Quién paga Firebase | El cliente (su tarjeta, su plan) | Vos |
| De quién son los datos | Del cliente: vos sos **encargado** | Los tenés vos: más responsabilidad |
| Costo fijo tuyo | Casi cero | Crece con cada cliente |
| Si el cliente se va | Se lleva todo, no hay rehenes | Hay que exportar y borrar |
| Riesgo tuyo | Menor (no custodias sus datos) | Mayor (filtración, respaldo, disponibilidad) |
| Ingreso | Licencia + soporte | Suscripción (más margen, más trabajo) |

**Recomendación**: empezar por **A** (el cliente es dueño de su proyecto). Te saca de encima la
custodia de datos de terceros y hace que el respaldo sea una obligación de él —aunque el alta y el
acompañamiento los hacés vos—. Si algún día querés vender como servicio llave en mano, B se puede
ofrecer como plan premium.

## 3. Decisión 2 — cómo llega la app a cada cliente (aislamiento)

- **Hoy**: no hay aislamiento posible. Compartir un proyecto entre dos negocios con las reglas
  actuales significa que **el cajero de una bodega ve las ventas, costos, márgenes y clientes de la
  otra**. Con las reglas arregladas (punto 4) seguiría siendo un modelo frágil: una regla mal escrita
  y se ve todo.
- 🔑 **Fase 1 (recomendada): un proyecto de Firebase por cliente + configuración dinámica.**
  El app deja de leer las claves de la compilación y las pide a un archivo publicado
  (`/config/<negocio>.json`) según el **subdominio** desde el que entra. Resultado: **un solo código,
  un solo despliegue y bases separadas de verdad**.
  - A favor: aislamiento real, cero refactor de datos, alta de cliente sin tocar código.
  - En contra: hay que publicar y mantener ese archivo por cliente; y definir qué pasa si el archivo
    no existe (el app tiene que decir *«este negocio no está configurado»*, no arrancar en blanco).
- **Fase 2 (solo si pasás de ~10-15 clientes o querés autoservicio): `empresaId` en todo + reglas por
  inquilino.** Alcance real: toca **todos** los servicios y consultas (ventas, caja, stock, kardex,
  egresos, reportes, contadores, catálogo público), los **índices compuestos** y las reglas. Es un
  refactor grande y riesgoso: **no hacerlo antes de tener clientes que lo justifiquen**.
- ⚠️ **Lo que no hay que hacer nunca**: dos negocios en un mismo proyecto con las reglas de hoy.

## 4. Cerrar la seguridad (bloqueante: sin esto no se vende)

En este orden:

1. ✅ **HECHO (29/09/2026) — Reglas de Firestore por colección y por rol.** `firestore.rules` reescrito
   (263 líneas) y **desplegado**. Cierra la escalada de privilegios (la ficha solo la escribe un ADMIN;
   el dueño toca solo `activeSession`/`dashboardWidgets`), deja los avisos de Yape al puente y con el
   estado avanzando en un solo sentido, y hace que **una colección nueva nazca cerrada**. Probado con el
   arnés **`run-reglas.mjs` (64/64)** contra el emulador, con el token real de cada rol y el uid real del
   puente. Antes de desplegar se verificó que las **6 cuentas** reales tienen ficha y están activas.
   ⚠️ Convive con la app móvil y con el puente: por eso están `Proveedor` (**sin** prefijo `tbl`),
   `tblPerfil`, `tblVoiceIntents` y las `*_test`.
2. ⏳ **PENDIENTE — App Check (reCAPTCHA v3)** en la web, y evaluar la RN. Se quitó por CSP: hay que
   volver a habilitarlo **con** la clave y el dominio autorizado.
3. ⏳ **A MEDIAS — Altas de usuario.** Las reglas ya impiden que alguien se dé permisos o se cree una
   ficha, y la app móvil **ya no crea ADMIN** (se sacó `migrarUsuario`, 29/09/2026). Falta **cerrar el
   alta libre por correo/contraseña** en Firebase Auth: mientras esté abierta, cualquiera con la clave
   pública puede crearse una cuenta (no verá nada, pero es ruido y superficie).
4. ⏳ **PENDIENTE — Llaves**: sacar las service accounts de OneDrive, rotarlas y dejarlas en un gestor
   de secretos. El puente ya usa su propia cuenta (bien).
5. ✅ **HECHO (29/09/2026) — Respaldo automático** (ver **4 bis**).
6. ⏳ **PENDIENTE — Auditoría**: `tblAuditLog` ya existe (223 documentos hoy); falta definir **retención**
   y **qué se revisa** (cierres, anulaciones, cambios de precio, altas de usuario).
7. ⏳ **PENDIENTE — Plan de incidentes**: quién avisa, a quién y en cuánto tiempo (esto va en el contrato).

### 4 bis. Respaldos (hecho el 29/09/2026)

🔑 **Dónde vive**: `C:\Users\aaval\appadm-backup\` — **fuera de los repos y fuera de OneDrive**
(las fotos del catálogo en base64 hacen que un respaldo pese ~11 MB comprimido; en OneDrive serían
~330 MB sincronizando todo el tiempo).

- **`respaldar.mjs`** — **solo lectura**: exporta **todas** las colecciones (y sus subcolecciones, si
  algún día hubiera) a `datos/<sello>/<coleccion>.jsonl.gz`, con los tipos de Firestore marcados
  (`{ "__tipo": "timestamp", … }`), un **manifiesto** con el conteo y el **sha256** de cada archivo, y
  las **cuentas de Auth** (`auth.json`, con las contraseñas cifradas) vía la CLI de Firebase. Borra los
  respaldos de más de **30 días**. Tarda ~90 segundos y **1.413 documentos en 25 colecciones** (medido).
- **`restaurar.mjs`** — el único que escribe: **sin `--confirmar` no toca nada** (simula y muestra qué
  escribiría). Tiene `--coleccion` para restaurar una sola, y `--probar-tipos`: una prueba **de solo
  lectura** que toma documentos reales, los serializa, los revive y los compara ⇒ **92 documentos en
  las 25 colecciones, 0 problemas** (esa es la prueba de que una restauración no deforma fechas ni mapas).
- **Cuándo corre**: tarea programada de Windows **«AppADM respaldo diario»**, todos los días a las
  **23:30** (verificado corriéndola a mano: dejó el respaldo completo y su registro). También se puede
  correr a mano con doble clic en **`respaldar.cmd`**.
- ⚠️ **Lo que este respaldo NO cubre**: si la PC está apagada a las 23:30, ese día no hay respaldo; y
  vive en el mismo local que los datos. Cuando el negocio pase al plan **Blaze**, hay que activar los
  **respaldos administrados de Firestore** (en la nube, con retención propia) y dejar este como copia
  extra. **Un respaldo que nadie probó no es un respaldo**: la prueba es `--probar-tipos` y, antes de
  vender, una **restauración de verdad** en un proyecto de prueba.

## 5. Alta de un cliente nuevo (checklist operativa)

1. **Firebase** del cliente: proyecto, plan **Blaze** (obligatorio: sin él, pasarse de cuota **corta el
   servicio hasta la medianoche**), ubicación de la base, hosting, dominio o subdominio.
2. **Identidad**: razón social, RUC, dirección, logo, mensaje legal; régimen tributario y
   **región exonerada** si corresponde.
3. **Usuarios y roles** (una cuenta por persona: la sesión es única) y **cajas con sus series**.
4. **Catálogo**: importación por Excel, **costos** (sin costos el margen y el punto de equilibrio
   mienten), unidades y presentaciones, afectación por producto (exonerado/gravado).
5. **Hardware**: ticketera de 72 mm, lector, PC o celular (PWA).
6. **Cobros**: Yape (puente en el celular del negocio, con su propia cuenta) y/o tarjeta.
7. **SUNAT**: certificado, API, envío automático y plazos; el **emisor es el cliente**.
8. **Impuesto a las ventas (%)** y demás parámetros de la pestaña Empresa (punto de equilibrio).
9. **Capacitación** con el manual 2.22 + resumen 1.9, y **una venta real completa** de punta a punta
   (cobro, comprobante, cierre de caja) antes de dejarlos solos.
10. **Salida ordenada**: exportación completa de sus datos y borrado, si algún día se va.

## 6. Lo que hay que sostener después (operación)

- **Actualizaciones**: hoy un despliegue publica para todos; con un proyecto por cliente hay que
  definir **canal y ventana** (los cambios se prueban en un negocio piloto antes de llegar al resto).
- **Soporte**: canal, horario y qué **no** cubre (internet del local, ticketera, celular del puente).
- **Monitoreo**: alertas de infraestructura (no solo las de negocio que ya existen) y una revisión
  semanal de cuotas de Firebase.
- **Costos por cliente**: Firebase (medido: lo primero que se rompe son las **lecturas**, cada
  dispositivo cuenta el catálogo completo), API de consulta DNI/RUC, y **tu tiempo**.

## 7. Legal y comercial (para tu abogado y tu contador)

1. **Contrato de licencia** (licencia, no venta): alcance, actualizaciones, plazo, propiedad del
   software y de los datos, y salida.
2. **Garantía y límite de responsabilidad**: se entrega *«tal cual»*, sin garantizar resultados
   comerciales, con **tope de responsabilidad** (por ejemplo, lo pagado en los últimos meses).
3. **Anexo de tratamiento de datos personales**: el cliente es el **responsable**, vos el
   **encargado**; solo usás los datos para prestar el servicio, no los cedés, los eliminás al terminar.
   ⚠️ Si elegís la opción **B** del punto 2, esta parte cambia de peso: pasarías a custodiar datos de
   terceros.
4. **Aviso de que no sos el emisor ni el contador**: el comprobante lo emite el cliente; los números
   del dashboard son **referenciales**.
5. **Soporte y disponibilidad**: qué se promete y qué no.
6. **Web pública**: identificación del negocio (razón social y RUC), precios finales en soles y
   **Libro de Reclamaciones** si corresponde (es obligación del negocio, no del software; confirmar).
7. **Marca**: definir qué se vende (`AppADM` vs `CIBERSOFT CyS`) y quién es dueño del código.

## 8. Precio (marco para decidir; las cifras las pones vos)

- **Por sucursal o por caja, por mes** (el modelo que ya escala técnicamente: cada caja con sus series).
- **Pago único de instalación y capacitación** (es trabajo real: el punto 5).
- **Qué incluye cada plan**: usuarios, cajas, reportes, soporte, respaldo.
- ⚠️ **Tu costo variable no es cero**: Firebase, consultas de DNI/RUC y tu tiempo de soporte. Antes de
  poner precio, medí el consumo de **un** negocio real un mes.

## 9. Riesgos que hay que decir en voz alta

- **Un solo desarrollador (yo) y una sola persona de soporte (vos)** es el techo de crecimiento: cada
  cliente nuevo es soporte y capacitación, no solo un despliegue.
- **La API de SUNAT vive en tu casa** (`192.168.1.7`): si se corta la luz o el internet ahí, los
  clientes no mandan comprobantes. Vendiendo, eso hay que moverlo a un servidor en la nube.
- **El puente de Yape depende del celular del negocio** (que esté prendido, con batería y datos).
- **El documento del turno tiene techo**: guarda el detalle completo y se reescribe en cada venta
  (~917 bytes por venta) ⇒ **partir el día en turnos** antes de ~1.600 ventas en un mismo turno.
- **Sin respaldo probado**, un error humano es una pérdida total.
- **Un cliente que crece cambia tus obligaciones**: más datos, más soporte, más disponibilidad.

## 10. Orden de ejecución (con entregables verificables)

| Fase | Qué se hace | Entregable | ¿Se puede vender? |
|---|---|---|---|
| **1. Seguridad mínima** | Reglas por rol + App Check + respaldo probado + llaves fuera de OneDrive | Un intento de darse admin **falla**; una restauración de prueba **funciona** | Todavía no |
| **2. Multi-cliente** | Configuración dinámica por subdominio + alta repetible (punto 5) | Dar de alta un negocio de prueba **de punta a punta** | Sí, al primer cliente |
| **3. Papeles y precios** | Contrato, garantía, anexo de datos, web pública identificada | Documentos revisados por el abogado | Sí, con contrato |
| **4. Operación** | Soporte, canal de actualizaciones, monitoreo, respaldos por cliente | Manual de operación de 1 página | Sí, con soporte |
| **5. `empresaId`** (opcional) | Un solo proyecto con reglas por inquilino | Solo si hay muchos clientes | — |

## 11. Decisiones que necesito de vos

1. ¿El proyecto de Firebase es **del cliente** o tuyo? (punto 2)
2. ¿Un **subdominio por negocio** o una sola dirección para todos? (punto 3)
3. ¿**Cuántos** clientes esperás el primer año? (define si la fase 5 se hace o no)
4. ¿Quién da el **soporte** y en qué horario? ¿Solo vos?
5. ¿Quién es el **emisor de la factura** al cliente: `CIBERSOFT CyS` u otra empresa?
6. ¿El precio es **por caja** o por negocio, y qué incluye?
7. ¿La app móvil (`AppAdm`) se vende también, o solo la web?
