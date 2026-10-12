# Recepción de máquinas — MySQL + Node.js

Esta entrega reemplaza la propuesta de servidor SQL Server/.NET. Usa exclusivamente **MySQL** para la base central y **Node.js** para el servicio, en Windows Server. No contiene SQLite, tareas de respaldo automático y utiliza la clave administrativa acordada. El HTML local original permanece separado.

## Qué contiene

- `public/index.html`: interfaz completa de recepción, incidencias, historial y Skill Map. Abrir mediante HTTPS; no funciona como archivo local.
- `src/`: servicio Node, autenticación y validaciones.
- `sql/001-create.sql`: esquema MySQL con tablas de documentos, empleados, usuarios, sesiones, solicitudes y auditoría; vistas de recepciones, incidencias y evaluaciones.
- `data/employees.json`: 67 asociados del catálogo Excel proporcionado. Se conserva su contenido, incluidos los nombres que ya aparecen como prueba en el catálogo.
- `scripts/manage.mjs`: instalar esquema, actualizar acceso e importar empleados.
- `tests/`: comprobaciones locales y prueba contra MySQL para una base desechable independiente.
- `deployment/web.config`: ejemplo de proxy IIS para Node en el puerto 3080.

## Requisitos y datos que Sistemas debe asignar

1. Node.js 24 LTS con npm; el código requiere Node 22 o superior.
2. MySQL 8.4, motor InnoDB, caracteres `utf8mb4`. Base nueva exclusiva para esta aplicación.
3. Nombre DNS interno y certificado HTTPS confiable para los equipos de planta.
4. IIS con URL Rewrite y Application Request Routing (ARR), proxy habilitado y `preserveHostHeader=true`. El servicio Node escucha solamente en `127.0.0.1`.
5. Cuenta de servicio Windows sin privilegios administrativos para ejecutar Node permanentemente. Sistemas define el mecanismo de servicio, reinicio ante falla y los permisos de la carpeta.

El servicio se publica en la **raíz de su propio sitio**, por ejemplo `https://checklist.empresa.local/`. No está preparado para una subcarpeta dentro de otro sitio. MySQL y el puerto interno de Node no deben publicarse directamente a las estaciones; estas acceden a IIS por HTTPS.

## Instalación

Copiar el paquete a una carpeta de aplicación, por ejemplo `C:\Apps\Checklist`. **No usar esta carpeta como raíz pública de IIS**: contiene configuración y catálogo. Crear otra carpeta para el sitio proxy y colocar allí únicamente `deployment/web.config`.

En MySQL, Sistemas crea una base vacía con `utf8mb4`, un usuario instalador con permisos para crear tablas/vistas y un usuario de ejecución. El usuario de ejecución necesita SELECT/INSERT/UPDATE/DELETE en las tablas de esta base; no necesita CREATE/DROP ni acceso a otras bases. No usar root como cuenta del servicio.

Desde la carpeta de la aplicación:

```powershell
Copy-Item .env.example .env
npm install --ignore-scripts
```

Editar `.env`: host, puerto, base, usuario, contraseña y `PUBLIC_ORIGIN` con el origen HTTPS exacto, sin ruta adicional. Usar temporalmente credenciales de instalación para `init-db`; sustituirlas por la cuenta de ejecución al terminar. Proteger `.env` mediante permisos NTFS para Sistemas y la cuenta de servicio. No enviar ese archivo con contraseñas en correos ni paquetes.

```powershell
npm run init-db
npm run import-employees
npm test
npm start
```

La aplicación abre directamente para consultar y capturar. Las claves iniciales son **Koide2026** para funciones protegidas, **Prod2026** para Actualización de parámetros y **K.oide2026** (con punto) para Administración de claves. Se verifican en Node contra hashes de la tabla `access_keys`; el archivo `data/access-config.json` solo proporciona los valores iniciales al instalar. El HTML no contiene las claves en texto legible. Cada función protegida solicita la clave y autoriza la sesión del navegador durante un máximo de 15 minutos para completar sus operaciones. «Bloquear administración» revoca esa autorización al terminar. Conservar este archivo de configuración junto al servicio.

