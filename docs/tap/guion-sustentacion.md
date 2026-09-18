# Guion de sustentación — Trabajo de Aplicación Profesional

**Sistema de punto de venta, inventario y facturación electrónica**
Acompaña a las diapositivas `docs/tap/06-sustentacion.html` (22 diapositivas + 1 de respaldo).

> **Cómo usar este guion.** No es un texto para leer: son ideas guía. En cada diapositiva está lo que hay que
> **decir con tus palabras**, la **transición** hacia la siguiente y aquello que el jurado **debe escuchar**
> (aunque después olvide el resto). Si te trabás, mirá el título de la diapositiva: cada título ya es una
> afirmación que se puede explicar en dos frases.

**Regla de oro de todo el guion:** no inventar cifras de operación del negocio (ventas, mejoras, porcentajes).
Todo lo que se afirma sale del repositorio y de la documentación del proyecto. Si no se midió, se dice que no se midió.

---

## 1. Duración y reparto del tiempo

Exposición de **20 minutos** (más las preguntas del jurado). Los minutos de la segunda columna son acumulados: si en
la columna "acumulado" te pasaste en más de un minuto, saltá la diapositiva marcada como recortable.

| Bloque | Diapositivas | Minutos | Acumulado | Qué tiene que quedar claro |
|---|---|---|---|---|
| A · Apertura y problema | 1 a 3 | 2:40 | 0:00 – 2:40 | Quién sos, qué hiciste y qué problema resolvía el sistema |
| B · Objetivos, justificación y alcance | 4 a 6 | 2:00 | 2:40 – 4:40 | El objetivo general se cumplió y los límites están declarados de entrada |
| C · Metodología y arquitectura | 7 a 10 | 4:00 | 4:40 – 8:40 | Cómo se trabajó (iteraciones con el usuario) y cómo está construido |
| D · Funcionamiento | 11 a 14 | 4:00 | 8:40 – 12:40 | Módulos, flujo de venta, emisión a la SUNAT y control de caja |
| E · Requisitos, pruebas e incidencias | 15 a 17 | 4:00 | 12:40 – 16:40 | Cómo se verificó y qué defectos reales se encontraron y corrigieron |
| F · Resultados, demostración y cierre | 18 a 22 | 3:20 | 16:40 – 20:00 | El sistema está en operación, conclusiones y recomendaciones |

**La demostración en vivo (diapositiva 19) dura 2:40** y es la parte que más impresiona: si vas mal de tiempo, es lo
último que se recorta, no lo primero. Lo que sí se puede recortar: diapositiva 11 (módulos, se resume en una frase),
diapositiva 15 (requisitos, se remite al Anexo 3) y diapositiva 21 (recomendaciones, se resume en las dos principales).

**Diapositivas de respaldo.** La última diapositiva (sin número) reúne las medidas del repositorio, las tecnologías y
dónde vive cada regla crítica. No se expone: se salta solo cuando el jurado pregunta un dato exacto.

**Los tres momentos que hay que clavar** (si el jurado solo recuerda tres cosas):
1. **El comprobante se genera recién al cobrar**, con serie y correlativo asignados en ese momento, en dos espacios de
   numeración separados: ninguna venta sin cobrar quema un número fiscal ni deja huecos.
2. **El comprobante declara lo que se cobra**, no el precio de lista: el descuento se reparte entre las líneas antes
   de despejar el IGV, y el IGV solo existe en la afectación gravada.
3. **El sistema está en operación real** y los defectos que más importaban (dinero, numeración, declaración fiscal)
   aparecieron usándolo en el mostrador, no en el desarrollo: eso es la validación del trabajo.

---

## 2. Qué decir en cada diapositiva

### D1 · Portada (0:00 – 0:30)

- "Buenos días. Soy [nombre], alumno de [carrera]. El trabajo que sustento es el **sistema de punto de venta,
  inventario y facturación electrónica** que desarrollé e implanté en un negocio de venta al detalle."
- Decir en una frase qué es: "una aplicación web y un servicio de facturación electrónica propio que emite
  comprobantes válidos ante la SUNAT".
- **Énfasis:** "no es un prototipo: el sistema está en operación en el negocio".

**Transición:** "Empiezo por el problema, porque de ahí salió cada decisión técnica del sistema."

### D2 · Agenda (0:30 – 0:50)

- No leer la agenda. Una frase: "Voy a mostrar **el problema**, **cómo está construido**, **cómo se verificó** y
  **qué quedó en operación**; al final hay una demostración en vivo de tres minutos."
- **Énfasis:** avisar que hay demostración crea expectativa y ordena la atención.

**Transición:** "El problema es concreto: vender, controlar el stock y cumplir con la SUNAT sin un sistema único."

### D3 · Problema (0:50 – 2:40)

- Describir la situación: venta e inventario separados, cierre de caja reconstruido a mano, comprobante emitido por
  fuera del flujo de venta.
- Contar **dos consecuencias reales** que aparecieron en este trabajo (son verificables): precios cobrados distintos
  de los declarados en el comprobante, y pedidos que el cajero no lograba recuperar.
- El riesgo tributario, con calma y sin dramatizar: "cada comprobante lleva serie y correlativo; numerar fuera del
  sistema abre la puerta a **números repetidos u omitidos**, y eso es una observación de la administración tributaria".
- **Énfasis:** "la necesidad no era una app más, era que la venta, el stock, la caja y el comprobante sean **el mismo
  hecho registrado una sola vez**".

**Transición:** "Con eso claro, el objetivo del trabajo quedó formulado así…"

### D4 · Objetivos (2:40 – 3:40)

- Leer el objetivo general **una sola vez** y despacio. Los específicos: recorrerlos en 20 segundos, agrupando:
  "analizar los procesos, diseñar la arquitectura, implementar los módulos, verificar la calidad y poner en operación".
- **Énfasis:** "el objetivo general está cumplido: el sistema está funcionando en el negocio".
- No prometer nada que no esté en el alcance: si el jurado pregunta por la app móvil, se aclara que es trabajo
  relacionado y no forma parte de este informe.

**Transición:** "¿Por qué se justifica el trabajo? Por cuatro razones."

### D5 · Justificación (3:40 – 4:20)

