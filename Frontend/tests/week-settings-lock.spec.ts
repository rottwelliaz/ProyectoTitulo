import { test, expect, type Page } from '@playwright/test';
import { tableResponse } from './datatable-fixture';
import { slotInstant, addDays } from '../src/lib/businessTime';

const week = '2035-01-15';
const at = (minute: number, day = week) => slotInstant(day, minute).toISOString();
const config = { startTime: '09:00', endTime: '19:00', blockMinutes: 30 };
const message = 'La semana seleccionada ya contiene citas, descansos o bloqueos. Para proteger la planificación existente, no se pueden cambiar las horas de entrada, cierre ni la duración de los bloques.';
function windows(settings = config, first = week) {
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return Array.from({ length: 7 }, (_, day) => Array.from({ length: Math.floor((minute(settings.endTime) - minute(settings.startTime)) / settings.blockMinutes) }, (_, i) => {
    const start = minute(settings.startTime) + i * settings.blockMinutes;
    return { id: `w-${day}-${i}`, fecha_hora: at(start, addDays(first, day)), disponibleHasta: at(start + settings.blockMinutes, addDays(first, day)), estado: 'disponible' };
  })).flat();
}
async function fixture(page: Page, special = '', theme = 'light', minutes = 30) {
  const now = at(480);
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript(theme => { localStorage.setItem('token', 'synthetic-week-lock'); localStorage.setItem('ui-theme', theme); }, theme);
  const data: any = { publicada: special !== 'empty', revision: 'v0', configuracion: { ...config, blockMinutes: minutes }, citas: special === 'empty' ? [] : windows({ ...config, blockMinutes: minutes }), bloqueos: [] };
  const appointment = { id: 'appointment', fecha_hora: at(540), duracionReservada: 30, estado: 'confirmada', cliente: { id: 3, nombre: 'Cliente simulado' }, servicio: { id: 'cut', nombre_servicio: 'Corte' } };
  if (special === 'reservation') data.citas.push(appointment);
  if (['descanso', 'bloqueado', 'manual'].includes(special)) data.bloqueos.push({ id: 'block', inicio: at(600), fin: at(630), tipo: special === 'manual' ? 'bloqueado' : special, origen: special === 'manual' ? 'manual' : 'agenda' });
  const state = { weeks: { [week]: data } as Record<string, any>, writes: [] as any[], rejectSettings: false };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = (value: any, status = 200) => route.fulfill({ status, json: tableResponse(url, value, +new Date(now)) });
    if (path.endsWith('/auth/me')) return json({ id: 2, rol: 'barbero', aprobado: true, activo: true, nombre: 'Prueba', perfilBarbero: { id: 10, requiereComprobante: false } });
    if (path.endsWith('/profesional/calendario')) return json(state.weeks[url.searchParams.get('desde')!] || { publicada: false, revision: 'empty', configuracion: config, citas: [], bloqueos: [] });
    if (path.endsWith('/disponibilidad/semana')) {
      const body = route.request().postDataJSON(); state.writes.push(body);
      const selected = body.fechaInicio.slice(0, 10), previous = state.weeks[selected] || { citas: [], bloqueos: [] };
      if (state.rejectSettings) return json({ message }, 409);
      const instant = await page.evaluate(() => Date.now());
      state.weeks[selected] = { publicada: true, revision: 'v' + state.writes.length, configuracion: body.configuracion,
        citas: [...previous.citas.filter((c: any) => c.estado !== 'disponible' || +new Date(c.fecha_hora) <= instant), ...body.bloques.map((b: any, i: number) => ({ id: 'saved-' + i, fecha_hora: b.inicio, disponibleHasta: b.fin, estado: 'disponible' }))],
        bloqueos: [...previous.bloqueos.filter((b: any) => +new Date(b.inicio) <= instant || b.origen !== 'agenda'), ...body.bloqueos.map((b: any, i: number) => ({ ...b, id: 'saved-b-' + i, origen: 'agenda' }))] };
      return json({ citas: [] });
    }
    return json([]);
  });
  await page.goto('/perfil-profesional#organizacion');
  const calendar = page.locator('#disponibilidad-profesional');
  await expect(calendar.getByRole('button', { name: 'Habilitar semana', exact: true })).toBeEnabled();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue(String(minutes));
  return { state, calendar, appointment };
}

for (const theme of ['light', 'dark']) for (const kind of ['reservation', 'descanso', 'bloqueado', 'manual']) test(`${kind}: configuración bloqueada visible y calendario editable en ${theme}`, async ({ page }) => {
  const { calendar } = await fixture(page, kind, theme);
  const controls = calendar.locator('.calendar-settings select');
  await expect(controls).toHaveCount(3);
  for (const control of await controls.all()) { await expect(control).toBeVisible(); await expect(control).toBeDisabled(); }
  await expect(calendar.getByText('Esta semana contiene citas, descansos o bloqueos programados.', { exact: false })).toBeVisible();
  await expect(page.locator('.swal2-popup')).toHaveCount(0);
  const available = calendar.locator('.barber-slot.is-available:not(:disabled)').first();
  await available.click(); await page.getByRole('button', { name: 'Descanso', exact: true }).click();
  await expect(calendar.locator('.calendar-pending-message')).toBeVisible();
});

