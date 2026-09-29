# Textos legales — qué hay acá y qué falta

> ⚠️ **Estos documentos NO son asesoría legal.** Los escribí como **borrador** a partir de lo que el
> sistema hace **de verdad** (verificado en el código el 29/09/2026): qué datos guarda, quién puede
> verlos y dónde viven. **Los tiene que revisar tu abogado**, y los puntos marcados con
> `[CONFIRMAR]` los tiene que cerrar él (o tu contador).

## Los archivos

| Archivo | Para qué sirve | A quién se lo das |
|---|---|---|
| `01-terminos-y-condiciones.md` | **El documento que se acepta** (contrato de adhesión, en **estilo genérico**: sin el nombre del cliente en el cuerpo). Incluye la **Constancia de Aceptación** del final, que es lo único que lleva sus datos | Al cliente para que acepte (una carilla) |
| `02-anexo-tratamiento-datos.md` | **Anexo B**: quién manda sobre los datos de sus clientes y qué te comprometés a hacer | Va dentro de los Términos (se acepta y se iniciala) |
| `03-aviso-privacidad-web.md` | El aviso que **publica el negocio cliente** en la vidriera pública (`/pedido`) y en el manual | Lo publica cada negocio (lleva **su** nombre: es inevitable, es él el responsable) |
| `04-que-datos-guarda-el-app.md` | **Uso interno**: el detalle técnico exacto (colecciones, campos, quién puede leer/escribir) | A tu abogado, y para responder **cuestionarios de seguridad** |
| `01-bis-contrato-licencia-negociado.md` | **Alternativa**: el contrato con las dos partes nombradas y firmado | Solo si un cliente grande **exige** un contrato negociado |

## 🔑 Por qué los Términos no llevan el nombre del cliente

Es un **contrato de adhesión**: el mismo texto para todos, y el cliente **acepta** en vez de negociar.
Es lo estándar en software y evita reescribir el documento en cada alta. Pero **dos cosas tienen que
quedar identificadas**, y por eso existe la **Constancia de Aceptación** del final (una carilla, un solo
lugar con el nombre):

1. **Quiénes son las partes**: razón social, RUC, representante, correo y fecha. Sin eso el documento no
   acredita quién aceptó ni contra quién se reclama — y en el Anexo B (datos personales) la ley pide
   saber **quién es el responsable y quién el encargado**.
2. **Las cláusulas que limitan la responsabilidad** (7), la de **salida de datos** (4.3) y el
   **Anexo B**: en un contrato de adhesión tienen que estar **destacadas** y **inicialadas** por el
   cliente. `[CONFIRMAR]` con el abogado, pero esa es la práctica que las hace exigibles.

**✅ La aceptación dentro del app YA ESTÁ (29/09/2026)**: al **ADMIN** —el que representa al negocio— le
aparece la pantalla de Términos en su **primer ingreso**; marca «he leído y acepto» y el sistema registra
en `tblAceptaciones` **quién** (uid, correo, rol), **qué versión**, **la huella del texto**, la **fecha y
hora del servidor** y el navegador. Después no vuelve a aparecer (una vez por usuario y versión), y a los
demás roles **no** les aparece: una venta nunca se bloquea por esto.

- ⚠️ **La constancia no se puede editar ni borrar** (la regla de Firestore lo impone): es una prueba.
- ⚠️ **Si cambiás los Términos, subí `VERSION_TERMINOS`** en `src/lib/terminos.ts` **y** el número en el
  documento legal: con la versión nueva, el ADMIN vuelve a aceptar y **queda la constancia vieja** como
  estaba (que es lo que hay que poder demostrar).
- 📄 El texto que se muestra en el app son las **10 cláusulas** (espejo del documento). Si cambia el
  documento legal, revisá que el texto del app diga lo mismo: hay un test que fija la cláusula 7.
- Los tres documentos que se entregan (Términos, Anexo B y la Constancia) siguen existiendo en papel:
  el app **reemplaza la carilla**, no el documento que el cliente quiera leer con su abogado.

⚠️ **La versión importa**: cada vez que cambies los Términos, subí la versión (`v1.0 — fecha`) y anotá
qué cambió: la Constancia y (si se implementa) el registro del app tienen que decir **qué versión** se
aceptó.

## Lo que hay que llenar antes de usar (buscar `[…]`)

- `[RAZÓN SOCIAL]`, `[RUC]`, `[DOMICILIO]`, `[CORREO]`, `[TELÉFONO]` **del proveedor** (en los Términos y
  en el Anexo B). Eso se llena **una sola vez** y queda.
- **Del cliente**: **nada en el cuerpo** — sus datos van solo en la **Constancia de Aceptación** (una
  carilla por cliente) o, si algún día se implementa, en el registro de aceptación del app.
- Precio, plazo, cantidad de cajas/sucursales y usuarios incluidos (los ponés vos).
- Los días de plazos que elijas: aviso de incidentes, devolución/borrado al terminar, plazo de pago.
- La **versión** de los Términos (`v1.0 — fecha`) en la Constancia.

## Las preguntas para tu abogado o contador `[CONFIRMAR]`

1. **Quién es el titular del banco de datos**: con este modelo, el negocio cliente es el
   **responsable** de los datos de *sus* clientes y vos sos el **encargado**. ¿Hace falta alguna
   **inscripción o comunicación** ante la autoridad de protección de datos, y de quién? (El reglamento
   de la Ley 29733 cambió en 2025.)
2. **Transferencia internacional**: los datos se guardan en los servidores de **Google** (Firebase),
   **fuera del Perú**, y las consultas de DNI/RUC pasan por un servicio en **Amazon (AWS)**. ¿Cómo se
   declara y qué hay que informarle al titular?
3. **Cuánto tiempo se conservan** los datos cuando el cliente se va: hoy el diseño permite **exportar
   todo** y **borrar el proyecto**; ¿qué exige la ley tributaria que conserve el cliente (comprobantes,
   libros) y por cuánto tiempo?
4. **Libro de Reclamaciones**: si la vidriera pública muestra precios y recibe pedidos, ¿corresponde
   **Libro de Reclamaciones virtual**? (Es obligación **del negocio cliente**, no del proveedor, pero
   conviene decirlo en el manual de implementación.)
5. **Los avisos de Yape**: los captura el **celular del propio negocio** (el puente) y guardan el
   **nombre del pagador** y el **N° de operación**. ¿Se informa en algún aviso de privacidad del local?
6. **El emisor electrónico es el cliente** (su RUC, su certificado). Confirmá que el contrato lo deja
   claro y que no hay ninguna obligación de SUNAT que caiga sobre el proveedor por el uso de la
   herramienta.

## Lo que este paquete NO incluye (y quizá necesites)

- **Contrato con tu propio equipo** (confidencialidad y cesión de derechos si algún día suma gente).
- **Política interna de datos** para tu negocio (vos también usás el app): alcanza con el
  `03-aviso-privacidad-web.md` adaptado a tu empresa + confidencialidad con cada trabajador.
- **Contrato de soporte con niveles (SLA)**: si vas a prometer tiempos de respuesta, conviene un anexo
  aparte. En el contrato quedó una promesa **razonable** y no un SLA estricto, a propósito: prometer
  disponibilidad cuando el sistema depende del internet del local, del celular del puente de Yape y de
  Google es regalar un problema.