- Cuatro razones en cuatro frases: operativa, tributaria, de ingeniería y de validación real.
- **Énfasis (decirlo textual):** "no declaro mejoras porcentuales ni cifras de venta del negocio: este trabajo no
  administra esos datos. Lo que afirmo se puede verificar en el repositorio del proyecto."
- Ese gesto de honestidad, dicho temprano, desarma la pregunta incómoda al final.

**Transición:** "Y así como digo qué está cubierto, digo qué no."

### D6 · Alcance y limitaciones (4:20 – 4:40)

- Dar el alcance en 15 segundos y **dedicarle el resto a las limitaciones** (es lo que da credibilidad).
- Decir las tres de la diapositiva: la app móvil queda fuera del alcance; el control de acceso fino por rol en la base
  de datos está pendiente; la conciliación por billetera es opcional y el conteo ciego está apagado por defecto.
- **Énfasis:** "prefiero que estas limitaciones las escuche ahora y no en la ronda de preguntas".

**Transición:** "Ahora sí, cómo se trabajó."

### D7 · Metodología (4:40 – 5:40)

- Explicar el ciclo de cinco pasos **sin llamarlo "cascada" ni "scrum"**: es un **enfoque iterativo con validación del
  usuario en la operación**, porque no había un equipo ni un tablero: había un negocio que tenía que seguir vendiendo.
- Contar cómo llegaban los requerimientos: el usuario probaba el sistema en el mostrador y reportaba el caso concreto
  ("el descuento de la promoción no sale en el PDF", "generé un pedido y el cajero no lo ve").
- Evidencia del proceso: 70 confirmaciones de cambios entre el 10 y el 17 de septiembre de 2026, once bloques de
  historial de sesiones y siete incidencias corregidas y documentadas.
- **Énfasis:** "cada defecto corregido quedó documentado con su causa y su evidencia: el historial del proyecto es,
  en sí mismo, parte del método".

**Transición:** "Veamos cómo quedó construido."

### D8 · Arquitectura general (5:40 – 6:40)

- Tres componentes y una base: aplicación web, servicio de facturación electrónica y Firestore como base compartida.
- Explicar **la decisión clave** con la razón, no solo el hecho: "el certificado digital **no puede estar en el
  navegador**: la firma ocurre en el servicio, dentro de la red del negocio. El navegador nunca recibe el certificado
  ni las credenciales fiscales, y la lógica tributaria se puede actualizar sin volver a publicar la aplicación web".
- Mencionar la app móvil **una frase** y dejarla: es trabajo relacionado, fuera del alcance del informe.

**Transición:** "Dentro de la aplicación web, la organización es por capas."

### D9 · Arquitectura por capas (6:40 – 7:40)

- Recorrer las tres capas de arriba hacia abajo: presentación (27 páginas, carga diferida, navegación por estado sin
  enrutador), servicios (22 módulos, única capa que habla con la base, con transacciones y lotes) y reglas del negocio
  (29 módulos **puros**, sin Firebase ni React, con 195 pruebas automatizadas).
- Contar el ejemplo que más convence, porque es un defecto real: "la fórmula del efectivo esperado de un turno estaba
  escrita a mano **en seis lugares**, y dos de ellos calculaban distinto: el cajero podía estar comparando contra un
  número diferente al que el sistema guardaba. Hoy es **una sola función**, usada por todas las pantallas".
- **Énfasis:** "una regla, una implementación. Si lo que se ve y lo que se permite salen del mismo cálculo, no pueden
  contradecirse".

**Transición:** "Estas capas trabajan sobre este modelo de datos."

### D10 · Modelo de datos (7:40 – 8:40)

- No leer la tabla: recorrer tres decisiones.
  1. **Dos espacios de numeración separados** (`tblContadores`): las notas de venta y los comprobantes con validez
     fiscal no comparten contador. Es la decisión que evita repetir un número.
  2. **El pedido vive en la misma colección de documentos, pero como tipo `PENDIENTE`**: sin serie, sin número, sin
     forma de pago y fuera de todos los reportes fiscales.
  3. **El precio del producto es precio final al público** (con IGV incluido), y **la afectación tributaria es del
     producto**, no de la venta.
- Mencionar la auditoría: cada acción relevante queda registrada con su responsable, y los errores de la aplicación se
  registran en una colección propia para revisarlos desde el módulo de auditoría.
- **Énfasis:** "los índices que exigen las consultas se declaran en un archivo versionado: una consulta sin su índice
  falla en la operación, no en el desarrollo. Eso ya pasó una vez y quedó documentado".

**Transición:** "Con este modelo, veamos qué hace el sistema."

### D11 · Módulos (8:40 – 9:10, recortable)

- Una frase por bloque, sin entrar en pantallas: punto de venta, pedidos y caja, inventario, control de caja, fiscal,
  clientes y proveedores, reportes y administración.
- **Énfasis:** "son ocho bloques, pero el que sostiene el valor del sistema es el fiscal: es el que hace que el
  negocio pueda vender con comprobante válido".

**Transición:** "Y el corazón operativo es el flujo de venta."

### D12 · Flujo de venta y pedidos (9:10 – 10:20)

- Contar el recorrido completo como una historia: el vendedor arma la venta → la envía a caja → **el pedido nace con un
  código propio `PED-000123`, sin serie, sin correlativo y sin forma de pago** → el cajero toca *Cobrar pedido* y el
  pedido entra al carrito en modo pedido → el cajero elige comprobante y forma de pago → **recién ahí se asigna serie y
  correlativo, se descuenta el stock, se escribe el kardex y se emite el comprobante**.
- Explicar las dos decisiones con su porqué (son las que el jurado suele explorar):
  - **Por qué la numeración se asigna al cobrar:** porque antes cada intento numeraba el pedido, y si el cajero
    cambiaba de comprobante se quemaba un correlativo y quedaba un hueco en la serie.
  - **Por qué el pedido no reserva stock:** porque un pedido es un ticket en espera; reservar creaba **dos caminos de
    escritura del inventario** y retenía stock en silencio. Si al cobrar ya no alcanza, el cobro falla con un mensaje
    claro **antes** de emitir.
- **Énfasis:** "la numeración y el descuento de stock ocurren una sola vez, en un solo lugar: al cobrar".
- Si preguntan por el modo pedido: el cajero cobra **lo cotizado por el vendedor**, no se recalcula con las promociones
  del día (sería un precio distinto al prometido al cliente).

