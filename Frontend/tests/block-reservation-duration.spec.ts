import { test, expect } from '@playwright/test';
import { slotInstant, businessTime } from '../src/lib/businessTime';
import { fulfillDataTable } from './datatable-fixture';

for (const minutes of [30, 45, 60]) test(`reserva de ${minutes}: mismo bloque para cualquier servicio, resumen y Mis citas`, async ({ page }) => {
  const at = (minute: number) => slotInstant('2035-01-15', minute).toISOString();
  const start = at(630), end = at(630 + minutes), nextEnd = at(630 + minutes * 2);
  const bookings: any[] = [];
  let reserved = false;
  await page.clock.setFixedTime(new Date(at(480)));
  await page.addInitScript(() => localStorage.setItem('token', 'block-duration-client'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 3, rol: 'cliente', nombre: 'Cliente', fecha_creacion: at(480) } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero' }, requiereComprobante: false,
      servicios: [{ id: 'cut', nombre_servicio: 'Corte', precio: 10000 }, { id: 'beard', nombre_servicio: 'Barba', precio: 7000 }] }] });
    if (path.includes('/citas/disponibilidad/')) return route.fulfill({ json: {
      citas: [...(!reserved ? [{ id: 'first', fecha_hora: start, disponibleHasta: end }] : []), { id: 'next', fecha_hora: end, disponibleHasta: nextEnd }],
      calendario: { dias: Array.from({ length: 7 }, (_, i) => `2035-01-${15 + i}`), horas: [businessTime(start), businessTime(end)],
        horarios: [{ fecha: '2035-01-15', hora: businessTime(start), fecha_hora: start, estado: reserved ? 'reserved' : 'available', ...(!reserved ? { citaId: 'first' } : {}) },
          { fecha: '2035-01-15', hora: businessTime(end), fecha_hora: end, estado: 'available', citaId: 'next' }],
        configuracion: { startTime: '10:30', endTime: '13:30', blockMinutes: minutes }, zonaHoraria: 'America/Santiago', consultadoEn: at(480) },
    } });
    if (path.endsWith('/agendar')) { bookings.push(route.request().postDataJSON()); reserved = true; return route.fulfill({ json: { id: 'appointment', fecha_hora: start, duracionReservada: minutes } }); }
    if (path.endsWith('/cliente/mias')) return fulfillDataTable(route, { json: [{ id: 'appointment', fecha_hora: start, duracionReservada: minutes, estado: 'confirmada', servicio: { nombre_servicio: 'Barba', precio: 7000 }, barbero: { usuario: { nombre: 'Barbero' } } }] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking');
  await page.locator('.booking-barber-card').click();
  await expect(page.locator('.booking-service-card')).toHaveCount(2);
  await expect(page.locator('.booking-service-card em')).toHaveCount(0);
  await page.getByRole('button', { name: /lunes, 15 de enero, 10:30: Disponible/ }).click();
  for (const service of ['Corte', 'Barba']) {
    await page.locator('.booking-service-card').filter({ hasText: service }).click();
    await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
    await expect(page.locator('.booking-summary')).toContainText(`10:30–${businessTime(end)}`);
  }
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.locator('.booking-calendar-cell.is-reserved')).toHaveCount(1);
  await expect(page.locator('.booking-calendar-cell.is-available')).toHaveCount(1);
  expect(bookings).toEqual([{ servicioId: 'beard', fecha_hora: start, fin_hora: end, comprobanteTransferencia: null, comprobanteNombre: null }]);
  await page.goto('/mis-citas');
  await expect(page.locator('.client-appointment-item')).toHaveCount(1);
  await expect(page.locator('.client-appointment-date strong')).toHaveText(`10:30–${businessTime(end)}`);
});
