import { test, expect, type Page, type Route } from '@playwright/test';
import { tableResponse } from './datatable-fixture';
import { slotInstant } from '../src/lib/businessTime';

const firstWeek = '2035-01-15';
const at = (minutes: number, day = firstWeek) => slotInstant(day, minutes).toISOString();
const configuration = { startTime: '09:00', endTime: '11:00', blockMinutes: 30 };
const fulfillDataTable = (route: Route, options: Parameters<Route['fulfill']>[0]) => route.fulfill({ ...options, ...(options?.json !== undefined ? { json: tableResponse(new URL(route.request().url()), options.json, +new Date(at(480))) } : {}) });
async function fixture(page: Page, duration = 0, theme = 'light', initialConfiguration = configuration) {
  await page.clock.setFixedTime(new Date(at(8 * 60)));
  await page.addInitScript(theme => { localStorage.setItem('token', 'schedule-test'); localStorage.setItem('ui-theme', theme); }, theme);
  const state = { writes: [] as any[], fail: false, cancellations: 0, weeks: {} as Record<string, any> };
  const reservation = { id: 'appointment', fecha_hora: at(540), duracionReservada: duration, fin: at(540 + duration), estado: 'confirmada', cliente: { id: 3, nombre: 'Cliente agenda', telefono: null }, servicio: { id: 'service', nombre_servicio: 'Servicio agenda' } };
  if (duration) state.weeks[firstWeek] = { citas: [{ id: 'window', estado: 'disponible', fecha_hora: at(540), disponibleHasta: at(660) }, reservation], bloqueos: [], publicada: true, configuracion: initialConfiguration, revision: 'v0' };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return fulfillDataTable(route, { json: { id: 2, rol: 'barbero', nombre: 'Barbero agenda', aprobado: true, activo: true, perfilBarbero: { id: 10, requiereComprobante: false } } });
    if (path.endsWith('/profesional/calendario')) {
      const data = state.weeks[url.searchParams.get('desde')!] || { citas: [], bloqueos: [], configuracion: initialConfiguration, publicada: false, revision: 'empty' };
      const available = duration && data.publicada ? [{ inicio: reservation.estado === 'cancelada' ? at(540) : at(540 + duration), fin: at(660) }] : [];
      return fulfillDataTable(route, { json: { ...data, disponibilidad: available } });
    }
    if (path.endsWith('/disponibilidad/semana')) {
      const body = route.request().postDataJSON(); state.writes.push(body);
      if (state.fail) return fulfillDataTable(route, { status: 500, json: { message: 'No se pudieron guardar los horarios.' } });
      state.weeks[body.fechaInicio.slice(0, 10)] = { citas: body.bloques.map((b: any, i: number) => ({ id: 'w' + i, fecha_hora: b.inicio, disponibleHasta: b.fin, estado: 'disponible' })), bloqueos: body.bloqueos.map((b: any, i: number) => ({ id: 'b' + i, ...b, origen: 'agenda' })), publicada: true, revision: 'v' + state.writes.length, configuracion: body.configuracion };
      return fulfillDataTable(route, { json: { citas: [], omittedOccupiedBlocks: 0 } });
    }
    if (path.endsWith('/appointment/estado')) { state.cancellations++; reservation.estado = 'cancelada'; return fulfillDataTable(route, { json: reservation }); }
    if (path.endsWith('/citas/mias')) return fulfillDataTable(route, { json: duration ? [reservation] : [] });
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto('/perfil-profesional#organizacion');
  await expect(page.locator('#disponibilidad-profesional .barber-slot').first()).toBeEnabled({ enabled: !duration });
  return state;
}