**Transición:** "Cobrado el pedido, empieza el flujo que más me importaba verificar: la emisión electrónica."

### D13 · Facturación electrónica (10:20 – 11:30)

- Recorrer los cinco pasos **diciendo quién hace cada uno**: la aplicación arma la carga útil; el servicio la valida
  con Pydantic; se genera el XML UBL 2.1 y se ajusta (importes exactos, totales de IGV, correlativos, punto de
  emisión); se firma con el certificado digital, se empaqueta en ZIP y se envía por SOAP a la SUNAT; la respuesta
  (CDR) se guarda en el documento.
- Decir las reglas fiscales en frases cortas:
  - "**el comprobante declara lo que se cobra**, no el precio de lista: el descuento se reparte entre las líneas
    **antes** de despejar el IGV";
  - "**el IGV solo existe en la afectación gravada**: un producto exonerado no lleva IGV, y dividirlo haría que el
    comprobante declare menos de lo cobrado";
  - "**todo lo que viaja a la SUNAT va con dos decimales**, cantidades y precios unitarios incluidos".
- Contar la anécdota del backend, porque demuestra rigor: "el servicio **ignora nuestro bloque de totales**: arma el
  XML con cantidad por precio unitario de cada línea. Cuando lo descubrí, dejé de mandar totales y ajusté el precio
  unitario por línea".
- **Énfasis:** "el CDR queda guardado en el documento: si el comprobante fue aceptado, eso es una constancia
  consultable después desde los reportes".

**Transición:** "Y todo eso termina en la caja, que es donde el negocio se juega el control."

### D14 · Control de caja y arqueo (11:30 – 12:40)

- La fórmula, **una sola vez y despacio**: "efectivo esperado = monto inicial + ventas en efectivo − gastos de caja −
  devuelto al cliente. **Las transferencias no entran** en el esperado ni en la diferencia: son informativas y se
  concilian aparte contra la billetera o el banco".
- Explicar los controles: conteo ciego configurable (el cajero cuenta **sin ver** cuánto debería haber y la diferencia
  aparece recién en el análisis), conciliación por medio electrónico declarada al cerrar, y documentos de caja con
  nombre y RUC del negocio, quién cerró el turno y las líneas de firma del cajero y del supervisor.
- Mencionar el detalle que demuestra cuidado: "el consolidado del día suma **solo turnos cerrados**: un turno abierto
  tiene un esperado pero todavía no un contado, e incluirlo **inventaba** una diferencia que no existía".
- **Énfasis:** "no se mezclan los dos ejes: **el bolsillo** (dónde entró la plata, que es contra lo que se concilia) y
  **el origen** (venta del día, cobranza de un crédito anterior o nota). Una venta a crédito no entra a ningún
  bolsillo hasta que se cobra".

**Transición:** "Pasemos a cómo se verificó todo esto."

### D15 · Ingeniería de requisitos (12:40 – 13:20, recortable)

- Los cinco roles con una frase cada uno, insistiendo en la separación vendedor/cajero: **el vendedor arma la venta y
  la envía; el cajero cobra y emite**. El rol define una plantilla, y **48 permisos** se otorgan o retiran uno por uno.
- Requerimientos funcionales y no funcionales: nombrar los bloques y remitir al Anexo 3, sin enumerarlos.
- **Énfasis:** "la interfaz oculta lo que el usuario no puede hacer" — dicho así, sin exagerar: el control fino del
  lado del servidor está declarado como limitación en la diapositiva 6.

**Transición:** "Y esto no quedó en el papel: así se probó."

### D16 · Pruebas y calidad (13:20 – 14:40)

- Dar los números una sola vez, sin repetirlos: **195 pruebas automatizadas** en 12 archivos, **25 373 líneas**
  TypeScript en 136 archivos (sin contar las pruebas), verificación de tipos en modo estricto, **cero errores** de
  análisis estático de estilo, y compilación de producción como parte del flujo.
- Explicar **por qué se pueden probar**: porque las reglas del negocio son módulos puros, sin base de datos ni
  interfaz, y se ejecutan con el verificador nativo de Node sin ningún marco de pruebas externo.
- Nombrar qué se prueba: dinero y redondeo, promociones y descuentos, reparto del descuento e IGV del comprobante,
  arqueo y bolsillos de pago, contadores y correlativos, reglas de pedidos, nombres del vendedor y del cajero, y
  saneamiento de datos antes de escribir.
- **Énfasis (esta frase vale la exposición):** "**una prueba que pasa repite la intención con la que se escribió, y
  puede estar aprobando una regla equivocada**; y las verificaciones estáticas no dicen nada sobre los datos que se
  escriben en la base. Por eso la validación más importante fue usar el sistema en el mostrador".

**Transición:** "Justamente: los defectos más importantes aparecieron ahí."

### D17 · Incidencias detectadas y corregidas (14:40 – 16:20)

Es la diapositiva más fuerte del trabajo. No leer las siete filas completas: recorrer **tres** y mencionar las otras
cuatro en bloque ("y cuatro más, todas documentadas en el anexo de pruebas").

1. "**Enviar una venta a caja fallaba siempre** y el sistema no decía por qué. La causa: la base rechaza los valores
   indefinidos y TypeScript no lo advierte. Se sanean los datos en el borde de escritura: hoy es una regla obligatoria."
2. "**El comprobante del pedido declaraba el precio de lista**: el pedido guardaba el descuento con otro nombre de
   campo del que lee el comprobante. El efecto era grave: **a la SUNAT se le habría declarado más de lo cobrado**."
3. "**Un contador paralelo podía repetir un número** de comprobante ya emitido. La causa: el flujo de pedidos usaba el
   espacio de numeración de los comprobantes fiscales. Las claves de contador quedaron en una sola función probada."

- **Énfasis:** "estos siete defectos afectaban dinero, numeración o declaración fiscal, y ninguno apareció en el
  desarrollo: aparecieron **usando el sistema en el mostrador**. Eso es la validación del trabajo, y es también mi
  conclusión de método".

**Transición:** "Con las correcciones aplicadas, este es el resultado."

### D18 · Resultados y funcionalidad entregada (16:20 – 17:20)

- Los números de la entrega (páginas, servicios, módulos puros, colecciones) en una frase.
- **Decir con claridad:** "el sistema **está en operación real** en un negocio: se usa para vender, controlar
  inventario, cerrar el turno y emitir comprobantes que la SUNAT acepta".
