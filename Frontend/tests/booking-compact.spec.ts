import { test, expect, type Page } from '@playwright/test';
import { qualityFixture, profile, ready } from './quality-fixture';
import { bookingAvailability } from './booking-fixture';
import { slotInstant } from '../src/lib/businessTime';

async function fixture(page: Page, theme = 'original') {
  await qualityFixture(page, 'cliente', theme);
  const state = { barberQueries: 0, availability: [] as number[], bookings: [] as unknown[] };
  const barbers = Array.from({ length: 12 }, (_, index) => {
    const id = index + 10;
    return { ...profile, id, usuario: { id: id + 100, nombre: `Barbero ${id}` },
      servicios: Array.from({ length: 10 }, (_, service) => ({
        id: `${id}-${service}`, nombre_servicio: `Corte ${id}-${service}`,
        descripcion: `Descripción completa del servicio ${service}`, precio: 10000 + service * 1000,
      })),
    };
  });
  await page.route('**/api/citas/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/barberos')) {
      state.barberQueries++;
      return route.fulfill({ json: barbers });
    }
    if (url.pathname.includes('/disponibilidad/')) {
      const id = Number(url.pathname.split('/').pop());
      state.availability.push(id);
      const day = url.searchParams.get('fecha')!;
      return route.fulfill({ json: bookingAvailability(url.searchParams, Array.from({ length: 8 }, (_, i) => ({
        id: `slot-${id}-${i}`, fecha_hora: slotInstant(day, 660 + i * 45).toISOString(),
        disponibleHasta: slotInstant(day, 705 + i * 45).toISOString(),
      }))) });
    }
    if (url.pathname.endsWith('/agendar')) {
      state.bookings.push(route.request().postDataJSON());
      return route.fulfill({ json: { id: 'simulated-booking', estado: 'confirmada' } });
    }
    return route.fallback();
  });
  return state;
}

test.beforeEach(({ page }) => { page.on('pageerror', error => { throw error; }); });

for (const theme of ['original', 'light', 'dark']) {
  for (const [width, height] of [[1920, 1080], [1366, 768], [768, 1024], [390, 844], [320, 800]]) {
    test(`distribución equilibrada ${theme} ${width}x${height}`, async ({ page }, info) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height });
      await fixture(page, theme);
      await ready(page, '/booking');
      await expect(page.locator('.booking-barber-card')).toHaveCount(6);
      await expect(page.locator('.profile-nav [aria-current="page"]')).toHaveText('Reservar hora');
      await expect(page.locator('.booking-selection-hint')).toBeVisible();
      for (const id of ['servicios', 'horarios', 'confirmacion']) await expect(page.locator(`#${id}`)).toBeHidden();
      await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toHaveCount(0);
      const bounds = await page.locator('.booking-barbers').evaluate(list => ({
        overflow: list.scrollHeight > list.clientHeight + 1,
        cards: [...list.querySelectorAll('button')].map(card => card.getBoundingClientRect().height),
        columns: [...list.querySelectorAll('button')].filter(card => Math.abs(card.getBoundingClientRect().y - list.querySelector('button')!.getBoundingClientRect().y) < 1).length,
      }));
      expect(bounds.overflow).toBe(false);
      expect(bounds.columns).toBe(width >= 1366 ? 3 : width >= 768 ? 2 : 1);
      expect(Math.min(...bounds.cards)).toBeGreaterThanOrEqual(104);
      expect(Math.max(...bounds.cards)).toBeLessThanOrEqual(160);
      expect((await page.locator('.booking-avatar').first().boundingBox())!.width).toBeGreaterThanOrEqual(52);
      expect(await page.locator('.booking-barber-card em').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
      const options = (await page.locator('.booking-options').boundingBox())!;
      expect((await page.locator('.booking-options > section').first().boundingBox())!.width).toBeCloseTo(options.width, 0);
      await expect(page.getByRole('navigation', { name: 'Páginas de barberos' })).toContainText('Página 1 de 2');
      await page.screenshot({ path: info.outputPath('sin-barbero.png'), fullPage: true });
      await page.locator('.booking-barber-card').first().click();
      await expect(page.locator('.booking-barber-card')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Cambiar barbero', exact: true })).toBeVisible();
      await expect(page.locator('.booking-service-card')).toHaveCount(10);
      await expect(page.locator('.booking-calendar-table')).toBeVisible();
      await expect(page.locator('.booking-service-card.is-selected')).toHaveCount(0);
      const barberPanel = (await page.locator('.booking-options > section').first().boundingBox())!;
      const servicePanel = (await page.locator('#servicios').boundingBox())!;
      if (width >= 768) {
        expect(Math.abs(barberPanel.y - servicePanel.y)).toBeLessThan(1);
        expect(servicePanel.x).toBeGreaterThan(barberPanel.x + barberPanel.width);
      } else {
        expect(servicePanel.y).toBeGreaterThanOrEqual(barberPanel.y + barberPanel.height);
      }
      const selectedOptions = (await page.locator('.booking-options').boundingBox())!;
      const calendar = (await page.locator('#horarios').boundingBox())!;
      expect(calendar.width).toBeCloseTo(selectedOptions.width, 0);
      expect(calendar.y - selectedOptions.y - selectedOptions.height).toBeLessThanOrEqual(24);
      const confirmation = (await page.locator('#confirmacion').boundingBox())!;
      expect(confirmation.y - calendar.y - calendar.height).toBeLessThanOrEqual(24);
      const services = await page.locator('.booking-services').evaluate(list => ({ height: list.clientHeight, scroll: list.scrollHeight }));
      expect(services.height).toBeLessThanOrEqual(320);
      expect(services.scroll).toBeGreaterThan(services.height);
      expect((await page.locator('.booking-service-card').first().boundingBox())!.height).toBeGreaterThanOrEqual(88);
      expect(await page.locator('.booking-service-card small').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
      await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
      await page.screenshot({ path: info.outputPath('barbero-seleccionado.png'), fullPage: true });
      await page.locator('.booking-service-card').first().click();
      await page.locator('.booking-calendar-cell.is-available').first().click();
      await expect(page.locator('.booking-summary')).toContainText('Barbero 10 · Corte 10-0');
      const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
      await expect(confirm).toBeEnabled();
      await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const button = (await confirm.boundingBox())!;
      const sidebar = (await page.locator('.panel-sidebar').boundingBox())!;
      expect(button.y).toBeGreaterThanOrEqual(width > 1180 ? 0 : sidebar.y + sidebar.height - 1);
      await page.screenshot({ path: info.outputPath('confirmacion.png') });
    });
  }
}

