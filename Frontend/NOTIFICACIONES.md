# Notificaciones de Conce Barber Club

SweetAlert2 se configura en `src/lib/notifications.ts`. Los componentes Astro lo llaman desde sus scripts de navegador y React desde sus controladores de eventos. La biblioteca se carga dinámicamente; las funciones no acceden al DOM durante SSR.

```ts
import { confirmAction, notifySuccess, notifyError, notifyWarning } from './lib/notifications';

if (!await confirmAction('¿Retirar este registro?', 'Sí, retirar')) return;
// Ejecutar aquí la operación, manteniendo su bloqueo contra solicitudes repetidas.
void notifySuccess('Cambios guardados.');
// Ante un fallo, usar un mensaje público; nunca pasar diagnósticos internos.
void notifyError('No se pudieron guardar los cambios. Inténtalo nuevamente.');
void notifyWarning('Revisa esta información antes de continuar.');
```

## Comportamiento y temas

- Éxito: toast de 4,5 segundos, con cierre manual; el temporizador se pausa con el ratón o el foco dentro del aviso.
- Error y advertencia: cuadros con botón «Entendido».
- Confirmación: foco inicial en «Cancelar», botón de acción diferenciado y cierre mediante Cancelar, Escape, botón de cierre o fondo. Solo `isConfirmed === true` autoriza la operación.
- Cada flujo mantiene un bloqueo durante la confirmación y la solicitud para evitar ejecuciones repetidas. Una segunda confirmación no sustituye la primera. Los avisos de resultado esperan a que termine el cuadro activo.
- El foco regresa al elemento que abrió el diálogo cuando sigue disponible. Si hay un formulario abierto con `<dialog>`, el aviso se monta dentro de él para respetar la capa modal del navegador.
- Títulos y mensajes usan texto, sin interpretar HTML.

`Layout.astro` carga el CSS de SweetAlert2 y `src/styles/notifications.css`. Este último usa el `data-theme` existente y variables como `--admin-card`, `--booking-bg`, `--pro-text` y `--pro-line`, con valores de respaldo para el tema original azul. Los temas claro y oscuro ya definen esas variables en `globals.css`.

No se crea una preferencia nueva ni se escribe otro valor de almacenamiento. El script existente aplica `ui-theme` antes de pintar la página y gestiona los eventos de tema y de almacenamiento. Al cambiar `data-theme`, CSS actualiza el aviso abierto sin recrear el cuadro ni perder el estado de sus campos o botones. Los colores de los iconos también cambian por CSS.

## Migración

Se reemplazaron **7 llamadas a `window.confirm()`** y **0 llamadas a `alert()`**: no había alertas nativas activas en `src`.

| Archivo | Operación que espera confirmación |
| --- | --- |
| `src/components/ProfileView.astro` | Cancelar reserva del cliente; conserva la advertencia sobre el pago previo |
| `src/components/BarberAppointments.tsx` | Cambiar estado de una cita |
| `src/components/ProfessionalServices.tsx` | Retirar un servicio sin borrar el historial |
| `src/components/calendar/ProfessionalCalendar.tsx` | Retirar un bloqueo |
| `src/components/calendar/BarberCalendar.tsx` | Reemplazar los bloques de una semana con una copia |
| `src/components/perfil-profesional.astro` | Eliminar el lugar de trabajo |
| `src/components/AdminDashboard.astro` | Desactivar una cuenta conservando citas e historial |

Los resultados de guardado de perfil, contraseña, fotografía, reserva, servicios, bloqueos, datos bancarios, lugar de trabajo, preferencias de reserva y administración usan toasts en lugar de duplicar su mensaje de éxito en línea. Los fallos de las operaciones destructivas migradas muestran errores públicos mediante SweetAlert2. Se conservan las validaciones en línea, los errores con reintento y los mensajes de carga existentes. Mensajes, inicio de sesión y registro mantienen sus flujos sin avisos nuevos.

