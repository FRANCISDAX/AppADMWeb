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

## 2. Decisión 1 — ¿de quién es el proyecto de Firebase del cliente? ✅ DECIDIDO (29/09/2026)

> **El usuario decidió**: el app se va a vender a **varias empresas**, cada una con **su propia cuenta de
> Firebase (su propio proyecto)**, y los proyectos **cuelgan de una única cuenta principal** (por ahora
> **su cuenta de Google**, sin organización de Google Cloud). La configuración **será manual** por el
> momento; automatizarla queda para después (ver **3 bis**).

⚠️ **Consecuencia que hay que asumir a cambio del aislamiento**: los datos de todas las empresas quedan
**bajo tu cuenta** ⇒ sos vos el que los **custodia** (la opción B de la tabla de abajo). Eso cambia el
peso del **anexo de tratamiento de datos** del contrato (punto 7.3) y hace que **el respaldo sea tu
obligación con cada cliente**, no la de él.

| | **A) Del cliente** (no es lo elegido) | **B) Tuya, un proyecto por cliente** ✅ |
|---|---|---|
| Aislamiento entre empresas | Total | **Total** (un proyecto = una base) |
| Quién paga Firebase | El cliente | **Vos** (una cuenta de facturación; la cuota gratuita es **por proyecto**) |
| De quién son los datos | Del cliente | Del cliente, **bajo tu custodia** |
| Acceso del cliente | Total, es suyo | Se le puede dar **IAM sobre su proyecto** (sin organización también se puede) |
| Respaldo | Obligación de él | **Tu obligación, por cada cliente** |
| Si el cliente se va | Se lleva todo | Hay que **exportar y borrar** lo que quedó en su proyecto |

**Recomendaciones con este modelo** (ninguna bloquea la venta, pero conviene hacerlas antes del 3.º cliente):
1. 🔑 **No cuelgues los proyectos de tu cuenta personal**: usá una **cuenta de Google del negocio**
   (o de Workspace). Si no, el día que esa cuenta falle —o quieras sumar a alguien— quedás atado a una
   persona. Sin organización se pierde la auditoría centralizada y las políticas comunes, no el control.
2. **Una cuenta de facturación** con **etiquetas por proyecto** (`cliente: acme`) para saber cuánto
   consume cada uno y **no vender a pérdida**.
3. **Ofrecé el acceso al proyecto**: darle al cliente permiso sobre **su** proyecto es un argumento de
   venta fuerte (*«tus datos están en tu base y podés entrar»*) y, además, deja claro que **vos también
   podés entrar** — mejor decirlo que ocultarlo.
4. **Baja del cliente**: exportación completa, entrega, y **borrado del proyecto** (con constancia).
   Ese procedimiento tiene que estar en el contrato (punto 7).

## 3. Decisión 2 — cómo llega la app a cada cliente (aislamiento)

- **Hoy**: no hay aislamiento posible dentro de un mismo proyecto. Compartir un proyecto entre dos
  negocios significaría que **el cajero de una bodega ve las ventas, costos, márgenes y clientes de la
  otra**. Con las reglas nuevas (punto 4) igual sería un modelo frágil: una regla mal escrita y se ve todo.
- 🔑 **Lo elegido: un proyecto de Firebase por cliente** ⇒ el aislamiento es **total y por construcción**
  (bases separadas). El app no cambia: sigue hablando con *un* proyecto, el suyo.
- **Fase 2 opcional (solo si algún día querés autoservicio o miles de clientes): `empresaId` en todo +
  reglas por inquilino**, para tener varios negocios en una sola base. Alcance real: toca **todos** los
  servicios y consultas (ventas, caja, stock, kardex, egresos, reportes, contadores, catálogo público),
  los **índices compuestos** y las reglas. **No hacerlo**: con un proyecto por cliente no hace falta.
- ⚠️ **Lo que no hay que hacer nunca**: dos negocios en un mismo proyecto.

### 3 bis. Configuración manual (por ahora) y la trampa que ya nos pasó

