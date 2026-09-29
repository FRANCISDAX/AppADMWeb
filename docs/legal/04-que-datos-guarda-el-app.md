# Qué datos guarda el app, dónde y quién los puede ver

> **USO INTERNO** (para tu abogado y para responder los cuestionarios de seguridad de un cliente).
> Está escrito sobre el sistema **real**, verificado en el código el **29/09/2026** — no sobre lo que
> uno supone que hace. ⚠️ La sección **7. Estado actual y pendientes** no se comparte con el cliente.

## 1. Dónde vive la información

| Qué | Dónde |
|---|---|
| Base de datos (ventas, productos, clientes, caja, etc.) | **Firestore de Firebase**, en un **proyecto por cliente**, dentro de la cuenta de Google del proveedor |
| Cuentas de usuario y contraseñas | **Firebase Authentication** (las contraseñas las guarda Google cifradas; ni el proveedor las ve) |
| Aplicación web (el sistema que se abre en la PC o el celular) | **Firebase Hosting** (Google) |
| Respaldos | Copias diarias exportadas por el proveedor a un equipo del proveedor (`C:\Users\aaval\appadm-backup`), 30 días de retención |
| Avisos de pago de Yape | Se **capturan en el celular del propio negocio** (la app puente) y se escriben en la misma base del cliente |
| Consultas de DNI/RUC | Servicio en la nube (**Amazon AWS**) que opera el proveedor |

**Cifrado**: Google cifra los datos **en reposo** y en **tránsito** (TLS) por defecto; el sistema
obligatoriamente usa `https`. El proveedor no maneja contraseñas: se guardan cifradas por Google.

## 2. Qué se guarda, colección por colección

Todas las colecciones empiezan con `tbl` (una excepción: `Proveedor`, que usa la app móvil).

| Colección | Qué contiene (resumido) |
|---|---|
| `tblUsuarios` | Personal del negocio: nombre, correo, **rol y permisos**, caja asignada, dispositivo de la sesión activa |
| `tblConfiguracion` | Datos de la empresa: razón social, **RUC**, dirección, logo, series, parámetros de SUNAT y de Yape |
| `tblProductos` | Catálogo: nombre, precio, **costo**, stock, categoría, unidad y (si se cargan) fotos |
| `tblDocumentos` | **Los comprobantes**: notas de venta, boletas, facturas, notas de crédito/débito, pedidos; con **nombre y DNI/RUC del cliente**, importes y el bloque de SUNAT |
| `tblMovimientos` | Kardex: cada entrada y salida de stock, con su costo y valor |
| `tblClientes` | Clientes: nombre, **DNI/RUC**, dirección, teléfono, correo, saldo de crédito |
| `tblProveedores` / `Proveedor` | Proveedores: nombre, RUC, contacto |
| `tblTurnos` / `tblCierresCaja` | Caja: turnos, arqueos, diferencias, quién cerró y las firmas del cierre |
| `tblEgresos` | Gastos del negocio (con proveedor y comprobante) |
| `tblCompras`-equivalentes (`tblMovimientos` + metadatos) | Compras de mercadería, con el documento del proveedor y si la factura traía IGV |
| `tblPagosYape` | **Avisos de pago**: nombre del pagador, N° de operación, código de seguridad, monto y hora; quién lo usó y en qué comprobante |
| `tblPuenteYape` | Latido del celular que captura los avisos (señal de vida) |
| `tblAuditLog` | **Registro de auditoría**: quién hizo qué y cuándo (anulaciones, cierres, cambios sensibles) |
| `tblAlertasVistas` | Qué alertas pospuso cada usuario |
| `tblPublico` | El **catálogo publicado** del link de pedidos (nombre, precio y stock; **sin fotos ni datos internos**) |
| `tblDisplaySessions` | Pantallas de cliente del local |
| `tblCajas`, `tblCategorias`, `tblContadores`, `tblPromocionesVolumen`, `tblHistorialPrecios`, `tblErrores`, `tblVoiceIntents` | Configuración y apoyo: cajas y series, categorías, correlativos, promociones, historial de precios, errores de la app e intenciones de voz |

**Qué NO guarda el app**: datos bancarios ni de tarjetas, contraseñas de Yape o del banco, datos de
salud, biometría ni datos de menores.

## 3. Quién puede ver y hacer qué (aplicado en el servidor)

Desde el **29/09/2026** las reglas de la base se aplican **en el servidor** (no solo en la pantalla):
si alguien usa una herramienta externa, igual queda limitado por su rol.

| Rol | Puede ver | Puede hacer |
|---|---|---|
| **ADMIN** | Todo el negocio | Todo, incluida la configuración, los usuarios y las rectificaciones |
| **GERENTE** | Todo el negocio | Casi todo: **no** gestiona usuarios ni configuración, no elimina productos ni rectifica turnos |
| **CAJERO** | Catálogo, ventas, caja, clientes | Cobra, abre/cierra su turno, ajusta stock, carga gastos; **no** ve costos si no tiene el permiso, no configura |
| **VENDEDOR** | Catálogo, clientes | Arma ventas y las manda a caja; no cobra ni cierra caja |
| **ALMACEN** | Catálogo, kardex, compras, proveedores, costos | Inventario, compras y ajustes; **sin** ventas, caja ni reportes financieros |
| **PERSONALIZADO** | Lo que su ficha permita | Lo que su ficha permita (permiso por permiso) |