Para actualizar cualquier entrega anterior, detener Node, sustituir los archivos conservando `.env` y ejecutar con permisos de creación de tablas:

```powershell
npm run update-access
```

Este comando instala sesiones de acceso directo, claves por módulo, autorizaciones y auditoría de cambios de claves (esquema 2), sin borrar capturas. Conserva las claves que ya existan en MySQL. No es necesario crear usuarios. Al terminar, reiniciar Node con la cuenta de ejecución y recargar la página en los equipos. Las tablas de cuentas anteriores pueden conservarse, pero ya no se consultan para entrar.

`init-db` continúa exigiendo una base vacía; para actualizar una instalación existente usar únicamente `update-access`. Si la creación inicial falla a la mitad, Sistemas debe revisar el error antes de repetirla en una base nueva.

Configurar el servicio persistente para ejecutar `node.exe --env-file=.env src/server.mjs` con directorio de trabajo en la carpeta de la aplicación. Configurar IIS para reenviar al puerto 3080, conservar Host y permitir solicitudes de hasta 64 MB. Si se cambia `PORT`, ajustar también `web.config`. Si aumentan imágenes y respaldos, modificar de forma coordinada el límite de IIS y `BODY_LIMIT_MB`.

Si MySQL está en otro equipo, configurar `MYSQL_SSL_CA` con el archivo CA de su certificado; la conexión verifica el certificado. No hay opción para desactivar esa verificación. Node e IIS en este diseño están en el mismo Windows Server.

## Empleados y cuentas

Los empleados se consultan en MySQL por número para mostrar el nombre en todos los módulos. Para cargar una actualización, usar un JSON UTF-8 con este formato:

```json
{"2001":"NOMBRE COMPLETO","2002":"OTRO NOMBRE"}
```

```powershell
npm run import-employees -- C:\Importaciones\empleados.json
```

La importación actualiza nombres coincidentes y agrega nuevos números en una transacción. No elimina empleados ausentes del archivo. Los nombres con acentos se conservan. Se puede sustituir esta importación por una sincronización con el sistema corporativo cuando Sistemas proporcione sus tablas, campos y acceso. **Todavía no existe esa conexión corporativa.**

En el Excel original hay nueve nombres que ya contienen el carácter de reemplazo `�`. Se preservaron sin adivinar letras. `data/empleados-por-revisar.json` identifica esos números para que se corrijan en el catálogo y se vuelva a ejecutar la importación. No es un daño causado por MySQL.

El número de empleado identifica al asociado de cada registro y completa su nombre. Ya no hay cuenta individual de ingreso: la auditoría del servicio usa «acceso-directo», y los datos del asociado permanecen dentro de cada captura. La clave compartida no identifica a una persona administradora concreta.

La sesión técnica se crea automáticamente, con cookie HttpOnly/Secure, comprobación de origen y CSRF. La autorización administrativa vence a los 15 minutos y puede bloquearse antes. La sesión de captura dura hasta 30 días y se renueva automáticamente cuando vence.

## Migrar los registros actuales

1. En el HTML local anterior, descargar **Respaldo completo** desde Historial y respaldo, en el navegador y equipo que contienen los datos reales. Copiar el HTML por sí solo no copia su base del navegador.
2. Abrir el sitio HTTPS y proporcionar la clave al seleccionar la función administrativa.
3. Restaurar ese JSON usando **Restaurar respaldo**. Revisar las cantidades y los detalles antes de dar por terminada la migración.
4. Conservar el HTML local y su JSON exportado como punto de regreso. No seguir capturando simultáneamente en la versión local y en el servidor.

El paquete NO importa automáticamente evaluaciones históricas ni registros de prueba incrustados. Una base nueva empieza sin capturas. El catálogo de 67 empleados se carga explícitamente con el comando anterior. Restaurar un JSON desde una interfaz que ya tiene datos puede sustituir registros según la función de restauración: hacerlo de forma controlada por administración.

