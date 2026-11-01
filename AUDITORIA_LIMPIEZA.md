# Auditoría y limpieza de Conce Barber Club

Fecha: 1 de noviembre de 2026. Git estaba limpio al comenzar. Los cambios quedan sin commit y no se realizó ningún despliegue.

## Alcance y criterio

Se inventariaron los 94 archivos originales de `Frontend/src` y `backend/src`, los manifiestos y lockfiles, las configuraciones de compilación y despliegue, Prisma, scripts y pruebas. Se revisaron las relaciones de importación, entradas de Astro, islas React, registro de rutas Express, llamadas de la interfaz, eventos, selectores y clases generadas en ejecución.

| Área original | Inventario |
| --- | --- |
| Frontend | 14 páginas Astro, 21 componentes, 1 layout, 6 módulos de biblioteca, 11 hojas CSS, 5 imágenes y declaración de entorno |
| Backend | 7 módulos de rutas, 9 controladores, 11 servicios, 3 validadores, 2 middlewares, 2 módulos de configuración y entrada Express |
| Contratos HTTP | 51 rutas de API y `/health` |
| Dependencias declaradas | Frontend: 5 de ejecución y 6 de desarrollo. Backend: 8 de ejecución y 9 de desarrollo |

El recorrido de referencias desde las páginas Astro y la entrada Express no identificó archivos originales de código o recursos desconectados. Se consideraron las páginas como entradas del framework y `env.d.ts` como declaración del compilador. No se detectaron importaciones locales inexistentes ni diferencias de mayúsculas/minúsculas en las rutas revisadas, relevantes para Linux. La ausencia de una referencia textual no se utilizó por sí sola como motivo de eliminación.

## Cambios realizados

| Archivo | Cambio y motivo |
| --- | --- |
| `Frontend/src/lib/html.ts` — nuevo | Centraliza el escape de `&`, `<`, `>`, comillas dobles y simples. Mantiene dos entradas: texto estricto y valores convertidos con `String(value ?? '')`, para conservar el comportamiento de cada consumidor. La tabla de entidades se crea una sola vez. |
| `Frontend/src/components/AdminDashboard.astro` | Sustituye el escape duplicado por el módulo compartido. Corrige el tipo del selector de rol antes de registrar su evento; el elemento sigue siendo el mismo. |
| `Frontend/src/components/FeaturedBarbers.astro` | Sustituye el escape duplicado por la entrada de texto estricto. |
| `Frontend/src/components/ProfileView.astro` | Sustituye el escape duplicado por la entrada de texto estricto. |
| `Frontend/src/pages/admin-barberos.astro` | Sustituye el escape duplicado conservando la conversión de números y valores ausentes. |
| `Frontend/src/pages/barberos.astro` | Sustituye el escape duplicado por la entrada de texto estricto. |
| `Frontend/src/pages/mensajes.astro` | Sustituye el escape duplicado conservando la conversión de valores ausentes. |
| `Frontend/src/layouts/Layout.astro` | Elimina una rama de fotografía con el mismo resultado en ambos caminos y una comprobación de origen ya realizada inmediatamente antes. |
| `Frontend/src/lib/access.ts` | Normaliza y consulta la ruta una sola vez en `canAccess`; conserva permisos y valores de retorno. |
| `Frontend/tests/html.spec.ts` — nuevo | Dos pruebas del límite de escape: texto/atributos con contenido HTML y conservación de valores administrativos. Incluye comprobación en el DOM de que no se genera una imagen a partir del texto. |
| `backend/src/services/barberProfile.ts` — nuevo | Centraliza las tres consultas idénticas de `getOwnBarberProfile`, conservando argumentos, cliente Prisma y resultado. |
| `backend/src/utils/number.ts` — nuevo | Centraliza las dos implementaciones de `toInt` bajo el nombre preciso `toNumber`: la función convierte números, no redondea ni impone enteros. Conserva `NaN` para entradas no aceptadas. |
| `backend/src/controllers/citas.ts` | Usa la consulta compartida del perfil. No modifica transacciones, bloqueos, fechas, disponibilidad ni reservas. |
| `backend/src/controllers/lugartrabajo.ts` | Usa la consulta y conversión compartidas; conserva validaciones y operaciones. |
| `backend/src/controllers/servicios.ts` | Usa la consulta y conversión compartidas. Simplifica `value.descripcion !== undefined ? value.descripcion : undefined` a `value.descripcion`, manteniendo también `null`. |
| `backend/src/controllers/conversations.ts` | Sustituye `any` por el tipo inferido de Prisma para la conversación y las relaciones seleccionadas. No modifica la proyección JSON ni las consultas. |
| `backend/src/controllers/usuarios.ts` | Sustituye dos conversiones `as any` por `as UserRole`, después de la validación existente. |
| `backend/src/controllers/auth.ts` | Elimina el objeto `export default` sin consumidores. Las seis funciones exportadas por nombre, utilizadas por las rutas, permanecen. |
| `AUDITORIA_LIMPIEZA.md` — nuevo | Registra alcance, cambios, evidencias y limitaciones. |

