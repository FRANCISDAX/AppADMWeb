# ANEXO B — TRATAMIENTO DE DATOS PERSONALES

> **Borrador para revisión legal.** Es el **Anexo B de los Términos y Condiciones** y forma parte de
> ellos. Está escrito en el mismo estilo **sin nombres en el cuerpo**: las partes se identifican **una
> sola vez** en la **Constancia de Aceptación**. Los `[CONFIRMAR]` los cierra el abogado.

Entre el **Proveedor** (el «**Encargado**») y el **Cliente** (el «**Responsable**»), ambos identificados
en la Constancia de Aceptación de los Términos y Condiciones de Uso de AppADM.

## 1. Roles

1. El **Responsable** es el **titular del banco de datos** y decide sobre los datos personales de **sus
   clientes, proveedores y personal** que se registran en el sistema.
2. El **Encargado** trata esos datos **únicamente** para prestar el servicio del Contrato, **siguiendo
   las instrucciones del Responsable** y **sin** usarlos para fines propios.
3. `[CONFIRMAR]` con el abogado si corresponde alguna **inscripción o comunicación** ante la autoridad
   de protección de datos personales, y de quién es la obligación.

## 2. Datos que se tratan

| Categoría | Datos | Dónde |
|---|---|---|
| Identificación de clientes y proveedores | Nombre o razón social, **DNI/RUC**, dirección, teléfono, correo | Base del Responsable, en la nube del Encargado |
| Ventas y cobros | Comprobantes emitidos, importes, forma de pago, saldos de crédito | Ídem |
| Personal del Responsable | Nombre, correo, rol y permisos, caja asignada, movimientos que registra | Ídem |
| Avisos de pago (Yape) | **Nombre del pagador**, N° de operación, código de seguridad, monto y hora | Ídem; los captura el **teléfono del propio Responsable** |
| Registro de actividad | Quién hizo cada operación sensible (anulaciones, cierres, cambios de precio) | Ídem |

**No se tratan** datos sensibles en el sentido de la ley (salud, origen étnico, creencias, etc.), ni
datos de menores, ni datos biométricos. `[CONFIRMAR]` si el Responsable carga alguno de esos datos por
su cuenta: en ese caso debe informarlo y asumir la responsabilidad.

## 3. Finalidad

Exclusivamente: registrar las ventas y comprobantes, llevar caja y turnos, controlar inventario y
compras, emitir y enviar comprobantes electrónicos, gestionar clientes y créditos, y producir los
reportes del propio Responsable. **Ninguna otra**: no se usan para publicidad, perfilado, venta ni
cesión a terceros.

## 4. Subencargados y transferencia internacional

El Encargado se apoya en estos proveedores, que tratan los datos por su cuenta y orden:

| Proveedor | Para qué | Dónde están los datos |
|---|---|---|
| **Google (Firebase)** | Base de datos, autenticación, hosting y respaldos | Servidores de Google **fuera del Perú** |
| **Amazon (AWS)** | Servicio de consulta de DNI/RUC que usa el sistema | **Fuera del Perú** |
| Otros | Se avisan con `[N]` días de anticipación antes de incorporarlos | — |

⚠️ **[CONFIRMAR] transferencia internacional**: los datos se alojan fuera del Perú. El abogado debe
definir cómo se informa y si corresponde alguna declaración bajo la Ley 29733 y su reglamento.

## 5. Seguridad

El Encargado se obliga a:

1. Mantener **acceso por roles**: cada usuario ve y modifica solo lo que su rol permite, y eso está
   aplicado **en el servidor**, no solo en la pantalla.
2. Exigir **cuentas nominales** (una por persona) y sesión única.
3. **Respaldar la información a diario**, con copias conservadas `[30]` días y **pruebas de
   restauración** documentadas.
4. Llevar un **registro de auditoría** de las operaciones sensibles (quién anuló, quién cerró caja,
   quién cambió precios o permisos).
5. Guardar las **credenciales de administración** de forma protegida y **rotarlas** ante cualquier
   sospecha.
6. **Confidencialidad del personal**: toda persona con acceso firma un compromiso de confidencialidad.

🔑 **Acceso del Encargado (transparencia)**: el Encargado **puede acceder técnicamente** a la
información alojada en el proyecto (es su cuenta de infraestructura). Se obliga a hacerlo **solo** para
prestar el servicio, dar soporte o atender una obligación legal, y a **registrar** los accesos
administrativos que realice.

## 6. Incidentes de seguridad

Ante un incidente que afecte datos personales del Responsable (acceso no autorizado, pérdida o
alteración), el Encargado **avisa al Responsable dentro de las `[48]` horas** de detectarlo, indicando
qué pasó, qué datos se vieron afectados, qué hizo y qué recomienda. El Responsable decide qué informa a
los titulares y a la autoridad, y el Encargado lo asiste. `[CONFIRMAR]` el plazo.

## 7. Derechos de los titulares

Los pedidos de **acceso, rectificación, cancelación u oposición** los atiende el **Responsable**, que
tiene en el sistema las herramientas para ver, corregir y dar de baja la información. El Encargado
**asiste** al Responsable y no responde directamente ante los titulares de los clientes del Responsable.

## 8. Devolución y eliminación al terminar

1. Dentro de los `[N]` días de terminado el Contrato, el Encargado **exporta toda la información** en
   formato abierto (Excel y JSON) y la entrega al Responsable.
2. Luego **elimina** el proyecto y sus datos y copias de respaldo, y deja **constancia escrita** de la
   eliminación. `[CONFIRMAR]` el plazo y qué exige la ley tributaria que conserve el Responsable.
3. Mientras el Contrato esté vigente, los datos se conservan **por cuenta y orden del Responsable**;
   los plazos de conservación legal (comprobantes, libros) son del Responsable.

## 9. Obligaciones del Responsable

1. **Informar a sus titulares** (clientes, proveedores, personal) que sus datos se registran en un
   sistema, con la finalidad correspondiente, y publicar su propio aviso de privacidad.
2. Cargar **solo los datos necesarios** para su operación.
3. Mantener la confidencialidad de sus claves y comunicar de inmediato el uso indebido de una cuenta.
4. Responder por el **uso que su personal** haga de la información.

## 10. Vigencia

Este Anexo rige mientras se traten datos por cuenta del Responsable y sobrevive a la terminación del
Contrato en lo que respecta a **confidencialidad, devolución y eliminación**.

**Aceptado** por el Cliente junto con los Términos y Condiciones, en la **Constancia de Aceptación**
(con la **inicial** correspondiente a este Anexo).

*Encargado: `[RAZÓN SOCIAL DEL PROVEEDOR]`, RUC `[RUC]` — `[CORREO]`.*