test('borrador, error de guardado, persistencia, descarte con SweetAlert y semana vacía', async ({ page }) => {
  const state = await fixture(page), calendar = page.locator('#disponibilidad-profesional');
  await expect(calendar.locator('.barber-slot.is-unconfigured')).toHaveCount(28);
  expect(await calendar.locator('.calendar-time-column time').allTextContents()).toEqual(['09:00', '09:30', '10:00', '10:30']);
  await calendar.locator('.barber-slot').first().click();
  await page.getByRole('button', { name: 'Disponible', exact: true }).click();
  await expect(calendar.locator('.is-pending.barber-slot')).toHaveCount(1); expect(state.writes).toHaveLength(0);
  state.fail = true; await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.getByText('No se pudieron guardar los horarios.')).toBeVisible();
  await expect(calendar.locator('.is-pending.barber-slot')).toHaveCount(1);
  await expect(page.locator('.swal2-popup')).toContainText('No se pudieron guardar los horarios.');
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  state.fail = false; await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.is-pending.barber-slot')).toHaveCount(0);
  expect(state.writes[1].bloques).toHaveLength(1);
  expect(+new Date(state.writes[1].bloques[0].fin) - +new Date(state.writes[1].bloques[0].inicio)).toBe(1800000);
  await page.reload(); await expect(calendar.locator('.barber-slot.is-available')).toHaveCount(1);
  await calendar.locator('.barber-slot').first().click(); await page.getByRole('button', { name: 'Descanso', exact: true }).click();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await expect(page.locator('.swal2-popup')).toContainText('cambios pendientes');
  await page.locator('.swal2-cancel').click(); await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(1);
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await page.locator('.swal2-cancel').click(); await expect(calendar).toBeVisible();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click(); await page.locator('.swal2-confirm').click();
  await expect(calendar.locator('.barber-slot.is-unconfigured')).toHaveCount(28);
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Semana anterior', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-available')).toHaveCount(1);
});