## Integridad y concurrencia

Cada recepción, incidencia y evaluación tiene un documento JSON individual en MySQL; no se sobrescribe un archivo o un único objeto global con todo el sistema. Esta primera migración mantiene el formato detallado de la aplicación dentro de columnas JSON, con vistas SQL para consultar los campos principales. El catálogo de empleados y las cuentas tienen tablas propias. No se trata todavía de una tabla independiente por cada respuesta de examen.

Los cambios se confirman en una transacción InnoDB y conservan auditoría con usuario, fecha y valores anterior/nuevo. Se comprueba la versión leída por el cliente. Un cambio desde otro equipo causa conflicto y conserva el envío pendiente para revisión; no se mezcla a ciegas. Un identificador único de solicitud hace seguro reintentar después de perder la respuesta del servidor. La clave única máquina/fecha/turno impide recepciones empalmadas; una reactivación actualiza el mismo registro y conserva el paro inicial. Las validaciones incluyen los puntos generales/del turno y los cálculos de evaluación.

La validación y escritura usan un bloqueo corto compartido por las capturas. Es una base prudente para la cantidad indicada de aproximadamente 20 usuarios, pero el rendimiento debe medirse con los datos reales: el servicio todavía lee el conjunto de documentos para validar y la interfaz descarga el estado completo. Fotografías e historial muy grandes requerirán paginación y separar los archivos adjuntos; no se ha realizado una prueba de carga de producción.

El navegador conserva solamente un envío pendiente sin confirmar, para reintentarlo desde ese navegador. No sustituye a MySQL ni funciona como respaldo central. Si no hay conexión, el usuario no recibe una confirmación falsa de guardado.

## Respaldos

**No se instala ni se programa ningún respaldo automático**, conforme a la indicación de Sistemas. Se mantienen las opciones manuales de exportar/restaurar JSON para administradores. Ese JSON corresponde a los datos de aplicación, no incluye contraseñas, sesiones ni toda la auditoría SQL. El CSV es para consulta; no restaura el sistema.

Si Sistemas necesita una copia íntegra de MySQL, deberá realizar y verificar su procedimiento manual de exportación/restauración. Esta entrega no configura destino de respaldo ni periodicidad. Una base central reduce los problemas de almacenamiento en navegadores, pero no permite recuperar por sí sola la pérdida del disco del servidor.

## Validación antes de liberar

Las pruebas locales de reglas, sintaxis del HTML y reintentos con un servicio simulado se ejecutaron. **No se ejecutaron contra MySQL real en el equipo de desarrollo: no está instalado y no se proporcionaron credenciales. Tampoco se ha verificado todavía IIS/HTTPS ni el servicio persistente.**

La descarga de dependencias mediante npm fue rechazada por la configuración de red de desarrollo. El paquete no contiene `node_modules` ni un archivo de bloqueo de dependencias generado: Sistemas debe ejecutar `npm install --ignore-scripts` con acceso a su registro permitido. El controlador directo está fijado a mysql2 3.24.4; conservar el `package-lock.json` resultante y usar `npm ci --ignore-scripts` en instalaciones posteriores. No se ha probado aún el arranque con el controlador instalado.

Para probar la base: crear una base desechable nueva con nombre terminado en `_test`, cambiar temporalmente `.env`, instalar esquema y ejecutar:

```powershell
npm run init-db
npm run test:mysql
```

Esa prueba inserta datos y exige una base sin documentos; no borra tablas. Comprueba 20 envíos concurrentes, reintentos, conflictos de versión, rollback, permisos, eliminación/restauración y duplicados. Después restaurar la configuración de la base de operación. Nunca ejecutar pruebas con credenciales o nombre de base de producción.

Finalmente probar desde dos estaciones: acceso directo, rechazo de clave incorrecta, aceptación de Koide2026, nombre por número, captura por turno, paro/reactivación, incidencia NG, evaluación, modificación con clave administrativa y exportación/restauración en prueba. Interrumpir la conexión tras guardar y comprobar que «Reintentar envío» no duplica el registro. Cerrar y reiniciar Node y MySQL, verificar persistencia. Estos pasos constituyen la aceptación del despliegue, no están completados por generar el paquete.