Los dos `window.prompt()` administrativos recogen un motivo de rechazo obligatorio y alimentan el cuerpo de la solicitud. Se analizaron y conservaron; esta migración no cambia la captura ni las validaciones de ese dato.

## Archivos de la implementación

Nuevos:

- `src/lib/notifications.ts`
- `src/styles/notifications.css`
- `tests/notifications.spec.ts`
- `NOTIFICACIONES.md`

Actualizados:

- `package.json`, `package-lock.json`, `src/layouts/Layout.astro`
- `src/components/AdminDashboard.astro`, `BarberAppointments.tsx`, `BookingFlow.tsx`, `ChangePasswordForm.astro`
- `src/components/ProfessionalProfileEditor.tsx`, `ProfessionalServices.tsx`, `ProfileView.astro`, `perfil-profesional.astro`
- `src/components/calendar/BarberCalendar.tsx`, `ProfessionalCalendar.tsx`
- `src/pages/admin-barberos.astro`
- `tests/navigation.spec.ts`, `password-change.spec.ts`, `professional-panel.spec.ts`, `reservation-lifecycle.spec.ts`, `users-availability.spec.ts`

La implementación no cambia backend, Prisma, PostgreSQL, endpoints, autenticación ni permisos. El árbol de trabajo contenía cambios previos; se conservaron.

## Verificación

Desde `Frontend`:

```sh
npm run build
node node_modules/typescript/bin/tsc --noEmit
npm test -- --reporter=line
```

La suite de notificaciones cubre SSR, los tres temas, anchos de 1280/768/320 px, toasts y cierre automático, errores, advertencias, foco y teclado, cambio de tema con campos abiertos, navegación, superposición con formularios modales, texto sin HTML, confirmación/cancelación/cierre en los siete flujos y mensajes públicos ante un error del servidor. Los flujos de navegador usan respuestas de API simuladas; no modifican datos reales.

Resultados ejecutados el 3 de noviembre de 2026:

- Compilación final: `npm run build`, correcta; 14 páginas generadas.
- TypeScript: `tsc --noEmit`, sin errores.
- Suite específica inicial: **21/21 aprobadas**.
- Suite completa: **334/335 aprobadas** en 6,2 minutos. La prueba `Diseño 1600x900 / original` falló por un error del cliente de desarrollo de Vite al construir un WebSocket con puerto `undefined`. Su repetición aislada terminó **1/1 aprobada**. Las 335 pruebas quedaron verificadas, con esa repetición necesaria.
- Tras el ajuste final del área táctil de cierre a 44 × 44 px, notificaciones y ciclo de citas: **23/23 aprobadas**.
- Comprobación adicional de la compilación mediante `astro preview` en el puerto 4323: **3/3 escenarios aprobados**, uno por tema, a 390 px. Se verificó la carga del módulo compilado, cambio de tema con la confirmación abierta, cancelación sin solicitudes de escritura y confirmación con una sola solicitud, seguida del toast de éxito. Sin errores de ejecución del navegador.
- Búsqueda en `src`: sin llamadas activas a `alert()` o `confirm()` nativos. Se conservan los dos `prompt()` analizados.
- Revisión visual de las capturas de los avisos, incluyendo modo claro y toast oscuro a 320 px: correcta.

En este entorno Windows, Playwright quedó esperando durante el cierre automático de su servidor. Las ejecuciones con resultado final y código de salida se realizaron con Astro en el puerto 4322 y `TEST_EXTERNAL_SERVER=1`. No se cambió la configuración de pruebas del proyecto. El log de la suite completa está en `notifications-regression.log` (archivo local ignorado por Git).

No quedan problemas conocidos de esta implementación. Las comprobaciones de navegador y de preview utilizaron API simulada; no se ejecutaron operaciones contra una base de datos real ni pruebas del backend, que no se modificó en este trabajo.
