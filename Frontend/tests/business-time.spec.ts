import { bookingAvailability } from './booking-fixture';
import { test, expect } from '@playwright/test';
import { addDays, businessDate, businessTime, dayStart, slotInstant, startOfWeek } from '../src/lib/businessTime';

test('fechas civiles, horas repetidas e inexistentes en Santiago', () => {
  expect(businessDate('2026-01-16T02:30:00Z')).toBe('2026-01-15');
  expect(businessDate('2026-07-16T03:30:00Z')).toBe('2026-07-15');
  expect(businessTime('2026-01-16T02:30:00Z')).toBe('23:30');
  expect(slotInstant('2026-01-15', 9 * 60).toISOString()).toBe('2026-01-15T12:00:00.000Z');
  expect(slotInstant('2026-07-15', 9 * 60).toISOString()).toBe('2026-07-15T13:00:00.000Z');
  expect(() => slotInstant('2026-09-06', 30)).toThrow();
  expect(() => slotInstant('2026-04-04', 23 * 60 + 30)).toThrow();
  expect(dayStart('2026-09-06').toISOString()).toBe('2026-09-06T04:00:00.000Z');
  expect(startOfWeek('2026-09-06')).toBe('2026-08-31');
  for (const [day, length] of [['2026-09-06', 23], ['2026-04-04', 25]] as const) {
    expect((dayStart(addDays(day, 1)).getTime() - dayStart(day).getTime()) / 3600000).toBe(length);
  }
});