Fuentes técnicas: [mysql2](https://sidorares.github.io/node-mysql2/docs), [MySQL JSON](https://dev.mysql.com/doc/refman/8.4/en/json.html), [Node crypto](https://nodejs.org/api/crypto.html).

## Impresión de checklists por turno

En Administración de checklist, «Imprimir / PDF» abre una vista con los puntos activos, sus descripciones, imágenes de referencia y columnas T1/T2/T3. Los generales aparecen en los tres turnos. Permite un proceso o todos; cada proceso comienza en una hoja nueva, con encabezados y numeración repetidos. La distribución se calcula después de cargar las imágenes, manteniendo el tamaño de letra. Los checklists extensos pueden necesitar más hojas. En el diálogo de impresión elegir A4 y escala 100 %, sin encabezados/pies del navegador, y seleccionar impresora o Guardar como PDF.

Esta función está incluida en el paquete del 29 de septiembre. Los cambios de contenido que se hicieron desde el navegador local (ítems, fotos y turnos) siguen requiriendo exportar/restaurar el Respaldo completo para trasladarlos a MySQL; modificar el HTML no extrae automáticamente esos datos del navegador.

## Identificación KMD-PR38 — actualización 1 de octubre

Recepción de máquina muestra KMD-PR38 Rev 0 discretamente en la esquina superior derecha de sus pantallas y checklist impreso, y como metadato en reportes Excel/CSV. Los menús y títulos no llevan código. El respaldo JSON incluye el código como metadato y mantiene la compatibilidad de restauración. Skill Map conserva sus nombres.

En el checklist impreso, los turnos aplicables tienen círculos vacíos de 7 mm para marcar a mano; los no aplicables conservan un guion. Las imágenes permanecen junto al punto. Cada hoja lleva KMD-PR38 y se retiraron el subtítulo de programación, el contador de puntos y la revisión.


## Actualización del 8 de octubre: recepción y parámetros

- Recepción: se retiraron las cuatro tarjetas superiores. El selector ofrece los seis supervisores indicados por número y permite escribir quién cubre el turno.
- Incidencias: el número de empleado aparece primero y completa el nombre con el catálogo. La reparación se puede registrar en acceso directo; el servidor solo admite esa transición con responsable, identificación, actividad, fecha e historial coherentes. Los demás campos de la incidencia se conservan.
- Posibles checklists faltantes aparece antes de los filtros de Incidencias NG.
- Actualización de parámetros contiene Registro de parámetros de biselado, basado en el HTML proporcionado. Incluye las 20 biseladoras, catálogo de partes y medidas, tabla, filtros, exportación y resumen con gráficas. Los recursos de interfaz van incluidos para no depender de internet.
- Cada lectura de biselado se guarda como documento individual `bevelRecords` en MySQL, con versión, transacción, auditoría y reintento. El catálogo modificado se guarda en `meta/bevelCatalog`. Crear o eliminar registros exige acceso a parámetros; editar registros existentes o el catálogo exige además la clave de funciones protegidas.
- Administración, al fondo del menú, permite cambiar por separado cualquiera de las tres claves. Solicita confirmar la nueva clave; usa versiones para evitar sobrescribir cambios desde otro equipo y revoca las autorizaciones abiertas cuando cambia una clave. Las claves nuevas se conservan en MySQL al reiniciar.

El HTML local ofrece los mismos menús y conserva sus datos y cambios de claves en el navegador. No comparte automáticamente las claves con MySQL. En servidor, la protección se comprueba también en Node; en el archivo local es un control de interfaz.

Los registros que pudieran estar guardados en el HTML independiente de biseladoras no se importan automáticamente. Se incorporó su catálogo incluido; las lecturas nuevas se guardan dentro de este sistema. Los registros anteriores de recepción y evaluaciones se conservan al actualizar la instalación existente.

Se verificaron los flujos en un navegador aislado: supervisores y suplente, autocompletado en reparación, orden de tarjetas, acceso rechazado/aceptado, guardado y recarga de parámetros, tabla y resumen, cambio de clave y rechazo de la anterior. Se comprobó también el HTML de servidor con API simulada y su política de contenido. Las pruebas de reglas, cambios parciales, permisos y claves usan adaptadores simulados. **La prueba contra MySQL real y la instalación de IIS siguen pendientes de Sistemas.**

En la aceptación, probar las tres claves desde dos equipos, cambiar una de ellas y comprobar que la anterior deja de autorizar. Capturar una lectura, reiniciar Node y MySQL y confirmar su persistencia. Ejecutar `npm run test:mysql` solo en una base de prueba vacía, como se indica arriba. No se agregó respaldo automático.


## Corrección del 9 de octubre: autorización durante el guardado

Si vence la autorización de parámetros durante una captura, Guardar solicita la clave en la misma pantalla y continúa la operación al confirmarla. No se recarga el formulario ni se descartan sus campos. Cancelar o ingresar una clave incorrecta no guarda ni limpia la captura. La edición y el catálogo también renuevan su autorización administrativa cuando corresponde. En servidor se consulta la autorización vigente y el reintento de un envío pendiente conserva su identificador para evitar duplicados.

Se verificó la caducidad simulada en el HTML local y en el HTML de servidor con API simulada, incluyendo cancelación, clave incorrecta, guardado, edición y persistencia al recargar. La validación en MySQL real sigue a cargo de Sistemas. Para esta corrección, sustituir los archivos de la aplicación, conservar `.env` y reiniciar Node; si ya se instaló el esquema 2 del 8 de octubre, no se requiere migración adicional. Guardar o copiar los campos pendientes antes de recargar una página antigua.


## Evaluaciones de medición: corrección de la secuencia julio–octubre

El lote `data/measurement-2026-10-09.json` contiene 14 ciclos didácticos de cuatro aplicaciones: julio, agosto, septiembre y octubre. Se agregaron las 14 aplicaciones faltantes de septiembre. Las de octubre se distribuyen entre el 6 y el 8, dentro del rango autorizado del lunes 5 al jueves 8. Todos los días son de lunes a viernes, con intervalos de 29 a 31 días naturales. Las notas simuladas de septiembre y octubre aumentan gradualmente respecto de la nota anterior del ciclo, usando como base la calificación que ya mostraba el sistema. Los intentos adicionales de origen se conservan.

Los identificadores de los registros corregidos permanecen iguales. Se conserva la fecha, hora, calificación y datos reportados de origen dentro de `scheduleOriginal`, visibles en Registro original. Las fechas ajustadas, notas simuladas y respuestas generadas se identifican con la prima discreta (′). Cada detalle del ciclo indica Aplicación 1, 2, 3 o 4 y el mes correspondiente. El libro `.xlsm` original no fue modificado.

Para aplicar o actualizar el lote en MySQL, desde la carpeta del servicio con `.env` configurado:

```powershell
npm run import-measurements
```

Este comando también actualiza la versión anterior que colocaba las aplicaciones el 9 de octubre. Conserva nombres corregidos por el catálogo, otros módulos, criterios y eliminaciones. Comprueba que las fechas y calificaciones a corregir todavía coincidan con las de la entrega anterior; si alguien las editó, cancela el lote para revisión, sin escribir parcialmente. Una segunda ejecución no duplica las aplicaciones. No se utiliza Restaurar respaldo ni se vacía la base. Reiniciar Node para cargar la interfaz actualizada y recargar las estaciones después de guardar las capturas pendientes.

En el HTML local el ajuste se aplica una sola vez al abrir la versión actualizada en la misma ubicación y navegador. Se verificaron tanto una carga nueva como la actualización desde el lote anterior, el detalle marcado, las cuatro rondas mensuales, los intervalos, la mejora de notas y la recarga sin duplicados. La ejecución del importador contra MySQL real sigue pendiente de Sistemas.
