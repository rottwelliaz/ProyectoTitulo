import { test, expect, type Page } from '@playwright/test';
import { qualityFixture, ready } from './quality-fixture';
import { tableResponse } from './datatable-fixture';

const runtimeErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /DataTables|hydrat|astro-island/i.test(message.text())) errors.push(message.text()); });
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

async function fixture(page: Page, role = 'cliente', count = 35) {
  await qualityFixture(page, role);
  const state = {
    requests: [] as URL[], fail: false,
    appointments: Array.from({ length: count }, (_, i) => ({ id: `c${i}`, fecha_hora: `2035-01-${String(i % 28 + 1).padStart(2, '0')}T15:00:00Z`, estado: 'confirmada', duracionReservada: 30,
      cliente: { id: i + 1, nombre: `Cliente ${i}`, telefono: '912345678' }, servicio: { id: 's1', nombre_servicio: `Servicio ${i}` }, barbero: { usuario: { nombre: `Barbero ${i}` } } })),
    services: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, nombre_servicio: `Corte ${i}`, descripcion: 'Descripción', precio: 10000 + i, activo: true })),
    users: Array.from({ length: count }, (_, i) => ({ id: i + 20, nombre: `Persona ${i}`, email: `persona${i}@test.invalid`, fecha_creacion: '2026-01-01', rol: 'barbero', aprobado: false, activo: true, solicitudProfesional: { estado: 'pendiente' } })),
  };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace('/api', '');
    if (url.searchParams.get('datatable') === '1') {
      state.requests.push(url);
      if (state.fail) return route.fulfill({ status: 500, json: { message: 'Error de prueba del listado' } });
      const rows = path === '/servicios' ? state.services : path.includes('usuarios') ? state.users : state.appointments;
      return route.fulfill({ json: tableResponse(url, rows) });
    }
    if (path === '/servicios') return route.fulfill({ json: state.services });
    if (path.endsWith('/cancelar') || path.endsWith('/estado')) {
      const id = path.split('/').at(-2);
      const row = state.appointments.find(item => item.id === id)!;
      row.estado = path.endsWith('/cancelar') ? 'cancelada' : route.request().postDataJSON().estado;
      return route.fulfill({ json: row });
    }
    if (path.endsWith('/aprobar-barbero') || path.endsWith('/rechazar-barbero')) {
      state.users = state.users.filter(item => String(item.id) !== path.split('/').at(-2));
      return route.fulfill({ json: { message: 'Actualizado' } });
    }
    if (path.startsWith('/servicios/') && route.request().method() === 'PUT') {
      const row = state.services.find(item => item.id === path.split('/').pop())!;
      Object.assign(row, route.request().postDataJSON()); return route.fulfill({ json: row });
    }
    return route.fallback();
  });
  return state;
}

for (const count of [0, 7, 10, 11, 35]) test(`cliente: ${count} registros, tamaño inicial y navegación`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const state = await fixture(page, 'cliente', count);
  await ready(page, '/mis-citas');
  const list = page.locator('#client-appointments-list');
  await expect(list.locator('.client-appointment-item')).toHaveCount(Math.min(count, 10));
  await expect(list.locator('.dt-info')).toContainText(`de ${count} registros`);
  expect(state.requests).toHaveLength(1);
  if (count > 10) {
    await list.getByRole('link', { name: 'Página 2', exact: true }).click();
    await expect(list.locator('.dt-info')).toContainText(`Mostrando 11 a ${Math.min(count, 20)}`);
    await expect(list.locator('.client-appointment-item')).toHaveCount(Math.min(count - 10, 10));
    await list.getByRole('link', { name: 'Página anterior', exact: true }).click();
    await expect(list.locator('.dt-info')).toContainText('Mostrando 1 a 10');
  }
  expect(errors).toEqual([]);
});

test('cliente: búsqueda, orden, tamaño, cancelación en otra página y conservación de filtros', async ({ page }) => {
  const state = await fixture(page);
  await ready(page, '/mis-citas'); const list = page.locator('#client-appointments-list');
  await list.getByRole('link', { name: 'Página 2', exact: true }).click();
  await expect(list.locator('.dt-info')).toContainText('11 a 20');
  await list.locator('.client-appointment-cancel').first().click(); await page.locator('.swal2-confirm').click();
  await expect(list.locator('.dt-info')).toContainText('11 a 20');
  await expect(list.locator('.client-appointment-status.is-cancelada')).toHaveCount(1);
  await list.getByLabel('Buscar:', { exact: true }).fill('Servicio 1');
  await expect(list.locator('.dt-info')).toContainText('de 11 registros');
  await list.getByRole('link', { name: 'Página 2', exact: true }).click();
  await expect(list.locator('.client-appointment-item')).toHaveCount(1);
  await list.getByLabel('Ordenar por:').selectOption({ index: 1 });
  await list.getByLabel('Dirección del orden').selectOption('asc');
  await expect.poll(() => state.requests.at(-1)?.searchParams.get('order[0][dir]')).toBe('asc');
  expect(state.requests.at(-1)?.searchParams.get('order[0][name]')).toBe('persona');
  await expect(list.getByLabel('Buscar:', { exact: true })).toHaveValue('Servicio 1');
  await list.getByLabel('Buscar:', { exact: true }).fill('');
  await expect(list.locator('.dt-info')).toContainText('de 35 registros');
  await list.locator('.dt-length select').selectOption('25');
  await expect(list.locator('.client-appointment-item')).toHaveCount(25);
});