for (const timezoneId of ['UTC', 'America/Santiago', 'Asia/Tokyo']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });

    test('semanas civiles al cruzar mes, año y horario de verano', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('token', 'test'));
      let query: URLSearchParams | undefined;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, nombre: 'Cliente', rol: 'cliente', aprobado: true } });
        if (url.pathname.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero' }, requiereComprobante: false, servicios: [{ id: 'cut', nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 30 }] }] });
        if (url.pathname.includes('/citas/disponibilidad/')) {
          query = url.searchParams;
          expect([...query.keys()].sort()).toEqual(['fecha', 'servicioId', 'vista']);
          return route.fulfill({ json: bookingAvailability(query, []) });
        }
        return route.fulfill({ json: [] });
      });
      for (const [today, monday] of [['2026-10-29', '2026-10-26'], ['2026-12-31', '2026-12-28'], ['2026-04-02', '2026-03-30'], ['2026-09-03', '2026-08-31']]) {
        await page.clock.setFixedTime(slotInstant(today, 9 * 60));
        await page.goto('/booking');
        await page.locator('.booking-barber-card').click();
        await page.locator('.booking-service-card').click();
        await expect.poll(() => query?.get('fecha')).toBe(monday);
        await expect(page.locator('.booking-calendar-table')).toBeVisible();
        expect(query?.get('vista')).toBe('semana');
        await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
        await expect.poll(() => query?.get('fecha')).toBe(addDays(monday, 7));
        await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
        await expect.poll(() => query?.get('fecha')).toBe(monday);
        await expect(page.getByRole('button', { name: 'Semana anterior', exact: true })).toBeDisabled();
        expect(query?.get('fecha')).toBe(monday);
        await expect(page.locator('.booking-calendar-error')).toHaveCount(0);
      }
    });

    test('fecha seleccionada, consulta y reserva nocturna usan Santiago', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-09-06T02:30:00Z')); // Saturday 23:30 in Chile
      await page.addInitScript(() => localStorage.setItem('token', 'test'));
      let query: URLSearchParams | undefined;
      let booked = false;
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, nombre: 'Cliente', rol: 'cliente', aprobado: true } });
        if (url.pathname.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero' }, requiereComprobante: false, servicios: [{ id: 'cut', nombre_servicio: 'Corte', precio: 10000, duracion_minutos: 30 }] }] });
        if (url.pathname.includes('/citas/disponibilidad/')) {
          query = url.searchParams;
          return route.fulfill({ json: bookingAvailability(query, [{ id: 'night', fecha_hora: '2026-09-07T02:30:00Z' }]) });
        }
        if (url.pathname.endsWith('/night/agendar')) { booked = true; return route.fulfill({ json: { id: 'reservation', estado: 'confirmada' } }); }
        return route.fulfill({ json: [] });
      });
      await page.goto('/booking');
      await page.locator('.booking-barber-card').click();
      await page.locator('.booking-service-card').click();
      await expect(page.locator('.booking-calendar-days .is-selected strong')).toHaveText('5');
      await expect.poll(() => query?.get('fecha')).toBe('2026-08-31');
      await page.locator('.booking-calendar-table thead button').last().click();
      expect(query?.get('fecha')).toBe('2026-08-31');
      expect(query?.has('desde')).toBe(false);
      expect(query?.has('hasta')).toBe(false);
      expect(query?.get('vista')).toBe('semana');
      await page.getByRole('button', { name: /domingo, 6 de septiembre, 23:30: Disponible/ }).click();
      await expect(page.locator('.booking-summary p')).toContainText('domingo, 6 de septiembre');
      await page.getByRole('button', { name: 'Reservar ahora' }).click();
      await expect.poll(() => booked).toBe(true);
      await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
    });

    test('agenda publica la semana de 167 horas y muestra citas del día chileno', async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-08-30T12:00:00Z'));
      await page.addInitScript(() => localStorage.setItem('token', 'test'));
      let payload: { fechaInicio: string; fechaFin: string; bloques: { inicio: string; fin: string }[] } | undefined;
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/profesional/calendario')) return route.fulfill({ json: { citas: [], bloqueos: [] } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 2, nombre: 'Barbero', rol: 'barbero', aprobado: true, perfilBarbero: { id: 10 } } });
        if (path.endsWith('/citas/mias')) return route.fulfill({ json: [{ id: 'night', fecha_hora: '2026-09-07T02:30:00Z', estado: 'confirmada', cliente: { nombre: 'Cliente' }, servicio: { nombre_servicio: 'Corte', duracion_minutos: 30 } }] });
        if (path.endsWith('/disponibilidad/semana')) { payload = route.request().postDataJSON(); return route.fulfill({ json: { citas: [] } }); }
        return route.fulfill({ json: [] });
      });
      await page.goto('/perfil-profesional');
      await page.locator('.pro-nav-link[href="#organizacion"]').click();
      await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
      await page.getByRole('button', { name: 'Guardar agenda', exact: true }).click();
      await expect.poll(() => payload?.fechaInicio).toBe('2026-08-31T04:00:00.000Z');
      expect(payload?.fechaFin).toBe('2026-09-07T03:00:00.000Z');
      expect(payload?.bloques.some(block => block.inicio === '2026-09-05T13:00:00.000Z')).toBe(true);
      expect(payload?.bloques.some(block => block.inicio === '2026-09-06T12:00:00.000Z')).toBe(true);
      await page.locator('.pro-nav-link[href="#mis-citas"]').click();
      await page.getByRole('tab', { name: 'Reservas' }).click();
      await expect(page.locator('.appointment-date strong')).toHaveText('06');
      await expect(page.locator('.appointment-date time')).toHaveText('23:30');
    });

    test('mis citas del cliente conserva el día anterior a medianoche UTC', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('token', 'test'));
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/profesional/calendario')) return route.fulfill({ json: { citas: [], bloqueos: [] } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, nombre: 'Cliente', email: 'test@example.com', rol: 'cliente', aprobado: true, fecha_creacion: '2025-01-01T12:00:00Z' } });
        if (path.endsWith('/cliente/mias')) return route.fulfill({ json: [{ id: 'night', fecha_hora: '2026-07-16T03:30:00Z', estado: 'confirmada', barbero: { usuario: { nombre: 'Barbero' } }, servicio: { nombre_servicio: 'Corte' } }] });
        return route.fulfill({ json: {} });
      });
      await page.goto('/perfil');
      await expect(page.locator('.client-appointment-date strong')).toHaveText('23:30');
      await expect(page.locator('.client-appointment-date span')).toContainText('15 de julio');
    });
  });
}
