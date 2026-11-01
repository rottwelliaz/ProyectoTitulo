# Auditoría funcional final — Conce Barber Club

Fecha: 1 de noviembre de 2026 (America/Santiago).

## Alcance y criterio de evidencia

Se tomó `AUDITORIA_LIMPIEZA.md` como punto de partida y se revisó el diff completo de los 14 archivos previamente modificados, los cuatro archivos nuevos de implementación/pruebas y el informe anterior. Se conservaron esos cambios sin realizar otra limpieza. No se hicieron commits ni despliegues.

La validación combina pruebas unitarias, navegador con API simulada, integración HTTP con PostgreSQL real y dos escenarios de navegador conectados a esa API real. **Una prueba de interfaz con respuestas simuladas no demuestra por sí sola persistencia ni concurrencia.** La matriz siguiente distingue esa evidencia. No se afirma cobertura exhaustiva de todos los datos, navegadores o instalaciones posibles.

Entorno ejecutado: Windows, Node.js 22.17.0, PostgreSQL 17.5 y Chrome instalado. Docker Compose declara Node.js 20 y PostgreSQL 15; esa combinación y Ubuntu requieren una ejecución posterior específica.

## 1. Verificación de la limpieza

| Elemento revisado | Evidencia y resultado |
| --- | --- |
| Escape HTML en seis consumidores | Comparación de funciones de `HEAD` con `html.ts`, más pruebas de DOM y mensajes con contenido HTML: comportamiento preservado. |
| `canAccess`, conversión numérica y consulta de perfil compartida | Comparación con las implementaciones originales, incluidos roles/rutas, valores numéricos y argumentos de Prisma. La conversión compartida continúa sin redondear ni imponer enteros. |
| Comparación conjunta de funciones | **3.230 comparaciones aprobadas**. Es una batería finita, no una demostración formal para todas las entradas. |
| Importaciones y capitalización | **214 imports locales** comprobados en el árbol de 97 archivos de fuente/recursos; sin rutas rotas ni diferencias de capitalización. |
| Tipos | TypeScript de ambos proyectos correcto; backend emite JavaScript y declaraciones. Análisis complementario de 13 bloques de scripts Astro: cero diagnósticos. |
| Contratos y proyecciones | Rutas, esquema Prisma y migraciones conservados. La tipificación de conversaciones mantiene la proyección JSON. Exports de autenticación utilizados por las rutas se conservan. |
| Diseño | Marcado de los siete archivos Astro afectados comparado excluyendo sus scripts: idéntico a `HEAD`. CSS e imágenes sin cambios. |
| Dependencias | Manifiestos y lockfiles coinciden. No se instalaron ni actualizaron paquetes. |

Evidencia reproducible local: `quality-artifacts/final-qa-source.cjs` y `final-qa-source.json`. La validación de scripts no sustituye `astro check` completo: `@astrojs/check` no está instalado.

## 2. Funcionalidades verificadas

| Área y flujo | Evidencia ejecutada |
| --- | --- |
| Cliente: registro, login y logout | Registro/login real, hash de contraseña, cambio persistente de contraseña y rechazo de la anterior. Navegador registra una cuenta, inicia sesión y cierra sesión borrando token y caché. |
| Cliente: perfil | Navegador guarda un nombre en PostgreSQL y lo conserva tras recargar. Integraciones verifican teléfono omitido/vacío/null, correo único, fotografía y errores de validación. |
| Catálogo y perfiles públicos | Playwright prueba búsqueda, filtros, ordenación, paginación, estados vacío/error. HTTP real verifica profesionales activos/aprobados y datos públicos permitidos. |
| Cliente: calendario y reserva | Pruebas de calendario con mocks, integración real de disponibilidad y navegador contra API/BD reales. Reserva con comprobante y competencia entre dos clientes. |
| Cliente: cancelación e historial | HTTP y PostgreSQL verifican liberación de intervalos, límites de fecha, propiedad, estados e historial. Interfaz comprueba etiquetas y acciones permitidas mediante mocks. |
| Barbero: autenticación y perfil profesional | Login real y permisos por rol; perfil, especialidades, fotografía y lugar de trabajo persisten en PostgreSQL. Interfaz de edición probada con API simulada. |
| Barbero: servicios | Creación, edición, precios, duraciones, activación y retiro. Propiedad y conservación de nombre/precio/duración históricos comprobadas con HTTP y PostgreSQL. |
| Barbero: disponibilidad y bloqueos | Publicación semanal, configuración, descansos y bloqueos persistentes. Revisión de agenda detecta cambios de otro dispositivo y reservas concurrentes. |
| Barbero: calendario, citas y estados | Vistas diaria/semanal/mensual contra la misma BD, transiciones permitidas, rechazo, cancelación, finalización e inasistencia; aislamiento por profesional. |
| Barbero: datos bancarios y comprobantes | Lectura/edición del propietario, no exposición en listados, cuota de consulta y formatos de comprobante. Reserva real con archivo desde navegador. |
| Administrador: autenticación y permisos | Login real, rechazo a invitados/clientes/barberos y comprobación del rol actual en BD, independientemente del rol declarado por el JWT. |
| Administrador: solicitudes y usuarios | Aprobación/rechazo atómicos, motivo de rechazo, desactivación/reactivación, protección del propio administrador e historial preservado. |
| Administrador: panel y estadísticas | Conteos HTTP cotejados con consultas independientes a PostgreSQL. Pantallas administrativas, edición y errores cubiertos por Playwright con mocks. |
| Estadísticas profesionales | SQL por período/estado, fechas de Santiago, resultados vacíos e aislamiento entre profesionales. |
| Mensajería | Apertura idempotente, envío/respuesta, persistencia, leído, último mensaje, límites de longitud y rechazo de terceros. Navegador muestra texto HTML literalmente sin ejecutar una imagen inyectada. |
| Otras funcionalidades | Solicitud para convertirse en barbero, fotografía normalizada, preferencias de comprobante, temas, navegación y retornos de login, sesión vencida, página 404, geometría móvil/escritorio y comprobaciones automáticas de accesibilidad existentes. |