test('el perfil elegido se muestra compacto y cambiarlo reutiliza la lista ya consultada', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const state = await fixture(page);
  await ready(page, '/booking?barbero=10');
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await expect(page.locator('.booking-barber-card')).toContainText('Barbero 10');
  await page.locator('.booking-service-card').first().click();
  await page.locator('.booking-calendar-cell.is-available').first().click();
  await page.getByRole('button', { name: 'Cambiar barbero', exact: true }).click();
  await expect(page.locator('.booking-barber-card')).toHaveCount(6);
  await expect(page.locator('.booking-service-card.is-selected')).toHaveCount(1);
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cerrar selección', exact: true }).click();
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cambiar barbero', exact: true }).click();
  await page.getByLabel('Buscar barbero o barbería').fill('Barbero 20');
  await page.locator('.booking-barber-card').click();
  await expect(page).toHaveURL(/barbero=20$/);
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await expect(page.locator('.booking-barber-card')).toContainText('Barbero 20');
  await expect(page.locator('.booking-service-card').first()).toContainText('Corte 20-0');
  await expect(page.locator('.booking-service-card.is-selected')).toHaveCount(0);
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirmar reserva', exact: true })).toBeDisabled();
  await expect.poll(() => state.availability.at(-1)).toBe(20);
  expect(state.barberQueries).toBe(1);
  await page.reload();
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Barbero 20');
});

test('paginación y teclado permiten elegir al último barbero y servicio sin repetir consultas', async ({ page }) => {
  const state = await fixture(page);
  await ready(page, '/booking');
  await page.getByRole('button', { name: 'Página siguiente de barberos', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Páginas de barberos' })).toContainText('Página 2 de 2');
  await expect(page.getByRole('button', { name: 'Página siguiente de barberos', exact: true })).toBeDisabled();
  const barber = page.locator('.booking-barber-card').last();
  await barber.focus();
  await page.keyboard.press('Enter');
  await expect(barber).toHaveAttribute('aria-pressed', 'true');
  const service = page.locator('.booking-service-card').last();
  await service.focus();
  await page.keyboard.press('Enter');
  await expect(service).toHaveAttribute('aria-pressed', 'true');
  expect(await page.locator('.booking-services').evaluate(list => list.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Cambiar barbero', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Páginas de barberos' })).toContainText('Página 2 de 2');
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Barbero 21');
  await page.getByLabel('Buscar barbero o barbería').fill('Barbero 10');
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await expect(page.locator('.booking-barber-card')).toContainText('Barbero 10');
  await expect(page.getByRole('navigation', { name: 'Páginas de barberos' })).toHaveCount(0);
  expect(state.barberQueries).toBe(1);
});

test('el calendario conserva navegación semanal y confirma con el resumen horizontal', async ({ page }) => {
  const state = await fixture(page);
  await ready(page, '/booking?barbero=20');
  await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await expect(page.locator('.booking-week-nav strong')).toContainText('14 ene');
  await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
  await expect(page.locator('.booking-week-nav strong')).toContainText('7 ene');
  await page.locator('.booking-service-card').first().click();
  await page.locator('.booking-calendar-cell.is-available').first().click();
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.bookings).toHaveLength(1);
});