Reglas que se cumplen siempre:

- 🔑 **La ficha de un usuario solo la puede modificar un ADMIN**: nadie puede darse permisos ni
  cambiarse el rol. Cada persona puede tocar de su ficha **solo** la sesión de su dispositivo.
- **Los comprobantes, turnos y cierres no se borran**: se anulan, y queda el rastro con el motivo.
- 🔑 **Los avisos de pago de Yape solo los crea el dispositivo del negocio**: ningún empleado puede
  inventar un aviso de pago desde la web o el celular (la única excepción es el *aviso de prueba*, que
  solo puede crear un ADMIN).
- **Una cuenta sin ficha habilitada no ve nada.**
- 🔑 **Lo único público** (sin usuario ni contraseña) es: el **catálogo del link de pedidos** (nombre,
  precio y stock — sin fotos ni datos internos) y las **pantallas de cliente**. **Nada más**: las
  ventas, los clientes, los costos y los avisos de Yape están cerrados.
- **Una colección nueva nace cerrada** (si el sistema crece, se le agrega su regla a propósito).

## 4. Trazabilidad

El sistema registra en `tblAuditLog` quién hizo las operaciones sensibles: anular una venta, cerrar un
turno, cambiar precios o permisos, eliminar un pedido, mover dinero entre cajas, rectificar un turno.
Cada anulación y cada pedido eliminado guardan **el motivo** y **quién** lo hizo.

## 5. Respaldos y recuperación

- **Frecuencia**: **diaria**, automática (tarea programada de Windows en el equipo del proveedor).
- **Contenido**: **todas** las colecciones, más las **cuentas de usuario** (con las contraseñas
  cifradas de Google) y un manifiesto con el conteo y la **huella digital (sha256)** de cada archivo.
- **Retención**: **30 días**.
- **Verificación**: el proceso tiene una **prueba de ida y vuelta** (tomar documentos reales,
  exportarlos, volverlos a armar y compararlos) ⇒ **92 documentos en 25 colecciones, 0 diferencias**
  (medido el 29/09/2026). Y una **restauración de prueba** completa se hace antes de vender.
- **Cómo se recupera**: `restaurar.mjs` (sin la palabra `--confirmar` **no escribe nada**: primero
  muestra qué haría).

## 6. Preguntas típicas de un cliente y su respuesta corta

| Pregunta | Respuesta |
|---|---|
| ¿Dónde están mis datos? | En un proyecto de Google (Firebase) **exclusivo de tu negocio**, con cifrado en reposo y en tránsito. |
| ¿Puedo tener acceso? | Sí: se te puede dar acceso a **tu** proyecto. |
| ¿Quién puede verlos? | Tu personal, según su rol, y el proveedor (acceso técnico, con contrato de confidencialidad y registro de accesos). |
| ¿Hay respaldos? | Sí, **diarios**, con 30 días de retención y pruebas de restauración documentadas. |
| ¿Puedo llevarme la información? | Sí: exportaciones en Excel desde el propio sistema, y una **copia completa** al terminar el contrato. |
| ¿Qué pasa si me voy? | Se exporta todo y **se borra** el proyecto, con constancia. |
| ¿Los empleados pueden ver los costos? | Solo si su rol tiene el permiso **«Ver costos»**, y la restricción se aplica en el servidor. |
| ¿Pueden inventar un pago de Yape? | No: los avisos los crea **el teléfono del negocio**. |
| ¿Se pueden borrar ventas? | No: se anulan, con motivo y autor, y queda el registro. |

## 7. Estado actual y pendientes (⚠️ **NO compartir**)

Lo que **falta** para que la respuesta de arriba sea completa (ordenado por riesgo):

1. 🔴 **App Check está apagado** y el **alta libre de cuentas** sigue abierta en Firebase Auth. Con un
   proyecto por cliente, esto hay que cerrarlo **en cada proyecto nuevo** (paso fijo del alta): mientras
   esté abierto, cualquiera con la clave pública puede **crearse una cuenta** (no verá nada, porque sin
   ficha no se lee nada, pero es superficie de ataque y ruido).
2. 🔴 **Activar la verificación en dos pasos (2FA) en la cuenta de Google** que tiene los proyectos:
   hoy esa cuenta es **la llave maestra de los datos de todos los clientes**. Es lo más barato y lo más
   importante de toda la lista.
3. ⚠️ **Las llaves de servicio (service accounts) están en OneDrive** y hay más de una copia: hay que
   sacarlas de ahí, rotarlas y dejarlas en un gestor de secretos. Son la llave de la base.
4. ⚠️ **Cuenta de Google del negocio**: que los proyectos **no** cuelguen de la cuenta personal.
5. ⚠️ **El respaldo hoy cubre un solo proyecto**: hay que parametrizarlo **antes del segundo cliente**
   (si no, ese cliente queda sin respaldo).
6. ⏳ **Retención de la auditoría** (`tblAuditLog`) y **plan de incidentes** (quién avisa, a quién y en
   cuánto tiempo) sin definir por escrito.
7. ⏳ **Restauración de prueba real** en un proyecto de prueba antes de vender (hoy está probada la
   fidelidad de los datos, no el procedimiento completo).
8. ⏳ **Respaldos administrados de Firestore** (en la nube) cuando el negocio pase al plan **Blaze**:
   hoy el respaldo depende de que el equipo del proveedor esté encendido.