- **No dar cifras de operación.** Frase de cierre del bloque: "este informe **no declara cifras de venta ni porcentajes
  de mejora**: no administro esos datos, y prefiero una afirmación verificable a un número que no puedo respaldar".
- Mencionar los entregables: sistema en operación, manual de usuario por módulo y el paquete técnico de anexos.

**Transición:** "Y para que no sea solo una afirmación, hagamos el recorrido en vivo."

### D19 · Demostración en vivo (17:20 – 20:00)

- Antes de empezar, una frase para bajar el riesgo: "voy a hacer el recorrido en el mismo sistema que usa el negocio;
  si algo falla, se los muestro igual y seguimos".
- Seguir el guion de la sección 3 de este documento (2:40 en total).

### D20 · Conclusiones (20:00 – 20:40)

- Leer las cinco conclusiones como afirmaciones, no como resumen: (1) el objetivo se cumplió y el sistema está en
  operación; (2) la corrección fiscal se sostuvo en decisiones verificables; (3) la separación por capas permitió
  verificar sin navegador; (4) la validación real fue la que encontró los defectos importantes; (5) hay límites
  declarados.
- **Énfasis:** volver a la frase de método, enlazada con lo que se mostró en vivo: "lo que aprendí no es a usar una
  herramienta, es que **hay que verificar la intención de una regla**, no solo que la prueba pase".

### D21 · Recomendaciones y trabajo futuro (20:40 – 21:20, recortable)

- Las tres primeras y listo: **control de acceso por rol en las reglas de la base de datos**; **alinear la aplicación
  móvil** con las reglas ya corregidas en la web; **medir el efecto en la operación** con los datos que el sistema ya
  registra, para poder afirmar el impacto con evidencia.
- Mencionar en una frase las otras tres (controles de caja del rubro, varias sucursales, auditoría de comprobantes
  consolidados anteriores a la corrección).

### D22 · Cierre (21:20 – 21:40)

- Tres frases, sin más:
  1. "El sistema está construido, verificado y en operación, y el código, los anexos y el manual están disponibles
     para su revisión."
  2. "Agradezco al negocio que lo adoptó y me permitió corregirlo con sus usuarios reales, y a mi asesor por [la
     orientación / el acompañamiento]."
  3. "Gracias por su atención. Quedo atento a sus preguntas."

*(Si el tiempo se va a 21:40, está bien: es el recorrido con la demostración en vivo incluida, y las últimas
diapositivas se dicen en un minuto. Lo que no puede pasar es llegar a la demostración sin tiempo: si vas atrasado,
recortá D11, D15 y la mitad de D16, que son las tres marcadas como recortables.)*

### D23 · Respaldo — datos técnicos para las preguntas (no se expone)

- **No se presenta**: queda al final de la presentación y se abre solo cuando el jurado pide un dato exacto.
- Sirve para responder **sin dudar** cuatro cosas: las **medidas del repositorio** (25 373 líneas en 136 archivos sin
  contar pruebas, 27 páginas, 22 servicios, 29 módulos puros, 27 componentes, 16 colecciones, 195 pruebas en 12
  archivos, 70 confirmaciones de cambios del 10 al 17 de septiembre de 2026), las **tecnologías** por capa, **dónde
  vive cada regla crítica** (contadores, importes e IGV, arqueo y bolsillos, pedidos, nombres en el papel, saneamiento,
  consolidado) y los **estados del envío y los tipos de documento**.
- Si el jurado pregunta un número, dos caminos: decirlo de memoria **si lo tenés firme**, o decir "lo tengo en la
  diapositiva de respaldo" y mostrarla. Lo que **no** hay que hacer es inventar una cifra: en esa diapositiva está
  escrito, además, el criterio del trabajo —**no se declaran ventas, mejoras ni porcentajes del negocio**—.
- Cerrala cuando termines de responder: no dejes la presentación abierta en la diapositiva de respaldo, porque invita
  a seguir preguntando datos técnicos en lugar de cerrar la defensa.

---

## 3. Guion de la demostración en vivo (2:40)

**Preparación previa (hacerlo antes de entrar a la sala, no frente al jurado):**

- Sesión iniciada con un usuario **cajero** (para que se vean el panel de pedidos y el cobro).
- **Un turno de caja abierto**, con monto inicial razonable.
- Un producto del catálogo **con promoción de volumen vigente** (por ejemplo "2 o más a S/ 0,50"), identificado de
  antemano: el caso de la promoción es el que hizo visible el defecto del descuento.
- Cliente genérico seleccionable en dos clics (o ninguno, si la boleta no lo exige).
- **Conexión a internet verificada** y el servicio de facturación encendido (**si el servicio está apagado, el envío a
  la SUNAT falla: verificarlo antes de entrar**).
- Pestañas ya abiertas: pestaña 1 el punto de venta, pestaña 2 el arqueo del turno. No escribir rutas ni iniciar sesión
  en vivo.

**Recorrido, en orden, con los clics:**

| # | Tiempo | Qué hacés (clics) | Qué decís |
|---|---|---|---|
| 1 | 0:00 – 0:40 | Abrir **Punto de venta** → en la venta rápida, clic en el producto con promoción → subir la cantidad a la cantidad que activa la promoción | "Este producto tiene una promoción de volumen. Miren cómo cambia el importe de la línea: el descuento se aplica solo, es configuración del negocio." |
| 2 | 0:40 – 1:00 | Clic en **Enviar a caja** → confirmar → mostrar el mensaje y luego la tarjeta del pedido en **Ventas pendientes** (arriba del carrito) | "El pedido nació con su código **PED-…**, **sin serie, sin correlativo y sin forma de pago**: todavía no es un comprobante. El stock **no se ha movido**." |
| 3 | 1:00 – 2:00 | Clic en **Cobrar pedido** → el pedido entra al carrito → mostrar la **franja ámbar** con el descuento del vendedor y el total cotizado → elegir **Boleta** → elegir **forma de pago** (efectivo, con el monto precargado) → clic en **Cobrar pedido S/ …** → confirmar | "Acá está el punto importante: los productos entraron al carrito con **el descuento que aplicó el vendedor** y **el total cotizado, que no se recalcula**. El cajero elige comprobante y forma de pago, y **recién ahora** se asigna la serie y el correlativo, se descuenta el stock y se emite el documento." |
| 4 | 2:00 – 2:30 | Abrir el **comprobante recién emitido** (botón Imprimir / ver documento) → mostrar **serie y correlativo**, las **líneas con el descuento declarado** y el **estado del envío a la SUNAT** (aceptado + código del CDR) | "Serie y número asignados en este momento. Abajo, el descuento declarado: **el comprobante declara lo que se cobró**, no el precio de lista. Y acá está el resultado del envío con el código de la SUNAT: hay una constancia guardada en el documento." |
| 5 | 2:30 – 2:50 | Ir a **Arqueo de caja** → mostrar el turno del día: **efectivo esperado, contado y diferencia**, con las líneas de origen y el detalle por medio | "Y así queda la caja: el efectivo esperado, el contado y la diferencia. Las transferencias figuran aparte porque **no entran en el efectivo esperado**: eso se concilia contra la billetera." |