Las pruebas de accesibilidad automatizadas no equivalen a una certificación de accesibilidad ni sustituyen una revisión manual. El cierre de sesión comprobado es el comportamiento existente de eliminar la sesión local; no se añadió revocación de JWT en el servidor.

## 3. Integridad de reservas

Las siete suites antes pendientes se ejecutaron sin omisiones sobre PostgreSQL real. Verificaron:

- Solapamientos iguales, contenidos, envolventes y parciales; intervalos consecutivos permitidos.
- Dos solicitudes al mismo horario o a inicios diferentes que se solapan: un éxito y un conflicto HTTP 409; una sola reserva persistida.
- Espera observable ante un `SELECT ... FOR UPDATE` retenido por una conexión independiente. El bloqueo por perfil protege distintas conexiones, no solo una función en memoria.
- Reservas de profesionales diferentes simultáneas; rollback libera el bloqueo y revierte escrituras.
- Duración completa dentro de disponibilidad publicada, sin cruzar descansos, bloqueos o cierre; contexto del día/semana siguiente incluido.
- Congelación de nombre, precio y duración; reservas heredadas sin duración verificable se bloquean por seguridad.
- Cancelación/rechazo liberan únicamente disponibilidad todavía publicada. Retirar disponibilidad no elimina reservas.
- Desactivación concurrente del profesional releída antes de reservar; terminales simultáneos producen un único evento válido.
- Restricciones SQL protegen historial y snapshots; fallos del registro de auditoría revierten el cambio.
- Fechas civiles de `America/Santiago`, semanas de 167/169 horas, medianoche, cambios de mes/año y zona horaria del servidor.

No se alteraron el esquema ni las migraciones del proyecto. Aplicar las migraciones existentes a una base nueva de pruebas no cambió ninguna base del sistema.

## 4. PostgreSQL aislado y ejecución segura

Docker está instalado, pero el daemon no respondió y su servicio estaba detenido. La inspección de WSL confirmó Ubuntu disponible, sin `node` nativo; `npm` y `docker` encontrados provienen del PATH de Windows. No se instalaron herramientas de Linux ni se inició o modificó infraestructura Docker. Se localizaron los binarios de PostgreSQL 17 y se creó **otro clúster**, independiente del servicio PostgreSQL existente:

| Propiedad | Valor de esta auditoría |
| --- | --- |
| Datos | `quality-artifacts/final-qa-pg` |
| Escucha | `127.0.0.1:55439` |
| Usuario | `audit_qa`, creado dentro del clúster nuevo |
| Autenticación | SCRAM con contraseña aleatoria exclusiva de pruebas |
| Base | `schedule_tests`, creada vacía |
| Migraciones | Las 14 migraciones existentes se aplicaron correctamente |
| Datos utilizados | Cuentas y reservas sintéticas creadas por las pruebas; sin copia de datos reales |

Se verificó `SHOW data_directory` antes de provisionar la base. El runner local comprueba además `data_directory` y `current_database()` antes de las ejecuciones de backend, pruebas adicionales y arranque. Las variables de conexión se transmiten a procesos hijos; no se editaron archivos `.env` reales. No se utilizó `quality-database.cjs`, porque toma la conexión del `.env` de la aplicación y comparte su servidor.