test('intento programático conserva configuración y muestra SweetAlert una sola vez', async ({ page }) => {
  const { state, calendar } = await fixture(page, 'reservation');
  const duration = calendar.getByLabel('Duración de cada bloque', { exact: true });
  await duration.evaluate((select: HTMLSelectElement) => { select.value = '60'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.locator('.swal2-title')).toHaveText('No se puede modificar esta semana');
  await expect(page.locator('.swal2-html-container')).toHaveText(message);
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(duration).toHaveValue('30'); await expect(duration).toBeDisabled();
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0); expect(state.writes).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(calendar.getByRole('button', { name: 'Habilitar semana', exact: true })).toBeEnabled();
  await expect(page.locator('.swal2-popup')).toHaveCount(0);
});

test('semana nueva permite elegir horarios sin habilitar automáticamente la disponibilidad', async ({ page }) => {
  const { state, calendar } = await fixture(page, 'empty');
  await calendar.getByLabel('Hora de entrada', { exact: true }).selectOption('10:00');
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('18:00');
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('45');
  await expect(calendar.locator('.barber-slot.is-available')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
  await expect(calendar.locator('.barber-slot.is-available')).toHaveCount(70);
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  expect(state.writes[0].configuracion).toEqual({ startTime: '10:00', endTime: '18:00', blockMinutes: 45 });
  await page.reload(); await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue('45');
});

for (const [from, to] of [[30, 45], [45, 60], [60, 30]]) test(`solo disponibilidad ${from} → ${to}: reemplaza, guarda y recarga sin residuos`, async ({ page }) => {
  const { state, calendar } = await fixture(page, '', 'light', from);
  await calendar.getByLabel('Hora de entrada', { exact: true }).selectOption('10:00');
  await calendar.getByLabel('Hora de cierre', { exact: true }).selectOption('18:00');
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption(String(to));
  await expect(calendar.locator('.barber-slot.is-unconfigured')).toHaveCount(0);
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  const windows = state.writes[0].bloques;
  expect(windows).toHaveLength(Math.floor(480 / to) * 7);
  windows.forEach((b: any, index: number) => { expect(+new Date(b.fin) - +new Date(b.inicio)).toBe(to * 60000); if (index) expect(+new Date(b.inicio)).toBeGreaterThanOrEqual(+new Date(windows[index - 1].fin)); });
  await page.reload(); await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue(String(to));
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeEnabled();
});

for (const kind of ['descanso', 'bloqueado']) test(`retirar ${kind} devuelve Disponible y habilita configuración después de guardar`, async ({ page }) => {
  const { state, calendar } = await fixture(page, kind);
  await calendar.locator('.barber-slot.' + (kind === 'descanso' ? 'is-break' : 'is-booking')).click();
  await expect(page.getByRole('button', { name: 'Sin configurar', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Disponible', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeEnabled();
  expect(state.weeks[week].bloqueos).toEqual([]); await expect(calendar.locator('.barber-slot.is-unconfigured')).toHaveCount(0);
});

test('los descansos nuevos del borrador también bloquean los controles sin alertas al renderizar', async ({ page }) => {
  const { calendar } = await fixture(page);
  await calendar.locator('.barber-slot').first().click(); await page.getByRole('button', { name: 'Bloqueado', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
  await expect(page.locator('.swal2-popup')).toHaveCount(0);
  await calendar.locator('.barber-slot').first().click(); await page.getByRole('button', { name: 'Disponible', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeEnabled();
});

test('la protección de una semana no bloquea la siguiente', async ({ page }) => {
  const { calendar } = await fixture(page, 'reservation');
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeEnabled();
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('60');
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue('60');
});

test('una reserva llegada durante el borrador recupera la configuración original al rechazar el guardado', async ({ page }) => {
  const { state, calendar, appointment } = await fixture(page);
  await calendar.getByLabel('Duración de cada bloque', { exact: true }).selectOption('60');
  state.weeks[week].citas.push(appointment); state.rejectSettings = true;
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(page.locator('.swal2-title')).toHaveText('No se puede modificar esta semana');
  await expect(page.locator('.swal2-html-container')).toHaveText(message);
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue('30');
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  expect(state.weeks[week].configuracion).toEqual(config); expect(state.weeks[week].citas).toContainEqual(appointment);
});

test('historial y semanas pasadas bloquean configuración, pero permiten editar el futuro seguro', async ({ page }) => {
  const { state, calendar } = await fixture(page);
  await page.clock.setFixedTime(new Date(at(860, '2035-01-17')));
  await calendar.getByRole('button', { name: 'Recargar semana', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
  await expect(calendar.getByText('Esta semana contiene intervalos históricos o ya iniciados.', { exact: false })).toBeVisible();
  const history = structuredClone(state.weeks[week].citas.filter((c: any) => c.fecha_hora <= at(860, '2035-01-17')));
  await expect(calendar.locator('.calendar-day').first().locator('.barber-slot').first()).toBeDisabled();
  await calendar.locator('.calendar-day').nth(3).locator('.barber-slot').first().click();
  await page.getByRole('button', { name: 'Descanso', exact: true }).click();
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.locator('.calendar-pending-message')).toHaveCount(0);
  expect(state.weeks[week].citas.filter((c: any) => c.fecha_hora <= at(860, '2035-01-17'))).toEqual(history);
  await calendar.getByRole('button', { name: 'Semana anterior', exact: true }).click();
  await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toBeDisabled();
});