**Si algo falla en vivo (seguir este orden, sin improvisar):**

1. **Se dice y se sigue, sin disculparse de más.** Frase preparada: "esto no debería pasar; lo dejo así y sigo, porque
   el resultado lo tengo documentado". Un jurado valora más la serenidad que la perfección.
2. **Si falla el envío a la SUNAT** (servicio apagado, internet caído): aclarar que el servicio de facturación corre en
   la red del negocio y que un cambio ahí no surte efecto hasta reiniciarlo; después ir directo a la diapositiva del
   flujo de emisión y **mostrar el estado de un comprobante ya aceptado** en el registro de ventas.
3. **Si falla el cobro o el carrito:** mostrar la diapositiva de la incidencia correspondiente (D17) y contar el
   defecto real que se corrigió: convierte un fallo en el punto más fuerte de la exposición.
4. **Si la base de datos no responde** (sin conexión): mostrar el aviso de "sin conexión" de la propia aplicación y
   explicar que la consulta sigue funcionando con la caché local y que la venta se sincroniza al recuperar el enlace.
5. **Plan de respaldo documental:** tener impresas o en pantalla las capturas del anexo de pruebas (comprobante
   emitido con su CDR, arqueo de un turno cerrado) y el **manual de usuario**. Nunca decir "en mi máquina funciona":
   decir "el resultado está en el anexo 4, página tal".
6. **No intentar arreglarlo frente al jurado.** Si el fallo es trivial y se arregla en 15 segundos, se puede; si no,
   se ofrece repetir la demostración al terminar la ronda de preguntas.

---

## 4. Veinte preguntas probables del jurado

Las respuestas están pensadas para decirse en 20 a 40 segundos, empezando por la idea y siguiendo con el porqué.
No hay que memorizarlas: hay que quedarse con la primera frase de cada una.

**1. ¿Por qué una base de datos NoSQL y no una relacional?**
Porque el sistema se pensó para trabajar sin conexión desde el primer día y para sincronizar entre varios dispositivos
—una caja, una computadora de oficina, un celular— sin un servidor propio que mantener. Firestore da persistencia
local, sincronización automática y reglas de acceso sin administrar infraestructura. El costo es que las garantías
relacionales no vienen dadas: por eso las operaciones que tocan varios documentos —venta, stock, kardex y turno;
pedido y contador— se ejecutan dentro de transacciones o lotes, y las reglas de integridad que la base no impone las
sostienen módulos puros y probados. Con un requisito de reportes analíticos pesados o de integridad referencial
estricta, evaluaría una base relacional.

**2. ¿Cómo se garantiza que no se repitan ni salten números de comprobante?**
Hay **dos espacios de numeración separados** en la colección de contadores: uno para notas de venta y otro para los
comprobantes con validez fiscal. La clave del contador se construye **siempre** con una función única y probada, y el
alta lee y escribe el contador **dentro de una transacción** junto con el documento: o se asignan los dos, o no se
asigna ninguno. Si el contador no existe, se siembra desde el máximo ya emitido. Y como la numeración se asigna **al
cobrar** —no al crear el pedido—, una venta que no se concreta no consume un número ni deja un hueco. Este punto
exactamente fue un defecto real: apareció un contador paralelo que podía repetir un número; se corrigió dejando las
claves en un solo lugar y se verificó que no hubiera comprobantes repetidos.

**3. ¿Cómo se calcula el IGV y qué pasa en una región exonerada?**
El precio del producto es **precio final al público**, con IGV incluido. El IGV solo se despeja cuando la afectación
tributaria del producto es **gravada**: ahí el valor sin IGV es el precio entre 1,18. Para exonerado, inafecto o
gratuito el valor se declara tal cual, sin dividir: si se dividiera, el comprobante declararía **menos** de lo que se
cobró. La afectación es **del producto** y manda por encima de cualquier configuración; lo que se configura por
empresa es solo el valor por defecto para lo que no trae dato. El caso real del negocio en operación está exonerado
por la región, así que los comprobantes emiten sin IGV; el soporte gravado quedó implementado y probado porque el
sistema puede venderse fuera de esa región.

**4. ¿Por qué el comprobante se genera recién al cobrar?**
Porque el comprobante es un acto fiscal con consecuencias: consume un número de la serie y obliga a declararlo. Antes
se numeraba al crear el pedido y, si el cajero cambiaba el tipo de comprobante, el sistema **reasignaba** otro número:
cada intento quemaba un correlativo y dejaba un hueco en la serie original, y una nota de venta pendiente podía repetir
un número. Ahora el pedido nace como pendiente, con un **código interno propio** (por ejemplo `PED-000123`) que no es
un correlativo fiscal, y el número se asigna **una sola vez, al cobrar**. Como efecto adicional, eliminar un pedido ya
no tiene nada que anular ni deja huecos.