Las operaciones de escritura, pruebas de borrado/rechazo y rollback de las suites se limitaron al clúster sintético. No se ejecutaron reset, limpieza de bases existentes, `db push`, seed del sistema ni operaciones contra producción. El nombre `schedule_tests` por sí solo **no demuestra aislamiento**.

Para repetir en este equipo, el auxiliar local `quality-artifacts/final-qa-runner.cjs` contiene modos `start-pg`, `preview`, `backend`, `extra`, `smoke` y `stop-pg`. No volver a ejecutar `prepare` sobre una base ya creada. La contraseña y el clúster son artefactos locales ignorados por Git; no deben publicarse.

Para reproducir en otro equipo se necesita crear primero una instancia vacía y desechable con almacenamiento, credenciales y puerto propios; verificar su identidad; aplicar allí las migraciones existentes; iniciar el frontend compilado; establecer `SCHEDULE_TEST_DATABASE_URL` y `CALENDAR_TEST_FRONTEND_URL` exclusivamente para el proceso de pruebas. El comando de backend es `node --test --test-concurrency=1 tests/*.test.cjs` desde `backend`. Sin esas variables, las suites de integración se omiten y los escenarios de navegador real requieren además Chrome y las dependencias del frontend.

## 5. Pruebas y resultados

| Comprobación | Resultado |
| --- | --- |
| Backend sin integración | 40/40 aprobadas; siete suites de BD inicialmente omitidas |
| Backend con las siete suites originales y navegador real habilitado | 112/112 aprobadas, cero fallos, cero omisiones |
| Nueva suite funcional antes de corregir lugar de trabajo | 4 aprobadas, 1 fallida: HTTP 500 frente al 400 esperado |
| Nueva suite funcional tras la corrección | 5/5 aprobadas, cero omisiones |
| Revalidación final del backend | **117/117 aprobadas, ocho suites, cero fallos y cero omisiones**: las 40 pruebas sin BD, 72 casos de las siete suites originales y cinco casos nuevos |
| Frontend, primera ejecución completa | 261 aprobadas, 1 fallo de espera de sesión (`pending` durante 15 s) en geometría 1280×720/light |
| Caso de navegador fallido, repetido aisladamente | 3/3 aprobadas sin cambiar la implementación ni aumentar timeouts |
| Corrida intermedia de frontend desde la raíz, con directorio incorrecto | 258 aprobadas y cuatro errores ENOENT en archivos de carga relativos. Error de invocación de la auditoría, no regresión demostrada del producto |
| Frontend, ejecución final desde el directorio correcto | **262/262 aprobadas**, cero fallos, sin reintentos automáticos; 4,0 minutos |
| TypeScript y compilación backend | Correctos, incluida la corrección de lugar de trabajo |
| Frontend build | 14 páginas compiladas; también compilación separada con URL pública de API de prueba |
| Variables API compiladas | `PUBLIC_API_URL` se incorpora; `VITE_API_URL` no se incorpora y dejaba el fallback localhost |
| Entrada real `backend/src/index.ts` con `NODE_ENV=production` | Arranca; `/health`, catálogo PostgreSQL, 401 sin sesión, CORS permitido/denegado y cabeceras correctos |
| Frontend estático en preview | Ocho rutas de smoke responden 200 y una ruta inexistente responde 404 |
| Docker Compose | `config --quiet` correcto con valores sintéticos y `.env.example`; sin construir ni arrancar contenedores |
| Integridad de cambios | Imports, equivalencia, marcado visual y `git diff --check` correctos |

La repetición final no borra el fallo inicial del navegador: se conserva su registro y se informa como intermitencia sin causa demostrada. Playwright debe ejecutarse desde `Frontend` (`npm.cmd test` en Windows), con `TEST_EXTERNAL_SERVER=1` cuando se utiliza el preview controlado externamente; las rutas de archivos de carga de las pruebas existentes son relativas a ese directorio.

## 6. Errores corregidos y cambios de esta auditoría