test('cliente: historial accesible con más de 10 citas anteriores, búsqueda y próximas separadas', async ({ page }) => {
  const state = await fixture(page);
  state.appointments.slice(15).forEach((row, index) => {
    row.fecha_hora = `2020-01-${String(index + 1).padStart(2, '0')}T15:00:00Z`;
    row.estado = ['finalizada', 'cancelada', 'rechazada', 'inasistencia'][index % 4];
    row.servicio.nombre_servicio = `Servicio anterior ${index}`;
  });
  await ready(page, '/mis-citas');
  const list = page.locator('#client-appointments-list');
  const view = page.getByLabel('Mostrar citas:', { exact: true });
  await expect(list.locator('.client-appointment-item')).toHaveCount(10);
  await expect(list).not.toContainText('Servicio anterior');
  await view.selectOption('historial');
  await expect(list.locator('.dt-info')).toHaveText('Mostrando 1 a 10 de 20 registros');
  await expect(list.locator('.client-appointment-item')).toHaveCount(10);
  await expect(list.locator('.client-appointment-cancel')).toHaveCount(0);
  await list.getByRole('link', { name: 'Página 2', exact: true }).click();
  await expect(list.locator('.dt-info')).toHaveText('Mostrando 11 a 20 de 20 registros');
  await expect(list.getByText('Servicio anterior 0', { exact: true })).toBeVisible();
  await list.getByLabel('Buscar:', { exact: true }).fill('Barbero 15');
  await expect(list.locator('.client-appointment-item')).toHaveCount(1);
  await expect(list.getByText('Servicio anterior 0', { exact: true })).toBeVisible();
  await list.getByLabel('Buscar:', { exact: true }).fill('');
  await expect(list.locator('.dt-info')).toContainText('de 20 registros');
  await view.selectOption('proximas');
  await expect(list.locator('.dt-info')).toHaveText('Mostrando 1 a 10 de 15 registros');
  await expect(list).not.toContainText('Servicio anterior');
  await view.selectOption('todas');
  await expect(list.locator('.dt-info')).toHaveText('Mostrando 1 a 10 de 35 registros');
});

test('barbero: reservas e historial separados, acciones en página 2 y retorno desde página vacía', async ({ page }) => {
  const state = await fixture(page, 'barbero', 11);
  await ready(page, '/perfil-profesional');
  await page.locator('[data-pro-view="mis-citas"]').first().click(); await page.getByRole('tab', { name: 'Reservas', exact: true }).click();
  const list = page.locator('#citas-profesional');
  await expect(list.locator('.appointment-card')).toHaveCount(10);
  await list.getByRole('link', { name: 'Página 2', exact: true }).click(); await expect(list.locator('.appointment-card')).toHaveCount(1);
  await list.getByRole('button', { name: 'Cancelar', exact: true }).click(); await page.locator('.swal2-confirm').click();
  await expect(list.locator('.dt-info')).toContainText('Mostrando 1 a 10 de 10');
  await expect(list.locator('.appointment-card')).toHaveCount(10);
  await page.getByRole('tab', { name: 'Historial', exact: true }).click();
  await expect(list.locator('.appointment-card')).toHaveCount(1);
  await expect(list.locator('.appointment-status')).toHaveText('Cancelada');
  expect(state.requests.filter(url => url.pathname.endsWith('/citas/mias'))).toHaveLength(4);
});

test('servicios: listado completo sin paginación conserva la edición', async ({ page }) => {
  await fixture(page, 'barbero'); await ready(page, '/perfil-profesional');
  await page.locator('[data-pro-view="organizacion"]').click(); await page.getByRole('tab', { name: 'Servicios', exact: true }).click();
  const list = page.locator('#professional-services');
  await expect(list.locator('.pro-service-item')).toHaveCount(35);
  await expect(list.locator('.cbc-data-list, .dt-paging, .dt-search')).toHaveCount(0);
  const card = list.locator('.pro-service-item').last();
  await card.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.locator('#service-modal'); await dialog.getByLabel('Precio (CLP)').fill('22000'); await dialog.getByRole('button', { name: 'Guardar servicio' }).click();
  await expect(card.locator('b')).toContainText('22.000');
  await expect(list.locator('.pro-service-item')).toHaveCount(35);
});