**5. ¿Por qué el pedido no reserva stock y qué pasa si se agota?**
Porque un pedido del vendedor es **un ticket en espera, no una reserva**: el mostrador puede seguir vendiendo ese
producto hasta que el cajero cobre. La primera versión sí reservaba y fue un error de diseño: creaba **dos caminos de
escritura del inventario** (el alta y el cobro) y, si un pedido quedaba colgado, retenía stock en silencio sin que
nadie lo viera. Hoy el inventario se descuenta **una sola vez, al cobrar**. Si al cobrar el stock ya no alcanza, el
cobro **falla con un mensaje claro** —"el stock de tal producto se agotó mientras el pedido esperaba en caja: disponible
A, pedido B"— antes de emitir nada. Es el costo de no reservar, y me parece el costo correcto: el cajero se entera
antes de cobrar, no después con el inventario mintiendo. Si algún día se quiere apartar producto (una seña, un cliente
que vuelve), va como una **capa explícita y visible** —un campo "reservado" mostrado en el catálogo—, no como un
descuento silencioso.

**6. ¿Cómo se protege el certificado digital?**
El certificado **nunca está en el navegador**. Vive en el servicio de facturación electrónica, que corre dentro de la
red del negocio, y la firma se hace del lado del servidor. Las claves y credenciales se leen de variables de entorno
que no están en el control de versiones, y en el repositorio no se reproduce ninguna credencial. Por eso el servicio
está separado de la aplicación web: además de aislar el certificado, permite actualizar la lógica tributaria sin
volver a publicar la aplicación. El costo es operativo y lo declaro: si el servicio está apagado o no se reinicia
después de un cambio, el envío falla, así que el reinicio forma parte del procedimiento documentado.

**7. ¿Cómo se controla el descuadre de caja?**
Con una **fórmula única** del efectivo esperado: monto inicial + ventas en efectivo − gastos de caja − devuelto al
cliente. Las transferencias **no entran**: se cuadra el efectivo, y los medios electrónicos se concilian aparte contra
la billetera o el banco. Esa fórmula estaba escrita a mano en seis lugares y dos de ellos calculaban distinto: el
cajero podía comparar contra un número diferente al que el sistema guardaba, así que se unificó en una sola función.
Como controles: **conteo ciego** configurable —el cajero escribe lo contado sin ver el "debería haber" y la diferencia
aparece recién en el análisis—, conciliación por medio electrónico declarada al cerrar, gastos de caja con su egreso
registrado, y documentos de caja con nombre y RUC del negocio, quién cerró el turno y las líneas de firma del cajero y
del supervisor. Un turno cerrado no se reescribe: una corrección se autoriza, se aplica solo al campo necesario, se
justifica en observaciones y queda en la auditoría.

**8. ¿Qué pasa si no hay internet? ¿Cómo se sincroniza?**
La aplicación funciona **sin conexión para consultar**: productos, precios y stock se leen de la caché local —la
persistencia de la base está activada y configurada para varios usuarios por equipo— y hay un aviso visible cuando no
hay enlace. Además hay un service worker que conserva estilos, imágenes y tipografías y usa estrategia de red primero
para las llamadas a datos. La sincronización es de la propia base: lo que se escribe queda en cola local y se envía al
recuperar la conexión. **Lo que no ocurre sin conexión es el envío a la SUNAT**, que depende de la red: el comprobante
se genera y el envío queda pendiente para reintentarse, y por eso el estado del envío (pendiente, enviando, aceptado,
rechazado o error) es parte del documento y se ve en los reportes.

**9. ¿Cómo se probó el sistema? ¿Cuál es la evidencia objetiva?**
Con tres niveles. **Automático**: 195 pruebas automatizadas en 12 archivos sobre las reglas del negocio puras —dinero
y redondeo, promociones y descuentos, reparto del descuento e IGV del comprobante, arqueo y bolsillos de pago,
contadores, reglas de pedidos, saneamiento de datos—, que corren con el verificador nativo de Node, sin base de datos
ni interfaz. **Estático**: verificación de tipos en modo estricto, sin tipos comodín ni aserciones de no nulidad, y
análisis de estilo con cero errores, con una línea base de avisos que no debe incrementarse. **De aceptación**: el uso
en el mostrador del negocio, que es donde aparecieron los siete defectos documentados. La evidencia concreta está en
el anexo de pruebas: el inventario de las pruebas, el caso real de la promoción con el comprobante que declaraba mal,
y el registro de cada incidencia con su causa y su corrección.

**10. ¿Qué limitaciones tiene el trabajo?**
Cuatro, y las digo yo antes de que las pregunten. La **primera**: las reglas de la base de datos exigen usuario
autenticado, pero la restricción fina por rol se aplica en la aplicación; llevarla a las reglas de la base está en
trabajo futuro. La **segunda**: la aplicación móvil existe como trabajo relacionado y no está alineada con las últimas
reglas corregidas en la web. La **tercera**: controles de caja del rubro que todavía no están (consolidado del día
con esperado y contado en el papel del arqueo, detalle declarado contra sistema por medio de pago, conteo ciego
activado por defecto). Y la **cuarta**: el trabajo **no mide el impacto en la operación del negocio** —ventas,
tiempos, descuadres antes y después—, porque no administro esos datos.

**11. ¿Qué harían distinto si lo empezaran de nuevo?**
Tres cosas, en orden de importancia. **Primero**, empezaría por las reglas del negocio en módulos puros y probados
antes de construir pantallas: cuando la fórmula del arqueo estaba escrita a mano en seis lugares, el problema no era
el código, era el orden en que se construyó. **Segundo**, definiría desde el principio el **contrato de datos** entre
los flujos —qué campos lleva un documento, con qué nombres— porque varios de los defectos fueron exactamente eso: el
pedido guardaba el descuento con un nombre que el comprobante no leía, o los items con la forma del carrito en vez de
la del documento. **Tercero**, pondría el **saneamiento de datos en el borde de escritura** desde la primera versión:
la base rechaza los valores indefinidos y el compilador no avisa, y eso hizo que "enviar a caja" no funcionara nunca
sin que ninguna prueba ni verificación de tipos lo detectara.

**12. ¿Cómo se gestiona la seguridad y los permisos?**
En dos niveles. El **rol** define una plantilla de permisos —administrador, gerente, cajero, vendedor y un rol
personalizado— y además cada permiso, **48 en total**, se puede otorgar o retirar por usuario. La aplicación oculta lo
que el usuario no puede hacer y valida en el flujo (por ejemplo, el tope del descuento manual se revisa en la pantalla
**y** otra vez al crear el pedido, porque el permiso solo se evalúa en el cliente). Además hay **sesión única por
dispositivo** para los usuarios operativos: si la misma cuenta entra desde otro equipo, la sesión anterior se cierra;
los administradores están exceptuados. Todo lo relevante queda en el registro de auditoría con su responsable, y hay
un panel de errores de la aplicación. Lo que está pendiente es llevar la restricción por rol a las reglas de la base
de datos: hoy exigen usuario autenticado, y lo declaro como limitación.