| Hallazgo | Corrección mínima | Evidencia |
| --- | --- | --- |
| Lugar de trabajo ejecutaba `.trim()` sobre un nombre numérico, provocando TypeError y HTTP 500 | Comprobar texto antes de recortar nombre/dirección. Validar identificadores como enteros seguros positivos antes de Prisma, conservando `toNumber` compartido | Prueba roja conservada; después pasan entradas numéricas/objetos/arrays/null, IDs decimales/infinito/no positivos/inseguros y CRUD válido |
| Docker copiaba el contexto completo sobre dependencias Linux, incluyendo `node_modules` de Windows y el `.env` local | Añadir `backend/.dockerignore` y `Frontend/.dockerignore` excluyendo dependencias locales, secretos y artefactos generados | Se comprobó la presencia local del motor Prisma para Windows y del `.env`; las exclusiones están revisadas. Construcción efectiva pendiente por daemon no disponible |
| Ejemplo frontend configuraba `VITE_API_URL`, que Astro no expone al navegador | Cambiar únicamente el nombre del ejemplo a `PUBLIC_API_URL` | Dos compilaciones con URLs sintéticas distintas y comprobación del bundle; no se contactaron esos dominios |
| Cobertura incompleta de mensajería, conteos y recorrido real de cuenta | Añadir `backend/tests/final-functional-postgres.test.cjs` | Cinco escenarios con BD, incluyendo un recorrido de navegador real y la regresión de lugar de trabajo |

No se cambió diseño, CSS, contratos de solicitudes/respuestas válidas, endpoints, esquema, migraciones, dependencias ni funcionalidades. La respuesta 400 a entradas inválidas corrige el error interno de validación; no modifica los campos de la API. `Frontend/src/env.d.ts`, que Astro reescribió al compilar, se dejó con su contenido original.

## 7. Compatibilidad, pendientes y riesgos

| Prioridad | Pendiente/riesgo | Condición para cerrarlo |
| --- | --- | --- |
| P1 antes de producción | Ubuntu y Docker no ejecutados. Las pruebas reales usaron PostgreSQL 17/Node 22, mientras Compose declara PostgreSQL 15/Node 20 | Construir y ejecutar en un entorno Docker/Linux aislado con las versiones objetivo y repetir integración. Los imports revisados no sustituyen esta ejecución |
| P1 antes de acceso remoto | Compose y Dockerfile de frontend están destinados a desarrollo. Un build sin `PUBLIC_API_URL` sigue usando localhost | Preparar el hosting estático y la URL HTTPS pública de API **al compilar**; configurar `CORS_ORIGIN` con el origen exacto, `JWT_SECRET`, `DATABASE_URL` y `NODE_ENV=production` en el entorno destino. No se modificó infraestructura real |
| P2 | Una espera de sesión falló de forma intermitente en la primera corrida del navegador | Conservar la evidencia y observar repeticiones. Si reaparece, capturar trazas de carga y red antes de atribuirlo a rendimiento o cambiar código |
| P3 | `astro check` completo y ESLint no disponibles en la configuración existente | Incorporar sus herramientas/configuración en una tarea separada si se requieren; esta auditoría usó TypeScript, scripts Astro, build y navegador |
| P3 | README enlaza dos documentos ausentes; advertencia de Browserslist desactualizado | Recuperar documentación original y planificar actualización de metadatos con su validación. No se inventaron documentos ni cambiaron lockfiles |

No se ensayaron carga sostenida, despliegue, TLS/proxy del entorno final, restauración de backups ni todos los navegadores. Tampoco se realizó una auditoría nueva de vulnerabilidades del registro npm. Estos puntos no se presentan como verificados.

## 8. Evidencia local y estado de entrega

Los logs y auxiliares están en `quality-artifacts/`, ya ignorado por Git:

- `final-qa-backend-unit.log`, `final-qa-postgres.log`, `final-qa-functional-before-fix.log`, `final-qa-functional.log`.
- `final-qa-browser.log`, `final-qa-browser-first-failure.md`, `final-qa-browser-recheck.log`, `final-qa-browser-final.log`.
- `final-qa-migrations.log`, `final-qa-build.log`, `final-qa-public-build.log`, `final-qa-legacy-build.log`, `final-qa-api-env.json`.
- `final-qa-smoke.log`, `final-qa-startup.log`, `final-qa-source.json`, `final-qa-source.cjs`, `final-qa-runner.cjs` y `final-qa-shutdown.json`.

**Estado general: funcionalmente estable en el entorno probado, con 117 pruebas de backend y 262 de frontend aprobadas en las ejecuciones finales.** No quedaron suites PostgreSQL pendientes. No se detectaron regresiones reproducibles de la limpieza. La evidencia respalda la demostración local de los recorridos descritos; conviene ensayar esa demostración con sus cuentas y configuración finales antes de la defensa.

El clúster temporal y los procesos de backend/preview creados para esta auditoría se detuvieron al finalizar. Los datos sintéticos y logs se conservaron sin borrar. El servicio PostgreSQL preexistente permaneció en ejecución; no se utilizaron sus bases. No se hicieron commits, despliegues ni cambios de infraestructura real.

La certificación de ejecución en Ubuntu/Docker y la configuración del entorno público siguen pendientes. La conclusión de preparación se limita al entorno y los recorridos efectivamente probados; una ejecución local satisfactoria no certifica un despliegue de producción.