No se eliminaron archivos completos, componentes, endpoints ni dependencias declaradas. Se retiraron seis implementaciones locales de escape, tres copias locales de consulta de perfil y dos copias locales de conversión numérica, reemplazadas por sus implementaciones compartidas. También se retiraron el objeto de exportación sin uso y las condiciones redundantes indicadas. No se encontraron `console.log` de depuración en el código de aplicación: se conservó el aviso de inicio del backend y los registros operativos/de errores.

## Protección del comportamiento

Se compararon las seis implementaciones originales de escape con sus sustitutas en 3.048 casos, incluidos caracteres especiales, entidades preexistentes, Unicode y los valores no textuales admitidos originalmente: todos equivalentes. Las dos pruebas nuevas verifican además el resultado al interpretar HTML en el navegador.

La comparación de los archivos Astro modificados excluyendo únicamente sus scripts confirma que frontmatter, marcado y estilos inline no cambiaron. Las 11 hojas CSS, imágenes y componentes React quedaron intactos. Los módulos de rutas Express, middlewares de autenticación y autorización, validaciones, esquema Prisma, migraciones, seed, manifiestos, lockfiles, Docker, Nginx y scripts de despliegue/respaldo no se modificaron. Tampoco se editaron variables de entorno ni credenciales.

La extracción de consultas mantiene el mismo número y contenido de consultas Prisma. Se conservaron las relecturas dentro de transacciones y los bloqueos que protegen concurrencia e historial. No se ejecutaron comandos de migración, seed, reset, db push ni operaciones sobre la base de datos del sistema.

## Validación

| Comprobación | Antes | Después |
| --- | --- | --- |
| Backend: TypeScript con `--noEmit` | Correcto | Correcto |
| Frontend: TypeScript con `--noEmit` | Correcto | Correcto |
| Frontend: `npm run build` | 14 páginas compiladas | 14 páginas compiladas |
| Backend: emisión JavaScript y declaraciones con `tsc --outDir ../quality-artifacts/audit-backend-build` | No requerida para la línea base | Correcto |
| Backend: `npm test` | 40 pruebas aprobadas; 7 suites PostgreSQL omitidas | 40 pruebas aprobadas; las mismas 7 suites omitidas |
| Frontend: Playwright | 260 pruebas aprobadas en desarrollo | 262 pruebas aprobadas sobre la compilación estática, incluidas las dos nuevas; código de salida 0 |
| Scripts Astro: análisis TypeScript adicional en memoria | Un error preexistente TS2339 en el selector de rol de `AdminDashboard.astro` | 13 bloques revisados, cero diagnósticos |
| Equivalencia de escape HTML | Implementaciones de `HEAD` como referencia | 3.048 comparaciones correctas |
| Integridad de imports locales y capitalización | Sin referencias rotas | 97 archivos de código/recursos alcanzables desde sus entradas; sin imports rotos ni diferencias de capitalización |
| `git diff --check` | Sin cambios iniciales | Correcto |

Los comandos de TypeScript usan el compilador ya instalado en cada subproyecto: `node node_modules/typescript/bin/tsc --noEmit`. El backend no tiene script `build`, por lo que la emisión se dirigió a una carpeta ignorada, fuera de `src`.

Para comprobar los scripts Astro se utilizó `node quality-artifacts/audit-check-astro.cjs`, que crea archivos virtuales en memoria y aplica el `tsconfig` existente. Este análisis complementa a `tsc`; **no sustituye el chequeo semántico completo de plantillas y frontmatter de `astro check`**. `@astrojs/check` no está instalado. ESLint tampoco tiene configuración ni script en el proyecto; no se instaló ni se inventó una configuración.

