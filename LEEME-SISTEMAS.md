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

La aplicación abre directamente para consultar y capturar. La clave administrativa es **Koide2026**. Se comprueba en Node con el hash de `data/access-config.json`; el HTML no contiene la clave. Cada función protegida solicita la clave y autoriza la sesión del navegador durante un máximo de 15 minutos para completar sus operaciones. «Bloquear administración» revoca esa autorización al terminar. Conservar este archivo de configuración junto al servicio.

Si se instaló la versión anterior que pedía usuarios, ejecutar con permisos de creación de tablas:

```powershell
npm run update-access
```

Este comando crea una tabla de sesiones de acceso directo sin borrar ni modificar capturas. No es necesario crear usuarios. Las tablas de cuentas anteriores pueden conservarse, pero ya no se consultan para entrar.

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