**13. ¿Qué pasa si el negocio crece a varias tiendas o sucursales?**
El sistema ya tiene la pieza base: las **cajas se modelan como puntos de emisión**, cada una con sus series de
comprobante, y el punto de emisión forma parte del hash del documento. Un pedido lleva la caja de origen solo
**para dirigirlo**, y lo cobra la caja que lo atiende con **sus** series. Ya está resuelto el caso de que una caja deje
de operar: los pedidos abiertos se pueden **transferir** a otra caja desde la configuración —dejando registro en la
auditoría— y, si nadie lo hizo, el cajero ve igual los pedidos de otra caja y los puede cobrar con confirmación. Lo que
falta para varias sucursales es la parte de consolidación y reportes por local, que es lo que dejé como trabajo futuro.

**14. ¿Cómo se respalda la información?**
Los datos viven en un servicio administrado de base de datos (Firebase) con respaldo automático, y no dependen del
equipo: si falla la computadora del negocio, la información sigue disponible desde otro dispositivo con acceso. Los
documentos de la aplicación se conservan versionados en el repositorio, y los comprobantes y las constancias de la
SUNAT quedan guardados en el propio documento de venta. Para el servicio de facturación, los archivos XML y CDR
generados se conservan del lado del servidor. La copia de seguridad de la base no la opero yo: es parte del servicio
contratado, y así está declarado en el manual de usuario.

**15. ¿Qué diferencia hay entre nota de venta, boleta y factura?**
La **nota de venta** es un documento interno de control: no tiene validez fiscal ante la SUNAT y por eso tiene su
propio espacio de numeración. La **boleta** y la **factura** sí son comprobantes electrónicos: se generan, se firman
digitalmente y se envían a la SUNAT, y se diferencian por el receptor y por el crédito fiscal (la factura requiere RUC
de once dígitos y permite sustentar crédito fiscal; la boleta es para consumidor final, con documento de identidad
cuando el importe supera el monto que exige identificarlo). En el sistema, sobre las notas de venta del día se puede
**consolidar** una boleta: se agrupan las ventas y se emite una sola boleta acumulada, declarando el descuento de las
notas que agrupa.

**16. ¿Qué es el CDR?**
Es la **constancia de recepción** que devuelve la SUNAT: un documento XML con un código de respuesta, una descripción
y el comprobante firmado. El código cero significa aceptado; otros códigos indican observación o rechazo. El sistema
interpreta esa respuesta, guarda en el documento el estado (aceptado, rechazado o error), el código y la descripción
del CDR, el hash y el contenido —cuando viene—, y ese estado es el que se consulta después desde el registro de ventas
y los reportes fiscales. Un detalle importante: si un comprobante ya aceptado se reenvía, la SUNAT responde con el
código que indica que ya estaba registrado, y el sistema lo marca como aceptado en lugar de tratarlo como error, para
no confundir al usuario.

**17. ¿Cómo se maneja una anulación?**
Hay que distinguir dos casos, y es una distinción que el sistema hace explícita. **Anular una venta ya emitida** (una
nota de venta o un comprobante del mismo día) se hace desde los reportes, **requiere un motivo** y **restaura el
stock**; queda registrado en la auditoría. Para un comprobante electrónico ya aceptado, el camino fiscal correcto es la
**nota de crédito**, que el sistema también emite y envía a la SUNAT, con sus series propias por caja. **Eliminar un
pedido en espera** es otra cosa: no hay comprobante que anular y el stock nunca se descontó, así que eliminar solo
marca el pedido como cancelado, con motivo y con quién lo eliminó: no se borra físicamente y no aparece en los
reportes fiscales, pero sirve para rastrear por qué un pedido no llegó a comprobante.

**18. ¿Cómo se calculan las comisiones de los vendedores?**
El sistema **no calcula comisiones**: no existe un porcentaje de comisión en la configuración ni un reporte de
comisiones. Lo que sí registra es **quién vendió y quién cobró** en cada venta, y lo imprime en el comprobante
("Vendedor: … · Cajero: …", o solo el cajero cuando trabajó una sola persona), además de un reporte de ventas por
empleado. Con esos dos datos el negocio puede calcular la comisión con su propia regla, que es una decisión comercial y
no del sistema. Si se quisiera que el sistema la calcule, hay que definir antes la regla —por venta, por cobro, por
producto, con o sin notas de crédito— y hacerlo en un módulo puro y probado, como el resto de los cálculos.

**19. ¿Qué aporte tiene el trabajo para otras empresas?**
El aporte central es el **conjunto de reglas verificables** para un problema que comparten casi todos los negocios
pequeños del país: vender, controlar stock, cuadrar caja y emitir comprobantes electrónicos sin un sistema caro. En
concreto: la numeración del comprobante asignada al cobrar en dos espacios de contadores, el comprobante que declara lo
cobrado y no el precio de lista, el IGV despejado solo cuando la afectación es gravada —lo que permite operar tanto en
región exonerada como fuera de ella—, el efectivo esperado como fórmula única, el inventario con un solo camino de
escritura y la constancia del CDR guardada en el documento. Todo eso está separado en módulos puros, probados y
documentados en anexos, así que es reutilizable por otro desarrollo o por otro equipo: no depende de la interfaz ni de
una base de datos específica.

**20. ¿Por qué no se usó un framework con enrutador (React Router)?**
Porque la aplicación es una **SPA de escritorio administrativo** con secciones fijas y con control de permisos por rol:
la vista inicial la determina el rol y los permisos del usuario, no una URL, y no hay necesidad de enlazar pantallas ni
de posicionamiento en buscadores. Con el estado del shell se resuelve la navegación, se evita una dependencia más y
**el control de acceso queda en un solo lugar** —el mismo que decide qué se muestra en el menú—, en vez de repartirlo
entre rutas y componentes. Sí se mantiene una ruta por parámetro para la pantalla del cliente, que se abre desde el
celular del cliente con un código de sesión: en ese caso la URL sí es necesaria. El costo asumido es que no hay
historial del navegador ni enlaces profundos a una sección; si el sistema creciera hacia un portal con muchas vistas
enlazables, migraría a un enrutador sin tocar las reglas del negocio, porque viven en módulos independientes.

