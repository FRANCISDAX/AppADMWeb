# Textos legales — qué hay acá y qué falta

> ⚠️ **Estos documentos NO son asesoría legal.** Los escribí como **borrador** a partir de lo que el
> sistema hace **de verdad** (verificado en el código el 29/09/2026): qué datos guarda, quién puede
> verlos y dónde viven. **Los tiene que revisar tu abogado**, y los puntos marcados con
> `[CONFIRMAR]` los tiene que cerrar él (o tu contador).

## Los archivos

| Archivo | Para qué sirve | A quién se lo das |
|---|---|---|
| `01-contrato-licencia.md` | El contrato con **cada empresa** que te compra el app | Al cliente, firmado |
| `02-anexo-tratamiento-datos.md` | **Anexo del contrato**: quién manda sobre los datos de sus clientes y qué te comprometés a hacer | Al cliente, firmado **junto** con el contrato |
| `03-aviso-privacidad-web.md` | El aviso que va **en la vidriera pública** (`/pedido`) y en el app | Se publica en el app |
| `04-que-datos-guarda-el-app.md` | **Uso interno**: el detalle técnico exacto (colecciones, campos, quién puede leer/escribir) | A tu abogado, y para responder **cuestionarios de seguridad** de un cliente grande |

## Lo que hay que llenar antes de usar (buscar `[…]`)

- `[RAZÓN SOCIAL DEL PROVEEDOR]`, `[RUC DEL PROVEEDOR]`, `[DOMICILIO]`, `[CORREO]`, `[TELÉFONO]`
- Lo mismo del **cliente** en cada contrato (van como campos a completar en la carátula).
- Precio, plazo, cantidad de cajas/sucursales y usuarios incluidos (los ponés vos).
- Los días de plazos que elijas: aviso de incidentes, devolución/borrado al terminar, plazo de pago.

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
