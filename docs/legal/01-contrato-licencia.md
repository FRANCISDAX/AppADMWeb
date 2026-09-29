# CONTRATO DE LICENCIA DE USO DE SOFTWARE

> **Borrador para revisión legal.** Los campos entre `[…]` se completan en cada contrato.

Conste por el presente documento el **Contrato de Licencia de Uso de Software** (en adelante, el
«Contrato») que celebran:

**EL LICENCIANTE**: `[RAZÓN SOCIAL DEL PROVEEDOR]`, con RUC `[RUC]`, con domicilio en `[DOMICILIO]`,
representada por `[REPRESENTANTE]`, identificado con DNI `[…]` (en adelante, el «**Licenciante**»).

**EL LICENCIATARIO**: `[RAZÓN SOCIAL DEL CLIENTE]`, con RUC `[…]`, con domicilio en `[…]`, representada
por `[…]`, identificado con DNI `[…]` (en adelante, el «**Licenciatario**»).

Ambas partes acuerdan lo siguiente:

## Primera. Objeto

El Licenciante otorga al Licenciatario una **licencia de uso no exclusiva, intransferible y revocable**
del software **AppADM** (aplicación web y, de corresponder, aplicación móvil), en la modalidad de
**servicio en la nube** (SaaS), para uso interno de su negocio: punto de venta, comprobantes, caja,
inventario, compras, clientes y reportes.

🔑 **Es una licencia, no una venta**: el código fuente, la marca y el software **siguen siendo del
Licenciante**. El Licenciatario **no** adquiere derecho alguno sobre ellos.

## Segunda. Alcance

1. Incluye: `[N]` cajas / puntos de emisión, `[N]` sucursales y hasta `[N]` usuarios, con los módulos
   detallados en el **Anexo A**.
2. Cada usuario tiene **su propia cuenta** (la sesión es única: una persona, un dispositivo a la vez).
3. **No incluye**: el equipo de cómputo, la ticketera, el lector, la conexión a internet, el certificado
   digital ante SUNAT, la cuenta de Yape ni el teléfono que captura sus avisos. Son del Licenciatario.
4. La **base de datos del Licenciatario vive en un proyecto de Firebase** operado por el Licenciante
   dentro de su cuenta. Los **datos son del Licenciatario** (ver Anexo B) y el Licenciante los trata
   como **encargado**, según el **Anexo B**.

## Tercera. Implementación y puesta en marcha

El Licenciante realiza la puesta en marcha: creación del proyecto, configuración de la empresa (razón
social, RUC, series y cajas), carga inicial del catálogo, configuración de SUNAT y de los avisos de
Yape, y una **capacitación** al personal del Licenciatario, con el manual de usuario vigente.

El Licenciatario se obliga a: entregar la información correcta y completa (RUC, series autorizadas,
catálogo y costos), designar a una persona responsable, y **verificar junto con el Licenciante** una
venta completa de punta a punta (cobro, comprobante y cierre de caja) antes de operar en producción.

## Cuarta. Precio y forma de pago

1. Contraprestación: `[MONTO]` `[MENSUAL/ANUAL]`, más `[MONTO]` por la implementación y capacitación.
2. Forma de pago: `[…]`, dentro de los `[N]` días de emitido el comprobante. El precio **no incluye**
   IGV ni otros tributos que correspondan.
3. El retraso devenga interés `[MORATORIO]` y habilita la **suspensión del servicio** previo aviso de
   `[N]` días.
4. 🔑 **El consumo de infraestructura** (Firebase, consultas de DNI/RUC y servicios equivalentes) está
   `[INCLUIDO hasta cierto nivel / FACTURADO APARTE]`. Si el uso del Licenciatario se aparta de forma
   significativa de lo previsto, las partes revisan el precio de buena fe.

## Quinta. Plazo y terminación

1. Plazo: `[N]` meses desde la puesta en marcha, renovable automáticamente por períodos iguales salvo
   aviso en contrario con `[N]` días de anticipación.
2. Terminación: por mutuo acuerdo, por incumplimiento (previa intimación de `[N]` días), por falta de
   pago, o por decisión del Licenciatario con `[N]` días de aviso.
3. **Efectos de la terminación** (cláusula que importa): dentro de los `[N]` días siguientes, el
   Licenciante **exporta toda la información** del Licenciatario en formato abierto (Excel/JSON) y la
   entrega; luego **elimina el proyecto y sus datos**, dejando **constancia escrita**. El
   Licenciatario debe descargar y conservar su información.
   `[CONFIRMAR]` con el abogado/contador el plazo y la forma de esa constancia.

## Sexta. Obligaciones del Licenciante

1. Prestar el servicio con la diligencia de un buen empresario y con las medidas de seguridad del
   **Anexo B**.
2. **Respaldar la información** del Licenciatario con periodicidad **diaria** y conservar las copias
   por `[30]` días.
3. Dar **soporte** por `[CANAL]` en el horario `[…]`, con los tiempos de respuesta del **Anexo C**.
4. Informar con `[N]` días de anticipación los cambios que afecten el uso normal del servicio
   (actualizaciones de fondo), y de inmediato cualquier **incidente de seguridad** que afecte datos del
   Licenciatario, conforme al **Anexo B**.
5. Mantener la **confidencialidad** de la información del Licenciatario, incluso después de terminado
   el Contrato.

⚠️ **Lo que el Licenciante NO promete**: disponibilidad ininterrumpida. El servicio depende de Google
(Firebase), de SUNAT y de sus servicios, del **internet del local**, de la energía eléctrica y, en el
caso de los avisos de pago de Yape, del **celular que los captura** y que es provisto y mantenido por
el Licenciatario.