> **Decisión del usuario (29/09/2026)**: la configuración se hace **a mano** por ahora; automatizarla
> (configuración dinámica por subdominio) queda para más adelante.

Como las claves van **fijas en la compilación** (`.env.local`), hoy **cada cliente es una compilación y
un despliegue** con **sus** claves. Es válido para los primeros clientes; lo que hay que evitar es el
error clásico de este flujo: **publicarle a un cliente la compilación de otro**.

📌 **Ya pasó una vez** (22/09/2026, bloque ·28 del historial): se publicó un `dist` con la configuración
de **prueba** (`demo-key`/`demo-appadm`) y nadie podía iniciar sesión. Por eso el chequeo previo al
despliegue **ya no alcanza con «que no sea la de prueba»**: tiene que ser **«que sea la de ESTE
cliente»** (ver el paso 7 de la receta del punto 5).

**Cuando moleste hacerlo a mano** (a partir del 3.º-5.º cliente, o cuando un despliegue tenga que
alcanzar a todos), el camino es la **configuración dinámica**: un solo código y un solo despliegue, con
**un subdominio por cliente** que le dice a la app a qué base conectarse (lee su config antes de
arrancar). Se mitiga el riesgo de «un despliegue para todos» probando primero en un **cliente piloto**.

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

### 4 bis. Respaldos (hecho el 29/09/2026; **por cliente** desde el mismo día)

