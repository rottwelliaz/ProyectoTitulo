import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { bookingAvailability } from './booking-fixture';

async function fixture(page: Page, url = '/booking?barbero=20') {
  const state = { requests: [] as number[], bookings: [] as any[], delay: 0 };
  await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('token', 'direct-flow'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 3, rol: 'cliente', nombre: 'Cliente' } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [10, 20].map(id => ({ id,
      usuario: { nombre: `Barbero ${id}` }, lugarTrabajo: { nombre_barberia: `Club ${id}`, direccion: `Dirección ${id}` },
      foto_perfil: null, requiereComprobante: false, servicios: [
        { id: `cut-${id}`, nombre_servicio: 'Corte', descripcion: 'Corte clásico', precio: 10000 },
        { id: `beard-${id}`, nombre_servicio: 'Barba', descripcion: 'Perfilado', precio: 7000 },
      ],
    })) });
    if (path.includes('/citas/disponibilidad/')) {
      const id = Number(path.split('/').pop());
      state.requests.push(id);
      if (id === 10 && state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
      return route.fulfill({ json: bookingAvailability(url.searchParams, [
        { id: `${id}-first`, fecha_hora: '2035-01-15T13:00:00Z' },
        { id: `${id}-last`, fecha_hora: '2035-01-15T13:30:00Z' },
      ]) });
    }
    if (path.endsWith('/agendar')) {
      state.bookings.push({ path, ...route.request().postDataJSON() });
      await new Promise(resolve => setTimeout(resolve, 150));
      return route.fulfill({ json: { id: 'reserved', estado: 'confirmada' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto(url);
  return state;
}

test('perfil conserva barbero, muestra servicios, calendario y confirmación sin interacción', async ({ page }) => {
  const state = await fixture(page);
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await expect(page.locator('.booking-barber-card')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.booking-barber-card')).toContainText('Barbero 20');
  await expect(page.locator('.booking-barber-card')).toContainText('Club 20');
  await expect(page.locator('.booking-barber-card')).toContainText('Dirección 20');
  await expect(page.locator('.booking-service-card')).toHaveCount(2);
  await expect(page.locator('.booking-calendar-table')).toBeVisible();
  await expect(page.locator('#confirmacion')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
  expect(state.requests).toEqual([20]);
  // Clicking the already selected professional must not reset the flow.
  await page.locator('.booking-calendar-cell.is-available').first().click();
  await page.locator('.booking-service-card').first().click();
  await page.locator('.booking-barber-card').click();
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
  await expect(page.locator('.booking-service-card.is-selected')).toHaveCount(1);
});

for (const order of ['servicio primero', 'horario primero']) test(`selección libre: ${order}, cambios sin reinicio y envío único`, async ({ page }) => {
  const state = await fixture(page);
  const services = page.locator('.booking-service-card');
  const first = page.getByRole('button', { name: /lunes, 15 de enero, 10:00: Disponible/ });
  const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
  await expect(first).toBeVisible();
  if (order === 'servicio primero') { await services.first().click(); await expect(confirm).toBeDisabled(); await first.click(); }
  else { await first.click(); await expect(confirm).toBeDisabled(); await services.first().click(); }
  await expect(confirm).toBeEnabled();
  await services.last().click();
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
  await expect(page.locator('.booking-summary')).toContainText('$7.000');
  await page.getByRole('button', { name: /lunes, 15 de enero, 10:30: Disponible/ }).click();
  await expect(services.last()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.booking-summary')).toContainText('10:30–11:00');
  await confirm.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.bookings).toEqual([{ path: '/api/citas/20-last/agendar', servicioId: 'beard-20', fecha_hora: '2035-01-15T13:30:00Z', fin_hora: '2035-01-15T14:00:00.000Z', comprobanteTransferencia: null, comprobanteNombre: null }]);
});

test('cambiar de barbero descarta la agenda anterior y sus respuestas tardías', async ({ page }) => {
  const state = await fixture(page, '/booking');
  state.delay = 500;
  await page.locator('.booking-barber-card').first().click();
  await expect.poll(() => state.requests.includes(10)).toBe(true);
  await page.getByRole('button', { name: 'Cambiar barbero', exact: true }).click();
  await page.locator('.booking-barber-card').last().click();
  await page.locator('.booking-calendar-cell.is-available').first().click();
  await page.locator('.booking-service-card').last().click();
  await page.waitForTimeout(550);
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
  await expect(page.locator('#horarios')).toContainText('Agenda de Barbero 20');
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.bookings[0]).toMatchObject({ path: '/api/citas/20-first/agendar', servicioId: 'beard-20' });
});

test('un perfil inexistente ofrece el selector y solo muestra el flujo tras elegir otro profesional', async ({ page }) => {
  await fixture(page, '/booking?barbero=999');
  await expect(page.getByRole('alert')).toContainText('El barbero seleccionado no está disponible');
  for (const id of ['servicios', 'horarios', 'confirmacion']) await expect(page.locator(`#${id}`)).toBeHidden();
  await expect(page.locator('.booking-barber-card.is-selected')).toHaveCount(0);
  await page.locator('.booking-barber-card').first().click();
  for (const id of ['servicios', 'horarios', 'confirmacion']) await expect(page.locator(`#${id}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
});

for (const theme of ['light', 'dark']) for (const width of [390, 768, 1280]) test(`flujo completo ${theme} a ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(theme => localStorage.setItem('ui-theme', theme), theme);
  await fixture(page);
  await expect(page.locator('.booking-calendar-table')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator('.booking-service-card')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('booking-flow.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).include('.booking-root').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(axe.violations).toEqual([]);
});
