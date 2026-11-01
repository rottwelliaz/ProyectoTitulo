import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addDays, slotInstant } from '../src/lib/businessTime';
import { bookingAvailability } from './booking-fixture';

async function fixture(page: Page, theme = 'original', instant = '2030-01-07T11:00:00Z') {
  const state = { reserved: false, fail: false, empty: false, conflict: false, requests: [] as string[], bookings: [] as unknown[] };
  await page.clock.setFixedTime(new Date(instant));
  await page.addInitScript(theme => { localStorage.setItem('token', 'calendar-test'); localStorage.setItem('ui-theme', theme); }, theme);
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente de prueba' } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero de prueba' }, requiereComprobante: false, servicios: [
      { id: 'long', nombre_servicio: 'Corte completo', precio: 10000, duracion_minutos: 60 },
      { id: 'short', nombre_servicio: 'Barba', precio: 7000, duracion_minutos: 30 },
    ] }] });
    if (path.includes('/citas/disponibilidad/')) {
      state.requests.push(url.search);
      if (state.fail) return route.fulfill({ status: 503, json: { message: 'Agenda temporalmente no disponible.' } });
      const start = url.searchParams.get('fecha')!;
      const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
      const slots = state.empty ? [] : days.flatMap((day, i) => ['09:00', '10:00', '11:00', '12:00', '13:00'].flatMap((time, hour) =>
        (i + hour) % 3 === 0 && !(i === 0 && hour === 0 && state.reserved)
          ? [{ id: `${day}-${time}`, fecha_hora: slotInstant(day, Number(time.slice(0, 2)) * 60).toISOString() }] : []));
      const response = bookingAvailability(url.searchParams, slots);
      response.calendario.horas = ['09:00', '10:00', '11:00', '12:00', '13:00'];
      response.calendario.horarios = days.flatMap((fecha, i) => response.calendario.horas.map((hora, hour) => {
        const slot = slots.find(slot => slot.id === `${fecha}-${hora}`);
        const reserved = !state.empty && ((i + hour) % 3 === 1 || (i === 0 && hour === 0 && state.reserved));
        return { fecha, hora, fecha_hora: slotInstant(fecha, Number(hora.slice(0, 2)) * 60).toISOString(),
          estado: slot ? 'available' : reserved ? 'reserved' : 'unavailable',
          ...(slot ? { citaId: slot.id } : reserved ? {} : { motivo: 'duracion' }),
        };
      }));
      return route.fulfill({ json: response });
    }
    if (path.endsWith('/agendar')) {
      state.bookings.push(route.request().postDataJSON()); state.reserved = true;
      return route.fulfill({ status: state.conflict ? 409 : 200, json: state.conflict ? { message: 'Otra reserva ocupa este horario.' } : { id: 'reservation', estado: 'confirmada' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking');
  await page.locator('.booking-barber-card').click();
  await page.locator('.booking-service-card').filter({ hasText: 'Corte completo' }).click();
  await expect(page.locator('.booking-calendar-table')).toBeVisible();
  return state;
}

test('semana real, estados accesibles, selección azul y reserva sin comprobante', async ({ page }) => {
  const state = await fixture(page);
  expect(new URLSearchParams(state.requests[0]).get('vista')).toBe('semana');
  expect(new URLSearchParams(state.requests[0]).get('fecha')).toBe('2030-01-07');
  await expect(page.locator('.booking-calendar-table thead th')).toHaveCount(8);
  const available = page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Disponible', exact: true });
  await expect(page.getByRole('button', { name: 'lunes, 7 de enero, 10:00: Reservado', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /lunes, 7 de enero, 11:00: No disponible/ })).toBeDisabled();
  await available.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.booking-summary')).toContainText('lunes, 7 de enero');
  await page.getByRole('button', { name: 'Reservar ahora', exact: true }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Reservado', exact: true })).toBeDisabled();
  expect(state.bookings).toEqual([{ servicioId: 'long', comprobanteTransferencia: null, comprobanteNombre: null }]);
});

test('navegación semanal, fechas mensuales y regreso a hoy', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await expect.poll(() => new URLSearchParams(state.requests.at(-1)).get('fecha')).toBe('2030-01-14');
  await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
  await expect.poll(() => new URLSearchParams(state.requests.at(-1)).get('fecha')).toBe('2030-01-07');
  await page.locator('.booking-month-picker summary').click();
  await page.getByRole('button', { name: 'Mes siguiente', exact: true }).click();
  await page.getByRole('button', { name: 'miércoles, 6 de febrero de 2030', exact: true }).click();
  await expect.poll(() => new URLSearchParams(state.requests.at(-1)).get('fecha')).toBe('2030-02-04');
  await expect(page.locator('.booking-month-picker')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect.poll(() => new URLSearchParams(state.requests.at(-1)).get('fecha')).toBe('2030-01-07');
  await page.locator('.booking-month-picker summary').click();
  await page.getByRole('button', { name: 'Mes siguiente', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('.booking-month-picker summary')).toBeFocused();
});

test('actualizar conserva una selección válida y descarta la ocupada; error y reintento son explícitos', async ({ page }) => {
  const state = await fixture(page);
  await page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Disponible', exact: true }).click();
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.locator('.booking-calendar-cell.is-selected')).toBeVisible();
  state.reserved = true;
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.getByText(/El horario seleccionado dejó de estar disponible/)).toBeVisible();
  await expect(page.locator('.booking-summary')).toHaveCount(0);
  state.fail = true;
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page.locator('.booking-calendar-error')).toContainText('Agenda temporalmente no disponible.');
  state.fail = false; state.empty = true;
  await page.getByRole('button', { name: 'Volver a consultar agenda', exact: true }).click();
  await expect(page.getByText('No hay horas disponibles para este servicio en la semana consultada.')).toBeVisible();
});

test('conflicto al confirmar actualiza la agenda y permite escoger otra hora', async ({ page }) => {
  const state = await fixture(page); state.conflict = true;
  await page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Disponible', exact: true }).click();
  await page.getByRole('button', { name: 'Reservar ahora', exact: true }).click();
  await expect(page.getByText(/El horario dejó de estar disponible/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Reservado', exact: true })).toBeDisabled();
  await expect(page.locator('.booking-summary')).toHaveCount(0);
});

test('actualización automática y al volver a la ventana; una selección válida conserva el desplazamiento', async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await fixture(page);
  await page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Disponible', exact: true }).click();
  await page.clock.runFor(1000);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); });
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  const count = state.requests.length;
  await page.clock.fastForward(30_001);
  await expect.poll(() => state.requests.length).toBeGreaterThan(count);
  await expect(page.locator('.booking-availability')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  state.reserved = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Reservado', exact: true })).toBeDisabled();
  await expect(page.locator('.booking-summary')).toHaveCount(0);
});

for (const theme of ['original', 'light', 'dark']) for (const [width, height] of [[1920,1080],[1600,900],[1366,768],[1280,720],[768,1024],[390,844],[320,568]]) {
  test(`calendario ${theme} ${width}x${height}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await fixture(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const cells = page.locator('.booking-calendar-cell:visible');
    await expect(cells).toHaveCount(width > 760 ? 35 : 5);
    for (const box of await cells.evaluateAll(cells => cells.map(cell => cell.getBoundingClientRect().toJSON()))) {
      expect(box.height).toBeGreaterThanOrEqual(44); expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width);
    }
    if (width <= 760) {
      await page.locator('.booking-calendar-days button').nth(1).click();
      await expect(page.locator('.booking-calendar-table thead th:visible').last()).toContainText(/mar[,.]?\s+8/);
    }
    await page.locator('.booking-month-picker summary').click();
    const popover = await page.locator('.booking-month-popover').boundingBox();
    expect(popover!.x).toBeGreaterThanOrEqual(0); expect(popover!.x + popover!.width).toBeLessThanOrEqual(width);
    await page.keyboard.press('Escape');
    if ([1280,390].includes(width)) await page.locator('#horarios').screenshot({ path: info.outputPath('calendar.png') });
    if ([1280,390].includes(width)) {
      const axe = await new AxeBuilder({ page }).include('#horarios').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      expect(axe.violations).toEqual([]);
    }
  });
}

for (const timezoneId of ['UTC', 'Asia/Tokyo', 'America/Santiago']) {
  test.describe(`fechas futuras desde ${timezoneId}`, () => {
    test.use({ timezoneId });

    test('viernes parcial, semana siguiente completa, selector y reserva', async ({ page }) => {
      const state = await fixture(page, 'original', '2026-10-30T18:00:00Z'); // Friday 15:00 Santiago.
      const headers = page.locator('.booking-calendar-table thead th');
      await expect(headers).toHaveCount(4);
      await expect(headers.nth(1)).toContainText(/vie.*30/);
      await expect(headers.last()).toContainText(/dom.*1/);
      await expect(page.getByRole('button', { name: 'Semana anterior', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: /viernes, 30 de octubre, 09:00: No disponible/ })).toBeDisabled();
      // A past hour today must not remove future hours on Saturday.
      const saturday = page.getByRole('button', { name: 'sábado, 31 de octubre, 10:00: Disponible', exact: true });
      await expect(saturday).toBeEnabled();
      await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
      await expect(headers).toHaveCount(8);
      await expect(headers.nth(1)).toContainText(/lun.*2/);
      await expect.poll(() => new URLSearchParams(state.requests.at(-1)).get('fecha')).toBe('2026-11-02');
      await page.getByRole('button', { name: 'Semana anterior', exact: true }).click();
      await expect(headers).toHaveCount(4);
      await expect(page.locator('.booking-calendar-days .is-selected strong')).toHaveText('30');
      await page.locator('.booking-month-picker summary').click();
      await expect(page.getByRole('button', { name: 'jueves, 29 de octubre de 2026', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'viernes, 30 de octubre de 2026', exact: true })).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Mes anterior', exact: true })).toBeDisabled();
      await page.keyboard.press('Escape');
      await saturday.click();
      await page.getByRole('button', { name: 'Reservar ahora', exact: true }).click();
      await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
      expect(state.bookings).toHaveLength(1);
    });
  });
}

for (const [instant, nextInstant, firstDay, nextDay, expectedColumns] of [
  ['2026-10-31T02:59:59Z', '2026-10-31T03:00:00Z', '30', '31', 3],
  ['2026-11-02T02:59:59Z', '2026-11-02T03:00:00Z', '1', '2', 8],
  ['2027-01-01T02:59:59Z', '2027-01-01T03:00:00Z', '31', '1', 4],
] as const) {
  test(`cambio de día automático ${instant}`, async ({ page }) => {
    await page.clock.install();
    await fixture(page, 'original', instant);
    await expect(page.locator('.booking-calendar-days .is-selected strong')).toHaveText(firstDay);
    await page.clock.setSystemTime(new Date(nextInstant));
    await page.clock.runFor(1001);
    await expect(page.locator('.booking-calendar-table thead th')).toHaveCount(expectedColumns);
    await expect(page.locator('.booking-calendar-days .is-selected strong')).toHaveText(nextDay);
    await expect(page.getByRole('button', { name: 'Semana anterior', exact: true })).toBeDisabled();
  });
}

test('vence una selección sin interacción; el domingo oculta filas pasadas', async ({ page }) => {
  await page.clock.install();
  await fixture(page);
  await page.getByRole('button', { name: 'lunes, 7 de enero, 09:00: Disponible', exact: true }).click();
  await page.clock.setSystemTime(new Date('2030-01-07T12:00:00Z'));
  await page.clock.runFor(1001);
  await expect(page.locator('.booking-summary')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /lunes, 7 de enero, 09:00: No disponible/ })).toBeDisabled();
  await page.clock.setSystemTime(new Date('2030-01-13T13:00:00Z')); // Sunday 10:00.
  await page.clock.runFor(1001);
  await expect(page.locator('.booking-calendar-table thead th')).toHaveCount(2);
  await expect(page.locator('.booking-calendar-table tbody th')).toHaveText(['11:00', '12:00', '13:00']);
});

for (const width of [320, 390, 1280]) {
  test(`distribución de tres días a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, 'original', '2026-10-30T18:00:00Z');
    await expect(page.locator('.booking-calendar-days button')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    if (width <= 760) {
      const widths = await page.locator('.booking-calendar-days button').evaluateAll(buttons => buttons.map(b => b.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
      await page.locator('.booking-calendar-days button').nth(1).click();
      await expect(page.locator('.booking-calendar-table thead th:visible').last()).toContainText(/sáb.*31/);
    } else {
      const widths = await page.locator('.booking-calendar-table thead th:not(:first-child)').evaluateAll(cells => cells.map(c => c.getBoundingClientRect().width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1);
    }
  });
}