🔑 **Dónde vive**: `C:\Users\aaval\appadm-backup\` — **fuera de los repos y fuera de OneDrive**
(las fotos del catálogo en base64 hacen que un respaldo pese ~11 MB comprimido; en OneDrive serían
~330 MB sincronizando todo el tiempo). Hay un **`LEEME.md`** ahí mismo con el uso y el alta de clientes.

- 🔑 **`clientes.json`** es la lista de empresas: `id`, `nombre`, `proyecto` y la ruta de su **llave de
  servicio**. **Agregar un cliente es agregar una línea** (ver el paso 8 de la receta del punto 5).
- **`respaldar.mjs`** — **solo lectura**: recorre **todos** los clientes activos (o uno con
  `--cliente`) y por cada uno exporta todas las colecciones a `datos/<cliente>/<sello>/<coleccion>.jsonl.gz`
  con los tipos de Firestore marcados (`{ "__tipo": "timestamp", … }`), un **manifiesto** con el conteo y
  el **sha256** de cada archivo, y las **cuentas de Auth** (`auth.json`, con las contraseñas cifradas)
  vía la CLI de Firebase. Retención de **30 días por cliente**. Tarda ~45 s por cliente.
  - 🔑 **Un cliente que falla no frena a los demás**, y al final da el **resumen** (`X de N OK`) y
    **termina con error** (verificado: con un cliente de prueba roto, el sano se respaldó igual y el
    proceso salió con código 1). Un cliente **sin respaldo** no puede pasar desapercibido.
  - ⚠️ **Avisa si una llave vive en OneDrive** (hoy pasa con la de JorFel): lo repite en cada corrida
    hasta que se mueva.
- **`restaurar.mjs`** — el único que escribe: **sin `--confirmar` no toca nada**. Antes de escribir
  imprime **el cliente y el proyecto destino** (para no restaurar en la base equivocada). Tiene
  `--coleccion` para restaurar una sola, `--ultimo` para el respaldo más nuevo, y `--probar-tipos`: una
  prueba **de solo lectura** que toma documentos reales, los serializa, los revive y los compara ⇒
  **92 documentos en las 25 colecciones, 0 diferencias** (medido).
- **Cuándo corre**: tarea programada de Windows **«AppADM respaldo diario»**, todos los días a las
  **23:30**, sin parámetros ⇒ **todos los clientes** (no hay que crear una tarea por cliente; verificado
  corriéndola con el script nuevo: dejó el respaldo de JorFel completo y su registro). También hay
  **`respaldar.cmd`** para hacerlo a mano con doble clic.
- ⚠️ **Lo que este respaldo NO cubre**: si la PC está apagada a las 23:30, ese día no hay respaldo; y
  vive en el mismo local que los datos. Cuando el negocio pase al plan **Blaze**, hay que activar los
  **respaldos administrados de Firestore** (en la nube, con retención propia) y dejar este como copia
  extra. **Un respaldo que nadie probó no es un respaldo**: la prueba es `--probar-tipos` y, antes de
  vender, una **restauración de verdad** en un proyecto de prueba.

## 5. Alta de un cliente nuevo — receta manual (paso a paso)

> Elegiste hacerlo a mano por ahora. Esta es la receta con los **comandos exactos**, para que no dependa
> de la memoria ni se olvide el paso que siempre se olvida (el respaldo). Lo que dice *(consola)* no se
> puede hacer por comando: se hace en la consola de Firebase en un minuto.

**0. Antes de empezar**: el nombre corto del cliente y su `projectId` (global, único, en minúsculas:
`appadm-acme`). Anotá en un papel el RUC, la razón social, la dirección y si es **región exonerada**.

**1. Proyecto y plan** *(consola)*: crear el proyecto → **activar el plan Blaze**. Sin Blaze, pasarse de
la cuota **corta el servicio hasta la medianoche**.
```powershell
firebase projects:list                       # confirmar que estás en la cuenta del negocio
firebase projects:create appadm-acme --display-name "ACME"
```

**2. Base de datos, login y hosting** *(consola los dos primeros)*:
- **Firestore**: crear la base en **modo producción** (región `southamerica-east1` o `us-central1`).
- **Authentication → Email/Password: habilitar**. Y **cerrar el alta libre** (la app crea los usuarios:
  así nadie más puede registrarse solo).
- **Hosting**: se usa el sitio por defecto del proyecto (`appadm-acme.web.app`).
```powershell
firebase apps:create WEB "AppADM" --project appadm-acme
firebase apps:sdkconfig WEB --project appadm-acme      # ← de acá salen las claves de .env.local
```

**3. Las claves del cliente en el repo** (esto es lo que hace que el build sea *de ese* cliente):
```powershell
Copy-Item .env.local "$env:TEMP\env.local.<cliente>.bak"   # guardar el anterior
# pegar en .env.local las 5 claves VITE_FIREBASE_* del cliente + su VITE_SUNAT_API_BASE
```

**4. Reglas, índices y catálogo público**:
```powershell
npx firebase deploy --only firestore:rules,firestore:indexes --project appadm-acme
```
Las reglas son las mismas para todos (`firestore.rules` del repo), con **un solo ajuste por cliente**:
el `esPuente()` de los avisos de Yape lleva el **uid del puente de ESE cliente** (se llena cuando se crea
su cuenta del puente; hasta entonces, los avisos de Yape solo puede crearlos un ADMIN).

**5. El primer ADMIN** (sin esto nadie puede entrar: la pantalla *Usuarios* la usa un ADMIN):
- *(consola)* **Authentication → Users → Add user**: correo y contraseña del dueño.
- *(consola)* **Firestore → Crear documento**: colección `tblUsuarios`, **id = el uid** de esa cuenta,
  con `email`, `nombre`, `rol: "ADMIN"`, `activo: true` y `permisos: {}`. ⚠️ **`permisos` vacío es lo
  correcto**: la app (y las reglas) completan con los permisos por defecto del rol.

**6. Configuración de la empresa** (adentro del app, con ese usuario): razón social, RUC, dirección,
logo, **régimen**, **región exonerada**, **series** y **cajas**, y el **impuesto a las ventas (%)**.
Después: **catálogo** (Excel), **costos** (sin costos el margen y el punto de equilibrio mienten),
ticketera de 72 mm, **SUNAT** (certificado y API: el **emisor es el cliente**) y **Yape** (puente en el
celular del negocio, con **su propia cuenta**).

**7. Publicar y verificar que el build es de ESTE cliente** 🔑 — el paso que evita el accidente del 22/09:
```powershell
npm run build
Select-String -Path dist\assets\*.js -Pattern 'demo-key|demo-appadm'          # no debe devolver NADA
Select-String -Path dist\assets\*.js -Pattern 'appadm-acme' -List             # DEBE devolver el proyecto del cliente
npx firebase deploy --only hosting --project appadm-acme
# y después: el index.html servido tiene que apuntar al mismo index-<hash>.js que dist
```

**8. Respaldo de ese cliente** ✅ **RESUELTO (29/09/2026)**: la herramienta ya es **por cliente**.
En `C:\Users\aaval\appadm-backup\clientes.json` se agrega una línea con su `id`, su `proyecto` y la ruta
de su **llave de servicio** (consola de Firebase → *Cuentas de servicio → Generar nueva clave privada*;
guardala en `llaves\`, **no** en OneDrive). La tarea de Windows **ya los recorre a todos**: no hay que
crear una tarea por cliente. Verificá el alta con:
```powershell
node respaldar.mjs --cliente acme        # debe terminar con «RESPALDO OK» y el conteo de documentos
```
⚠️ Si un cliente falla, **los demás se respaldan igual**, pero el proceso termina con **error** y el
resumen dice cuál falló: un cliente sin respaldo no puede pasar desapercibido.

**9. Capacitación y cierre**: manual **2.22** + resumen **1.9**, y **una venta real completa** de punta
a punta (cobro, comprobante, cierre de caja) antes de dejarlos solos.

**10. Salida ordenada** (si algún día se va): exportar todo, entregarlo y **borrar el proyecto**, dejando
constancia. Va en el contrato (punto 7).

## 6. Lo que hay que sostener después (operación)

- **Actualizaciones**: hoy un despliegue publica para todos; con un proyecto por cliente hay que
  definir **canal y ventana** (los cambios se prueban en un negocio piloto antes de llegar al resto).
- **Soporte**: canal, horario y qué **no** cubre (internet del local, ticketera, celular del puente).
- **Monitoreo**: alertas de infraestructura (no solo las de negocio que ya existen) y una revisión
  semanal de cuotas de Firebase.
- **Costos por cliente**: Firebase (medido: lo primero que se rompe son las **lecturas**, cada
  dispositivo cuenta el catálogo completo), API de consulta DNI/RUC, y **tu tiempo**.

## 7. Legal y comercial (para tu abogado y tu contador)

> 🔑 **Los borradores están escritos**: `docs/legal/` → **`01-terminos-y-condiciones.md`** (el documento
> que se **acepta**: contrato de adhesión en estilo genérico, **sin el nombre del cliente en el cuerpo**,
> con la **Constancia de Aceptación** al final, garantía y límite de responsabilidad incluidos),
> **`02-anexo-tratamiento-datos.md`** (Anexo B: encargado/responsable), **`03-aviso-privacidad-web.md`**
> (lo que publica **cada negocio** en la vidriera y en el manual) y **`04-que-datos-guarda-el-app.md`**
> (uso interno: qué datos hay, dónde, quién los ve — sirve también para responder el cuestionario de
> seguridad de un cliente). Queda `01-bis-contrato-licencia-negociado.md` como **alternativa** para un
> cliente que exija un contrato firmado con su nombre. El **`00-LEEME.md`** dice qué llenar, por qué el
> documento es genérico y las **6 preguntas** que tiene que cerrar el abogado.
> ⚠️ **No es asesoría legal**: son borradores. ✅ **La aceptación dentro del app está implementada**
> (29/09/2026): el ADMIN acepta los Términos en su primer ingreso y queda la constancia en
> `tblAceptaciones` (versión, huella del texto, quién y **fecha/hora del servidor**), verificada en el
> navegador con el arnés `run-terminos.mjs` (18/18). ⚠️ **Al desplegar, las reglas van ANTES o junto con
> el hosting**: la colección nueva la crea la regla, y sin ella la aceptación no se puede registrar.

En el contrato tienen que estar, sí o sí:

1. **Contrato de licencia** (licencia, no venta): alcance, actualizaciones, plazo, propiedad del
   software y de los datos, y **salida** (exportar todo y borrar el proyecto, con constancia).
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