for (const path of ['/admin', '/admin-barberos']) test(`${path}: aprobación y rechazo en última página, vuelve a la anterior`, async ({ page }) => {
  await fixture(page, 'admin', 11); await ready(page, path);
  if (path === '/admin') await page.locator('[data-admin-tab="pendientes"]').click();
  const list = page.locator(path === '/admin' ? '#admin-pendientes-list' : '#pending-barbers-list');
  await expect(list.locator('tbody > tr')).toHaveCount(10);
  await list.getByRole('link', { name: 'Página 2', exact: true }).click(); await expect(list.locator('tbody > tr')).toHaveCount(1);
  await list.getByRole('button', { name: path === '/admin' ? 'Aprobar' : 'Aprobar barbero', exact: true }).click();
  await expect(list.locator('.dt-info')).toContainText('Mostrando 1 a 10 de 10');
  await list.getByRole('button', { name: path === '/admin' ? 'Rechazar' : 'Rechazar solicitud', exact: true }).first().click();
  await page.locator('.swal2-confirm').click();
  await expect(list.locator('.dt-info')).toContainText('de 9 registros');
  await expect(list.locator('tbody > tr')).toHaveCount(9);
});

test('administrador: listas por rol se cargan al abrir y edición funciona en página 2', async ({ page }) => {
  const state = await fixture(page, 'admin'); await ready(page, '/admin');
  expect(state.requests).toHaveLength(0);
  for (const tab of ['clientes', 'barberos', 'admins']) {
    await page.locator(`[data-admin-tab="${tab}"]`).click();
    const list = page.locator(`#admin-${tab}-list`);
    await expect(list.locator('.admin-user-card')).toHaveCount(10);
    await list.getByRole('link', { name: 'Página 2', exact: true }).click();
    await expect(list.locator('.dt-info')).toContainText('11 a 20');
    await list.getByRole('button', { name: 'Editar', exact: true }).first().click();
    await expect(page.locator('#admin-edit-modal')).toBeVisible();
    await expect(page.locator('#admin-edit-form [name="nombre"]')).not.toHaveValue('');
    await page.locator('#admin-edit-cancel').click();
  }
});

test('administrador: muestra todos los servicios del barbero sin paginación adicional', async ({ page }) => {
  const state = await fixture(page, 'admin');
  Object.assign(state.users[0], { perfilBarbero: { id: 55, servicios: state.services, _count: { servicios: 35, citas: 0 } } });
  await ready(page, '/admin'); await page.locator('[data-admin-tab="barberos"]').click();
  const user = page.locator('#admin-barberos-list .admin-user-card').filter({ hasText: 'persona0@test.invalid' });
  await expect(user).toBeVisible();
  expect(state.requests.filter(url => url.pathname.endsWith('/servicios'))).toHaveLength(0);
  await expect(user.locator('.admin-service-chips > span')).toHaveCount(35);
  await expect(user.locator('.dt-paging, [data-services-host]')).toHaveCount(0);
});

test('fallo y reintento conservan controles, sin alertas técnicas de DataTables', async ({ page }) => {
  const state = await fixture(page); state.fail = true;
  const dialogs: string[] = []; page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await ready(page, '/mis-citas'); const list = page.locator('#client-appointments-list');
  await expect(list.getByRole('alert')).toHaveText('Error de prueba del listado');
  state.fail = false; await list.getByRole('button', { name: 'Reintentar' }).click();
  await expect(list.locator('.client-appointment-item')).toHaveCount(10); expect(dialogs).toEqual([]);
});

for (const role of ['cliente', 'barbero', 'admin']) test(`${role}: controles en móvil y cambio inmediato de tema`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page, role);
  const path = role === 'cliente' ? '/mis-citas' : role === 'barbero' ? '/perfil-profesional' : '/admin'; await ready(page, path);
  if (role === 'barbero') { await page.locator('[data-pro-view="mis-citas"]').first().click(); await page.getByRole('tab', { name: 'Reservas', exact: true }).click(); }
  if (role === 'admin') await page.locator('[data-admin-tab="clientes"]').click();
  const list = page.locator(role === 'cliente' ? '#client-appointments-list' : role === 'barbero' ? '#citas-profesional' : '#admin-clientes-list');
  await expect(list.locator('tbody > tr')).toHaveCount(10);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const colors = await list.locator('.dt-search input').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    expect(colors.background).not.toBe(colors.color);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await list.getByRole('link', { name: 'Página 2', exact: true }).click();
    await expect(list.locator('.dt-info')).toContainText('11 a 20');
    await list.getByRole('link', { name: 'Página 1', exact: true }).click();
  }
  await page.screenshot({ path: `test-results/datatables-${role}-mobile.png`, fullPage: true });
});