for (const duration of [30, 60]) for (const theme of ['light', 'dark']) test(`cita de ${duration} minutos, cancelar y sincronizar, tema ${theme}`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const state = await fixture(page, duration, theme), calendar = page.locator('#disponibilidad-profesional');
  await expect(calendar.locator('.barber-slot.is-reserved')).toHaveCount(duration / 30);
  await expect(calendar.locator('.calendar-day').first().locator('.barber-slot.is-available')).toHaveCount(4 - duration / 30);
  await expect(calendar.locator('.barber-slot.is-reserved').first()).toContainText(`09:00–${duration === 30 ? '09:30' : '10:00'}`);
  await calendar.screenshot({ path: info.outputPath('organizacion.png') });
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await page.getByRole('button', { name: 'Ver cita', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Detalle de la cita' });
  await expect(details).toContainText('Cliente agenda'); await expect(details).toContainText('Servicio agenda');
  await details.getByRole('button', { name: 'Cancelar cita', exact: true }).click();
  await expect(page.locator('.swal2-title')).toHaveText('¿Cancelar esta cita?');
  await page.getByRole('button', { name: 'Volver', exact: true }).click(); expect(state.cancellations).toBe(0);
  await details.getByRole('button', { name: 'Cancelar cita', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cancelar cita', exact: true }).click();
  await expect(details).toHaveCount(0); expect(state.cancellations).toBe(1);
  await expect(page.locator('.professional-event.is-cancelada')).toContainText('Cancelada');
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  await expect(calendar.locator('.barber-slot.is-reserved')).toHaveCount(0);
  await expect(calendar.locator('.calendar-day').first().locator('.barber-slot.is-available')).toHaveCount(4);
  await page.setViewportSize({ width: 390, height: 844 });
  await calendar.screenshot({ path: info.outputPath('organizacion-mobile.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('cambiar configuración conserva el borrador y pegar otra semana requiere guardar', async ({ page }) => {
  const state = await fixture(page), calendar = page.locator('#disponibilidad-profesional');
  await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('10:00');
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(14);
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Copiar semana', exact: true }).click();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await calendar.getByRole('button', { name: 'Pegar aquí', exact: true }).click();
  await page.locator('.swal2-confirm').click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(14); expect(state.writes).toHaveLength(1);
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  expect(state.writes[1].bloques).toHaveLength(14);
});

test('cita histórica de 45 minutos conserva su intervalo y marca la segunda fila como continuación', async ({ page }) => {
  await fixture(page, 45);
  const reserved = page.locator('#disponibilidad-profesional .barber-slot.is-reserved');
  await expect(reserved).toHaveCount(2);
  await expect(reserved.nth(1)).toHaveAttribute('title', /Ocupación parcial/);
  await expect(reserved.nth(1)).toHaveAttribute('style', /50%/);
  await expect(reserved.nth(1)).toContainText('09:00–09:45');
  await expect(reserved.nth(1)).toContainText('Continuación de reserva');
  await expect(reserved.locator('.slot-reservation-client')).toHaveCount(1);
});

test('inicio de media hora dentro de ventana larga conserva selección, pago y reserva', async ({ page }) => {
  await page.clock.setFixedTime(new Date(at(480)));
  await page.addInitScript(() => localStorage.setItem('token', 'schedule-client'));
  let payment: any, booking: any;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 3, rol: 'cliente', nombre: 'Cliente', aprobado: true } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero' }, requiereComprobante: true, servicios: [{ id: 'cut', nombre_servicio: 'Corte', precio: 10000 }] }] });
    if (path.includes('/citas/disponibilidad/')) return route.fulfill({ json: { citas: [{ id: 'window@half', slotId: 'window', fecha_hora: at(570), disponibleHasta: at(600) }], servicios: [], calendario: { dias: Array.from({ length: 7 }, (_, i) => '2035-01-' + (15 + i)), horas: ['09:30'], horarios: [{ fecha: firstWeek, hora: '09:30', fecha_hora: at(570), estado: 'available', citaId: 'window@half' }], zonaHoraria: 'America/Santiago', consultadoEn: at(480) } } });
    if (path.endsWith('/window/pago')) { payment = route.request().postDataJSON(); return route.fulfill({ json: { citaId: 'window', servicioId: 'cut', barberoId: 10, bancoNombre: 'Titular', bancoRut: '11111111-1', bancoNombreBanco: 'Banco de prueba', bancoTipoCuenta: 'Vista', bancoNroCuenta: '123456', bancoCorreo: 'test@example.com' } }); }
    if (path.endsWith('/window/agendar')) { booking = route.request().postDataJSON(); return route.fulfill({ json: { id: 'booked', estado: 'confirmada' } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking'); await page.locator('.booking-barber-card').click(); await page.locator('.booking-service-card').click();
  await page.getByRole('button', { name: /lunes, 15 de enero, 09:30: Disponible/ }).click();
  await expect(page.getByText('Banco de prueba', { exact: true })).toBeVisible();
  expect(payment).toEqual({ servicioId: 'cut', fecha_hora: at(570), fin_hora: at(600) });
  await page.locator('.booking-proof-field input').setInputFiles('tests/fixtures/profile.png');
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(booking.fecha_hora).toBe(at(570)); expect(booking.servicioId).toBe('cut');
});

for (const theme of ['light', 'dark']) test(`bloques 30, 45 y 60: origen real, persistencia y alineación en ${theme}`, async ({ page }, info) => {
  const state = await fixture(page, 0, theme, { startTime: '08:30', endTime: '12:30', blockMinutes: 30 });
  const calendar = page.locator('#disponibilidad-profesional'), duration = calendar.getByLabel('Duración de cada bloque', { exact: true });
  expect(await duration.locator('option').allTextContents()).toEqual(['30 min', '45 min', '60 min']);
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('19:30');
  await expect(calendar.locator('.calendar-day').first().locator('.barber-slot')).toHaveCount(22);
  const longDayHeights = await calendar.locator('.barber-slot').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
  expect(Math.max(...longDayHeights) - Math.min(...longDayHeights)).toBeLessThan(1);
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('12:30');
  for (const [minutes, times] of [
    ['30', ['08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00']],
    ['45', ['08:30','09:15','10:00','10:45','11:30']],
    ['60', ['08:30','09:30','10:30','11:30']],
  ] as const) {
    await duration.selectOption(minutes);
    expect(await calendar.locator('.calendar-time-column time').allTextContents()).toEqual([...times]);
    expect(new Set(await calendar.locator('.barber-slot').evaluateAll(elements => elements.map(el => el.getAttribute('aria-label')))).size).toBe(times.length * 7);
    await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
    const cells = calendar.locator('.calendar-day').first().locator('.barber-slot');
    await cells.first().click(); await page.getByRole('button', { name: 'Descanso', exact: true }).click();
    await cells.nth(1).click(); await page.getByRole('button', { name: 'Bloqueado', exact: true }).click();
    const heights = await calendar.locator('.barber-slot').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
    const columns = await calendar.locator('.calendar-day').evaluateAll(elements => elements.map(el => Array.from(el.querySelectorAll('.barber-slot')).map(cell => cell.getBoundingClientRect().top)));
    for (const column of columns) column.forEach((top, row) => expect(Math.abs(top - columns[0][row])).toBeLessThan(1));
    await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
    await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
    const body = state.writes.at(-1);
    expect(body.configuracion.blockMinutes).toBe(Number(minutes));
    for (const block of [...body.bloques, ...body.bloqueos]) expect(+new Date(block.fin) - +new Date(block.inicio)).toBeLessThanOrEqual(Number(minutes) * 60000);
    await page.reload(); await expect(duration).toHaveValue(minutes);
    await page.locator('.pro-nav-link[href="#mis-citas"]').click(); await page.locator('.pro-nav-link[href="#organizacion"]').click();
    await expect(duration).toHaveValue(minutes);
    if (minutes === '45') {
      await calendar.screenshot({ path: info.outputPath(`bloques-45-${theme}.png`) });
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const mobileHeights = await calendar.locator('.barber-slot').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().height));
      expect(Math.max(...mobileHeights) - Math.min(...mobileHeights)).toBeLessThan(1);
      await page.screenshot({ path: info.outputPath(`bloques-45-mobile-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  }
  await duration.selectOption('45'); await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await page.reload(); await expect(duration).toHaveValue('45');
  await duration.selectOption('30'); await expect(calendar.locator('.barber-slot.is-pending').first()).toBeVisible();
  await duration.selectOption('60'); await expect(calendar.locator('.calendar-time-column time')).toHaveCount(4);
  await calendar.screenshot({ path: info.outputPath(`bloques-${theme}.png`) });
});

test('un borrador de 30 minutos no se amplía al seleccionar 45, y el cierre nunca se sobrepasa', async ({ page }) => {
  const state = await fixture(page), calendar = page.locator('#disponibilidad-profesional');
  await calendar.locator('.barber-slot').first().click(); await page.getByRole('button', { name: 'Disponible', exact: true }).click();
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('45');
  await expect(calendar.locator('.barber-slot').first()).toHaveAttribute('title', /Disponibilidad parcial/);
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  expect(state.writes[0].bloques).toEqual([{ inicio: at(540), fin: at(570) }]);
  await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect.poll(() => state.writes.length).toBe(2);
  const monday = state.writes[1].bloques.filter((b: any) => b.inicio.slice(0, 10) === firstWeek);
  expect(monday).toEqual([{ inicio: at(540), fin: at(585) }, { inicio: at(585), fin: at(630) }]);
});

test('cambiar 30 → 45 → 60 conserva las reservas y las horas pasadas inhabilitadas', async ({ page }) => {
  await fixture(page, 60);
  const calendar = page.locator('#disponibilidad-profesional');
  for (const minutes of ['45', '60', '30']) {
    await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption(minutes);
    await expect(calendar.locator('.barber-slot.is-reserved').first()).toContainText('09:00–10:00');
    await expect(calendar.locator('.barber-slot.is-reserved').first()).toBeDisabled();
  }
  await page.clock.setFixedTime(new Date(at(555)));
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('45');
  await expect(calendar.locator('.calendar-day').first().locator('.barber-slot').first()).toBeDisabled();
});

for (const minutes of [30, 45, 60]) for (const theme of ['light', 'dark']) test(`pendiente complementario: ${minutes} minutos en ${theme}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  const state = await fixture(page, 0, theme, { startTime: '09:00', endTime: '13:00', blockMinutes: minutes });
  const calendar = page.locator('#disponibilidad-profesional'), monday = calendar.locator('.calendar-day').first();
  await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
  const cells = monday.locator('.barber-slot');
  for (const [index, label] of [[1, 'Bloqueado'], [2, 'Descanso'], [3, 'Sin configurar']] as const) {
    await cells.nth(index).click(); await page.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(cells.nth(0)).toHaveClass(/is-available.*is-pending/);
  await expect(cells.nth(1)).toHaveClass(/is-booking.*is-pending/);
  await expect(cells.nth(2)).toHaveClass(/is-break.*is-pending/);
  // Clearing an initially unconfigured row reverts its actual edit. A setting
  // change marks even an unconfigured row, without giving it another color.
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('13:30');
  await expect(cells.nth(3)).toHaveClass(/is-unconfigured.*is-pending/);
  await expect(calendar.locator('.calendar-pending-message')).toHaveText('Cambios pendientes de guardar');
  await expect(cells.nth(0)).toHaveCSS('background-image', /rgb\(22, 128, 58\)/);
  await expect(cells.nth(1)).toHaveCSS('background-image', /rgb\(18, 97, 216\)/);
  await expect(cells.nth(2)).toHaveCSS('background-image', /rgb\(242, 194, 48\)/);
  await expect(cells.nth(3)).toHaveCSS('background-color', 'rgb(88, 100, 116)');
  const border = await cells.nth(0).evaluate(el => {
    const style = getComputedStyle(el, '::after');
    return { border: style.borderTopStyle, background: style.backgroundColor, pointerEvents: style.pointerEvents };
  });
  expect(border).toEqual({ border: 'dashed', background: 'rgba(0, 0, 0, 0)', pointerEvents: 'none' });
  await expect(cells.nth(0)).not.toContainText('Pendiente');
  await expect(cells.nth(0)).toHaveAttribute('title', /Cambio pendiente de guardar/);
  await expect(cells.nth(0).locator(':scope > span, :scope > small')).toHaveCount(2);
  const appearance = () => cells.evaluateAll(elements => elements.map(el => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, image: style.backgroundImage, color: style.color, height: el.getBoundingClientRect().height };
  }));
  const before = await appearance();
  const geometry = await calendar.locator('.calendar-day').evaluateAll(days => days.map(day => Array.from(day.querySelectorAll('.barber-slot')).map(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height }))));
  for (const column of geometry) column.forEach((cell, index) => { expect(cell.height).toBe(38); expect(Math.abs(cell.top - geometry[0][index].top)).toBeLessThan(1.1); });
  await calendar.screenshot({ path: info.outputPath(`pendiente-${minutes}-${theme}.png`) });
  state.fail = true; await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(page.locator('.swal2-popup')).toContainText('No se pudieron guardar los horarios.');
  await expect(cells.nth(0)).toHaveClass(/is-pending/); expect(await appearance()).toEqual(before);
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  state.fail = false; await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  expect(await appearance()).toEqual(before);
  expect(state.writes.at(-1).configuracion.blockMinutes).toBe(minutes);
  await page.reload(); await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue(String(minutes));
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await expect(monday.locator('.barber-slot.is-booking')).toHaveCount(1);
  await expect(monday.locator('.barber-slot.is-break')).toHaveCount(1);
});

test('fila de 60 minutos combina reserva y edición pendiente sin ocultar sus colores ni detalles', async ({ page }, info) => {
  await fixture(page, 30);
  const calendar = page.locator('#disponibilidad-profesional'), monday = calendar.locator('.calendar-day').first();
  await monday.locator('.barber-slot').nth(1).click(); await page.getByRole('button', { name: 'Bloqueado', exact: true }).click();
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('60');
  const reserved = monday.locator('.barber-slot').first();
  await expect(reserved).toHaveClass(/is-reserved.*is-pending/);
  await expect(reserved).toBeDisabled();
  await expect(reserved).toHaveCSS('background-image', /rgb\(239, 68, 68\).*50%.*rgb\(18, 97, 216\)/);
  await expect(reserved.locator('.slot-reservation-client')).toHaveText('Cliente agenda');
  await expect(reserved.locator('.slot-reservation-service')).toHaveText('Servicio agenda');
  await expect(reserved.locator('.slot-time')).toHaveText('09:00–09:30');
  await expect(reserved).toHaveAttribute('title', /Cliente agenda.*Servicio agenda.*09:00–09:30.*Cambio pendiente/);
  await expect(reserved).toHaveCSS('height', '38px');
  const contained = await reserved.evaluate(el => {
    const box = el.getBoundingClientRect();
    return Array.from(el.querySelectorAll('span, small')).every(child => {
      const rect = child.getBoundingClientRect();
      return rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom;
    });
  });
  expect(contained).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('pendiente-reserva-60-mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('deshacer una edición elimina la marca y el aviso global sin guardar', async ({ page }) => {
  await fixture(page);
  const calendar = page.locator('#disponibilidad-profesional'), first = calendar.locator('.barber-slot').first();
  await first.click(); await page.getByRole('button', { name: 'Disponible', exact: true }).click();
  await expect(first).toHaveClass(/is-pending/);
  await first.click(); await page.getByRole('button', { name: 'Sin configurar', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  await expect(calendar).not.toContainText('Hay cambios pendientes');
});

for (const pendingMinutes of [30, 45, 60]) test(`una recarga iniciada antes de editar conserva la duración pendiente de ${pendingMinutes} minutos`, async ({ page }) => {
  await fixture(page, 0, 'light', { startTime: '09:00', endTime: '11:00', blockMinutes: pendingMinutes === 30 ? 60 : 30 });
  const calendar = page.locator('#disponibilidad-profesional'), duration = calendar.getByLabel('Duración de cada bloque', { exact: true });
  let release!: () => void, received = 0;
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/profesional/calendario')) { received++; await responseGate; }
    await route.fallback();
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => received).toBeGreaterThan(0);
  await expect(duration).toBeDisabled();
  // A native select change can already be queued when the focus refresh starts.
  // Dispatch that event while the previous server response is still in flight.
  await duration.evaluate((element: HTMLSelectElement, minutes) => { element.value = String(minutes); element.dispatchEvent(new Event('change', { bubbles: true })); }, pendingMinutes);
  await expect(duration).toHaveValue(String(pendingMinutes));
  await expect(calendar.locator('.calendar-pending-message')).toBeVisible();
  release();
  await expect(calendar.getByRole('button', { name: 'Habilitar semana', exact: true })).toBeEnabled();
  await expect(duration).toHaveValue(String(pendingMinutes));
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(Math.floor(120 / pendingMinutes) * 7);
});

for (const savedMinutes of [30, 45, 60]) for (const theme of ['light', 'dark']) test(`pendientes al cambiar y volver a la duración guardada ${savedMinutes}, tema ${theme}`, async ({ page }) => {
  const state = await fixture(page, 0, theme, { startTime: '09:00', endTime: '13:00', blockMinutes: savedMinutes });
  const calendar = page.locator('#disponibilidad-profesional'), duration = calendar.getByLabel('Duración de cada bloque', { exact: true });
  // A completely published green week exposes false "already saved" states.
  state.weeks[firstWeek] = { publicada: true, revision: 'saved', configuracion: { startTime: '09:00', endTime: '13:00', blockMinutes: savedMinutes }, bloqueos: [], citas: Array.from({ length: 7 }, (_, day) => ({ id: 'window-' + day, estado: 'disponible', fecha_hora: at(540, '2035-01-' + (15 + day)), disponibleHasta: at(780, '2035-01-' + (15 + day)) })) };
  await calendar.getByRole('button', { name: 'Recargar semana', exact: true }).click();
  await expect(duration).toHaveValue(String(savedMinutes));
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  for (const minutes of [30, 45, 60]) {
    await duration.selectOption(String(minutes));
    const expected = minutes === savedMinutes ? 0 : Math.floor(240 / minutes) * 7;
    await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(expected);
    if (expected) {
      const marks = await calendar.locator('.barber-slot.is-pending').evaluateAll(cells => cells.map(cell => {
        const style = getComputedStyle(cell, '::after'); return { color: style.borderTopColor, style: style.borderTopStyle, visible: style.visibility };
      }));
      for (const mark of marks) expect(mark).toEqual({ color: 'rgb(255, 255, 255)', style: 'dashed', visible: 'visible' });
    }
  }
  const target = savedMinutes === 60 ? 45 : 60;
  await duration.selectOption(String(target));
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  expect(state.writes.at(-1).configuracion.blockMinutes).toBe(target);
  await duration.selectOption(target === 60 ? '30' : '60');
  await expect(calendar.locator('.barber-slot.is-pending').first()).toBeVisible();
  await duration.selectOption(String(target));
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(0);
  const first = calendar.locator('.barber-slot').first();
  await first.click(); await page.getByRole('button', { name: 'Bloqueado', exact: true }).click();
  await duration.selectOption(String(target));
  await expect(calendar.locator('.barber-slot.is-pending')).toHaveCount(1);
});