---

## 5. Consejos de defensa

### Qué NO decir

- **No decir "es un sistema básico" ni "le falta mucho".** Describir lo que hace y declarar las limitaciones
  puntuales cuando toca (diapositiva 6). Minimizar el trabajo entero no es modestia: es renunciar a que evalúen lo
  que hiciste.
- **No afirmar métricas que no mediste.** Nada de "mejoró un 40% la atención", "redujo los descuadres a la mitad",
  "aumentó las ventas". No administrás esos datos y no los mediste. La frase correcta: "esa medición no la hice; la
  dejé como trabajo futuro, y el sistema ya registra los datos que harían falta".
- **No decir "funciona perfecto" ni "no tiene errores".** Ya mostraste siete defectos corregidos: eso es lo valioso.
  Un sistema sin defectos encontrados indica que no se probó.
- **No culpar a la base de datos, al framework ni "al internet".** Cuando aparezca un defecto, se cuenta la **causa
  real** (un nombre de campo distinto, dos cálculos repetidos, un contador paralelo). El jurado premia el diagnóstico,
  no la excusa.
- **No hablar mal del negocio ni de sus usuarios**, ni mencionar nombres de clientes, montos, RUC o cualquier dato
  sensible. Si el jurado pide cifras de operación: "no las incluyo por confidencialidad del negocio y porque no forman
  parte de lo que este trabajo mide".
- **No decir "lo hice con inteligencia artificial"** como explicación del trabajo, ni como disculpa ni como mérito.
  Si preguntan por las herramientas usadas, respondé por el **proceso**: cómo relevaste los requisitos, cómo
  verificaste las reglas, cómo detectaste y corregiste cada defecto. Eso es lo que se evalúa.
- **No improvisar normativa tributaria.** Si preguntan por una obligación que no estudiaste —por ejemplo, un
  reglamento específico o un plazo—: "eso no lo verifiqué en este trabajo; lo que sí está verificado en el sistema es
  [el punto que sí conocés: la firma, el CDR, los correlativos]".

### Cómo responder cuando no sabés o no lo mediste

Usá siempre la misma estructura de tres pasos: **reconocer → encuadrar → ofrecer.**

1. **Reconocer**: "No lo medí" / "Eso no lo verifiqué" / "Esa parte no la trabajé". Sin dar vueltas y sin excusas.
2. **Encuadrar**: "está fuera del alcance que definí, y lo tengo identificado como trabajo futuro" o "lo que sí tengo
   verificado es…".
3. **Ofrecer**: "si le interesa, el anexo [1/2/3/4] detalla el [arquitectura / modelo de datos / pruebas], y puedo
   comentarlo al terminar".

Frase modelo, completa: *"No lo medí. Lo tengo identificado como limitación dentro del alcance y como trabajo futuro.
Lo que sí puedo mostrarle, y está verificado en el repositorio, es [dato concreto]."*

Esto funciona porque demuestra tres cosas que un jurado busca: honestidad, conciencia de los límites del trabajo y
capacidad de distinguir un hecho verificado de una opinión.

### Qué llevar impreso

- **Manual de usuario** (`docs/manual-usuario.html` / `.pdf`): es la prueba de que el sistema se documentó para el
  negocio, no solo para la nota. Llevarlo y ofrecerlo si preguntan por la usabilidad o la capacitación.
- **Las diapositivas impresas** (6 por hoja, para el jurado y para vos) más **el guion** en papel, a mano, por si
  hay preguntas de estructura.
- **Anexo 1 — Arquitectura** y **Anexo 2 — Modelo de datos**: son los dos que se piden cuando el jurado quiere ver
  detalle técnico.
- **Anexo 4 — Plan de pruebas**: el más útil si preguntan por evidencia objetiva; ahí están el inventario de las 195
  pruebas, los casos de aceptación y la tabla de incidencias corregidas.
- **Anexo 5 — Informe**: por si piden ver la redacción del capítulo correspondiente.
- **Anexo 6 — Diapositivas** (`06-sustentacion.pdf`) y la **diapositiva de respaldo** impresa aparte: los números del
  repositorio y dónde vive cada regla, para responder sin dudar.
- Una **hoja de una carilla con tus propios datos**: los tres momentos que hay que clavar, los números (195 pruebas,
  25 373 líneas, 27 páginas, 22 servicios, 29 módulos puros, 16 colecciones) y las siete incidencias en una línea cada
  una. Se repasa en el pasillo, no en la exposición.
- **Laptop y cargador**, con la demostración **abierta y probada** en la sala, y una carpeta con las capturas del
  anexo de pruebas como plan B.
- Agua. Y el celular en silencio.

### Cierre de tres frases (memorizarlo)

> **1.** El sistema está construido, verificado y **en operación real** en un negocio, y cada afirmación de este
> trabajo se puede comprobar en el repositorio y en los anexos.
>
> **2.** Lo que me llevo de este trabajo no es solo el sistema funcionando: es que **hay que verificar la intención de
> una regla**, no solo que la prueba pase, y que los defectos que más importan aparecen cuando el usuario real lo usa.
>
> **3.** Gracias por su atención; quedo atento a sus preguntas.

---

### Anexo del guion: quién dice qué y qué se evita

| Situación | Qué hacer |
|---|---|
| El jurado interrumpe con una pregunta a mitad de la exposición | Responder en una o dos frases y decir "¿le contesto con más detalle al final o seguimos?"; nunca perder el hilo de la diapositiva |
| Pregunta muy técnica del backend o de la SUNAT | Responder con el flujo real (validación, XML, firma, ZIP, SOAP, CDR) y remitir al Anexo 1 |
| Pregunta sobre el negocio (ventas, clientes, precios) | Remitir a la confidencialidad del negocio; ofrecer lo funcional (módulos, controles) |
| Pregunta comparativa ("¿por qué no usaron *X* tecnología?") | Reconocer la alternativa, decir por qué se eligió esta y **qué se habría ganado y perdido** con la otra |
| El tiempo se agotó y faltan diapositivas | Saltar a conclusiones: "por el tiempo, resumo en las tres conclusiones principales" y seguir con la demostración, si el jurado lo permite |