La suite inicial de navegador terminó de ejecutar sus pruebas, pero quedó esperando el cierre del servidor Astro administrado por Playwright en Windows. Al detener únicamente ese servidor de prueba, Playwright informó **260 passed** y código de salida 0. Para la ejecución final se inició `astro preview` en `127.0.0.1:4322` y se utilizó `TEST_EXTERNAL_SERVER=1` para controlar explícitamente el cierre del proceso. Esa ejecución informó **262 passed (3.5m)** y terminó normalmente con código 0. El servidor de preview creado para la auditoría se detuvo al finalizar. No se cambió la configuración del proyecto.

Los registros locales están en `quality-artifacts/audit-baseline-backend.log`, `audit-final-backend.log`, `audit-baseline-build.log`, `audit-final-build.log`, `audit-baseline-browser.log` y `audit-final-browser.log`. `audit-final-source.json` conserva el mapa final de imports locales. Esa carpeta ya estaba ignorada por Git; no es parte del código de despliegue.

## Elementos conservados y limitaciones

- **PostgreSQL real:** las siete suites de integración necesitan una base desechable `schedule_tests` mediante `SCHEDULE_TEST_DATABASE_URL`. No estaba configurada y no se utilizó la base del sistema. Las pruebas del backend ejecutadas utilizan sustituciones de Prisma. La concurrencia y persistencia reales no quedaron verificadas en esta sesión.
- **CSS posiblemente antiguo:** hay candidatos como `.booking-days`, `.booking-slots`, `.barbers-profile-*`, `.profile-dropdown*` y `.admin-danger-ghost`. Se conservaron porque una búsqueda textual no prueba por sí sola la ausencia en todos los estados y combinaciones de temas. Clases como `is-confirmada`, `is-available`, `is-break` y `view-dia` se generan dinámicamente y no son código muerto.
- **Calendarios:** `BarberCalendar`, `ProfessionalCalendar` y `BookingCalendar` tienen consumidores y responsabilidades diferentes: publicación de disponibilidad, consulta profesional y reserva del cliente. Se conservaron los tres.
- **Rutas de compatibilidad:** se mantuvieron los endpoints diarios, el calendario de reservas, las variantes de cancelación y las rutas de desactivación. La ausencia de un consumidor visible no permitiría descartar integraciones externas.
- **Tipos y exportaciones locales:** `Actor`, `IntervalIssue`, `publicServiceSelect` y `redirectToLogin` tienen uso dentro de sus propios módulos. No se eliminaron por no tener consumidores externos. Se conservó también la exportación nombrada de Prisma en su archivo de configuración.
- **Proyecciones de privacidad:** las selecciones públicas, profesionales y bancarias siguen separadas. Las similitudes entre ellas no justifican unificarlas y ampliar datos expuestos.
- **Fechas y estados:** se conservaron las implementaciones de fecha de cada entorno y las etiquetas de estado que difieren según la pantalla, para no cambiar semántica ni textos visibles.
- **Dependencias:** todas las declaradas tienen uso directo, de framework, compilación o pruebas. `npm ls --depth=0` mostró residuos locales `date-fns` y `@babel/runtime` en frontend, y `@emnapi/runtime`, `@img/sharp-wasm32` y `tslib` en backend. No se eliminaron manualmente; pueden involucrar dependencias transitivas/opcionales de la instalación. La simulación `npm prune --dry-run --offline --ignore-scripts --package-lock=false --no-audit --no-fund` del frontend no pudo resolver el árbol por falta de metadatos en caché (`ENOTCACHED`). No se ejecutó una poda real.
- **Advertencia preexistente:** Browserslist informa que `caniuse-lite` tiene siete meses de antigüedad. Se conservó el lockfile para evitar actualizaciones ajenas a la limpieza.
- **Documentación preexistente:** README referencia `docs/INFRAESTRUCTURA_GRUPO_2.md` y `docs/PERFILES_SEGURIDAD_GRUPO_5.md`, ausentes del árbol actual. Se informa el problema; no se reconstruyó documentación histórica sin sus fuentes.
- **Entorno de validación:** Windows con Node.js 22.17.0. Se revisó capitalización de imports para Linux, pero no se ejecutó una compilación Docker ni un despliegue Linux.

Las comprobaciones cubren los flujos automatizados existentes y los cambios concretos realizados. No constituyen una garantía absoluta de todos los estados posibles del sistema, especialmente de integraciones externas y operaciones con PostgreSQL real no ejecutadas.