## Séptima. Obligaciones del Licenciatario

1. Usar el software conforme a la licencia y al manual; **no** copiarlo, modificarlo, descompilarlo,
   revenderlo, sublicenciarlo ni cederlo, ni prestarlo a terceros, ni permitir el acceso a personas
   ajenas a su negocio.
2. Usar **cuentas nominales** (una por persona) y mantener la confidencialidad de sus claves.
3. Contar con internet, energía, equipos y ticketera en condiciones; y con el **certificado digital** y
   las **series autorizadas** ante SUNAT.
4. 🔑 **Responder por la información que carga y por su cumplimiento tributario**: la emisión, el envío
   y la veracidad de los comprobantes electrónicos son **responsabilidad exclusiva del Licenciatario**,
   que es el **emisor electrónico**. El Licenciante provee la herramienta, no el asesoramiento
   tributario.
5. **Informar** al Licenciante, sin demora, cualquier incidente del que tome conocimiento (acceso no
   autorizado, uso indebido de una cuenta, pérdida de un dispositivo).

## Octava. Garantía y límite de responsabilidad

1. El software se entrega **«tal cual»** y **«según disponibilidad»**. El Licenciante **no garantiza
   resultados comerciales** ni que el uso del software incremente las ventas o la utilidad del
   Licenciatario.
2. 🔑 **Los reportes, márgenes, utilidad y punto de equilibrio son referenciales**: dependen de los
   **costos y datos que carga el Licenciatario** y **no reemplazan** la contabilidad ni el
   asesoramiento de un contador. Las decisiones de negocio y tributarias son del Licenciatario.
3. **No hay responsabilidad** por lucro cesante, pérdida de oportunidad, daño indirecto,
   consecuencial o punitivo, ni por la pérdida de información que el Licenciatario no haya descargado
   con las herramientas del propio sistema (exportaciones y respaldos).
4. **Tope de responsabilidad**: la responsabilidad total del Licenciante, por cualquier concepto, se
   limita a **`[las contraprestaciones pagadas por el Licenciatario en los últimos 12 meses / el monto
   que acuerden]`**.
5. **Fallas de terceros**: el Licenciante no responde por interrupciones o errores de Google, SUNAT,
   bancos, Yape/Plin, proveedores de internet o de energía, ni por hechos de fuerza mayor.
   `[CONFIRMAR]` que este tope es válido y suficiente bajo la ley peruana.

## Novena. Propiedad intelectual

El software, su código fuente, su arquitectura, su documentación, su nombre y su marca pertenecen al
**Licenciante**. El Licenciatario **no** adquiere derecho alguno sobre ellos; la licencia se limita al
**uso** durante la vigencia del Contrato. **Los datos** (ventas, clientes, catálogo, movimientos)
pertenecen al **Licenciatario**. `[CONFIRMAR]` la redacción con el abogado.

## Décima. Protección de datos personales

El tratamiento de datos personales de los clientes del Licenciatario se rige por el **Anexo B**, que
forma parte de este Contrato. **El Licenciatario es el responsable** de esos datos y **el Licenciante su
encargado**, y ambas partes cumplen la Ley 29733 y su reglamento `[CONFIRMAR]`.

## Décima primera. Confidencialidad y no captación

Ambas partes mantienen en reserva la información comercial, técnica y de negocio a la que accedan por
el Contrato, durante su vigencia y por `[N]` años después. Ninguna parte captará al personal de la otra
durante la vigencia y el año siguiente. `[CONFIRMAR]` si quieren incluir la no captación de clientes.

## Décima segunda. Cesión, modificaciones y comunicaciones

Ninguna parte cede el Contrato sin el consentimiento escrito de la otra. Las modificaciones se hacen
por escrito (carta o correo electrónico con acuse). Domicilios y correos para notificaciones: los
indicados en la carátula. El uso del correo electrónico vale como comunicación válida.

## Décima tercera. Ley aplicable y solución de controversias

Este Contrato se rige por las **leyes de la República del Perú**. Las partes intentan resolver
cualquier controversia de buena fe; de no lograrlo en `[…]` días, se someten a
`[los jueces del domicilio del Licenciante / arbitraje]`. `[CONFIRMAR]` con el abogado.

Firmado en `[LUGAR]`, el `[FECHA]`.

| | Licenciante | Licenciatario |
|---|---|---|
| Nombre | | |
| DNI / RUC | | |
| Firma | | |

---

## Anexo A — Descripción del servicio

Módulos incluidos: punto de venta (con lector de código de barras y comandos de voz), notas de venta,
boletas y facturas electrónicas, notas de crédito y débito, boleta consolidada, notas de venta
consolidadas, caja y turnos (arqueo, cierre con firma y PDF), clientes y créditos, inventario y kardex
**valorizado a costo promedio ponderado**, compras y proveedores, egresos/gastos, reportes (ventas por
fecha, por turno, por empleado, por categoría, SIRE ventas y compras), dashboards (gerencial y de
operaciones), pedidos del vínculo público (`/pedido`) con QR, avisos de pago de Yape, alertas
proactivas, usuarios y permisos por rol, y configuración de empresa.

## Anexo B — Tratamiento de datos personales

`02-anexo-tratamiento-datos.md` (se firma como parte del Contrato).

## Anexo C — Soporte

Canal `[…]`, horario `[…]`. Tiempos de respuesta objetivo: crítico `[…]`, medio `[…]`, consulta `[…]`.
**No incluye** soporte de internet del local, de la ticketera, del equipo del Licenciatario ni del
teléfono del puente de Yape (fuera del software).

## Anexo D — Precio

`[Detalle del plan: implementación, mensualidad, cajas y usuarios incluidos, forma de pago]`.
