import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, complete = true) {
  const state = { end: '2035-01-15T13:30:00.000Z', bookings: 0 };
  const start = '2035-01-15T13:00:00.000Z';
  await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('token', 'interval-test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 3, rol: 'cliente', nombre: 'Cliente prueba' } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero prueba' }, requiereComprobante: false, servicios: [{ id: 'cut', nombre_servicio: 'Corte', precio: 12000 }] }] });
    if (path.includes('/citas/disponibilidad/')) return route.fulfill({ json: {
      citas: [{ id: 'same-slot', fecha_hora: start, ...(complete ? { disponibleHasta: state.end } : {}) }],
      calendario: { dias: Array.from({ length: 7 }, (_, i) => `2035-01-${15 + i}`), horas: ['10:00'], horarios: [{ fecha: '2035-01-15', hora: '10:00', fecha_hora: start, estado: 'available', citaId: 'same-slot' }], zonaHoraria: 'America/Santiago', consultadoEn: start },
    } });
    if (path.endsWith('/agendar')) { state.bookings++; return route.fulfill({ json: { id: 'unexpected' } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking');
  await page.locator('.booking-barber-card').click();
  await page.locator('.booking-service-card').click();
  return state;
}

test('actualizar el final de un mismo bloque descarta la selección anterior', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: /lunes, 15 de enero, 10:00: Disponible/ }).click();
  await expect(page.locator('.booking-summary')).toContainText('10:00–10:30');
  state.end = '2035-01-15T14:00:00.000Z';
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.locator('.booking-summary')).toContainText('Fecha y horario pendientes.');
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
  await expect(page.getByText('El horario seleccionado dejó de estar disponible. Elige otra hora de la agenda actualizada.')).toBeVisible();
  expect(state.bookings).toBe(0);
});

test('sin final verificable no permite reservar ni inventa una hora de duración', async ({ page }) => {
  const state = await fixture(page, false);
  await expect(page.locator('.booking-calendar-error')).toContainText('La agenda no contiene intervalos completos');
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
  expect(state.bookings).toBe(0);
});
