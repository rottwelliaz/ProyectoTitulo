import { fulfillDataTable } from './datatable-fixture';
import { test, expect, type Page } from '@playwright/test';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQMgkTMgljgFAAEA4CcV2GZ44AAAAASUVORK5CYII=';
const account = (rol = 'cliente') => ({ id: 1, nombre: 'Usuario Prueba', email: 'user@test.invalid', telefono: '912345678', rol, aprobado: true, activo: true, fecha_creacion: '2026-01-01T12:00:00Z', foto_perfil: photo });
async function session(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('token', 'test'); localStorage.setItem('profile-photo-1', 'https://example.com/stale.png'); localStorage.setItem('barber-calendar-settings-1', JSON.stringify({ startTime: '06:00', endTime: '22:00', blockMinutes: 60 })); });
}

test('Mi perfil borra teléfono, conserva foto del servidor y no anuncia éxito si falla el guardado', async ({ page }) => {
  await session(page); let current = account(), fail = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      if (route.request().method() === 'PUT') {
        if (fail) return fulfillDataTable(route, { status: 500, json: { message: 'No se pudo guardar el perfil' } });
        const body = route.request().postDataJSON(); current = { ...current, ...body, telefono: body.telefono || null };
      }
      return fulfillDataTable(route, { json: current });
    }
    if (path.endsWith('/solicitud-profesional')) return fulfillDataTable(route, { json: null });
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto('/perfil');
  await expect(page.locator('.profile-photo')).toHaveAttribute('style', /data:image\/png/);
  await expect(page.locator('.profile-photo')).not.toHaveAttribute('style', /stale/);
  for (const telephone of ['', '987654321', '912345678']) {
    await page.locator('[data-edit-field="profile-input-telefono"]').click();
    await page.locator('#profile-input-telefono').fill(telephone);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.locator('.cbc-notification')).toContainText('Perfil actualizado correctamente.');
    await page.reload(); await expect(page.locator('#profile-input-telefono')).toHaveValue(telephone);
  }
  fail = true;
  await page.locator('[data-edit-field="profile-input-telefono"]').click();
  await page.locator('#profile-input-telefono').fill('999999999');
  await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await expect(page.locator('#profile-message')).toHaveText('No se pudo guardar el perfil');
  expect(current.telefono).toBe('912345678');
  await page.reload(); await expect(page.locator('#profile-input-telefono')).toHaveValue('912345678');
  await page.screenshot({ path: 'test-results/group4-profile.png', fullPage: true });
});

test('solicitante envía una sola solicitud y consulta pendiente, rechazo y aprobación', async ({ page }) => {
  await session(page); let application: any = null, count = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return fulfillDataTable(route, { json: account() });
    if (path.endsWith('/solicitud-profesional')) {
      if (route.request().method() === 'POST') { count++; application = { estado: 'pendiente' }; }
      return fulfillDataTable(route, { json: application });
    }
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto('/perfil');
  await page.getByRole('button', { name: 'Solicitar perfil profesional', exact: true }).click();
  await expect(page.locator('#application-status')).toContainText('pendiente');
  await expect(page.locator('#apply-professional')).toBeHidden(); expect(count).toBe(1);
  await page.reload(); await expect(page.locator('#application-status')).toContainText('pendiente');
  application = { estado: 'rechazada', motivoRechazo: 'Faltan antecedentes <script>inseguro</script>' };
  await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect(page.locator('#application-status')).toContainText(application.motivoRechazo);
  await expect(page.locator('#application-status script')).toHaveCount(0);
  application = { estado: 'aprobada' };
  await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect(page.locator('#application-status')).toContainText('aprobada');
});

for (const path of ['/admin', '/admin-barberos']) for (const theme of ['light', 'dark']) test(`${path} ${theme}: cancelar conserva y confirmar elimina la solicitud`, async ({ page }, info) => {
  await session(page);
  await page.addInitScript(theme => localStorage.setItem('ui-theme', theme), theme);
  const barber = { ...account('barbero'), id: 2, aprobado: false, solicitudProfesional: { estado: 'pendiente', motivoRechazo: '' } };
  let deleted = false, requests = 0;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return fulfillDataTable(route, { json: account('admin') });
    const pending = deleted ? [] : [barber];
    if (endpoint.endsWith('/admin/dashboard')) return fulfillDataTable(route, { json: { stats: {}, clientes: [], barberos: pending, admins: [account('admin')], barberosPendientes: pending } });
    if (endpoint.endsWith('/barberos/pendientes')) return fulfillDataTable(route, { json: pending });
    if (endpoint.endsWith('/rechazar-barbero')) { requests++; deleted = true; return fulfillDataTable(route, { json: { id: barber.id } }); }
    return fulfillDataTable(route, { json: [] });
  });
  page.on('dialog', () => { throw Error('No se permiten diálogos nativos'); });
  await page.goto(path);
  if (path === '/admin') await page.locator('[data-admin-tab="pendientes"]').click();
  const reject = page.getByRole('button', { name: path === '/admin' ? 'Rechazar' : 'Rechazar solicitud', exact: true });
  await expect(page.getByText('Rol: barbero', { exact: false }).filter({ visible: true })).toBeVisible();
  await reject.click();
  const popup = page.locator('.cbc-notification');
  await expect(popup).toContainText('¿Estás seguro de rechazar esta solicitud? La cuenta pendiente será eliminada permanentemente.');
  await expect(popup).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 23, 28)');
  await popup.screenshot({ path: info.outputPath(`rechazo-${theme}.png`) });
  await popup.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(requests).toBe(0); expect(deleted).toBe(false); await expect(reject).toBeVisible();
  await reject.click(); await popup.getByRole('button', { name: 'Sí, rechazar y eliminar', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(popup).toContainText('La solicitud fue rechazada y la cuenta eliminada correctamente.');
  await expect(page.getByText(/No hay (solicitudes|barberos) pendientes/)).toBeVisible();
  await page.reload();
  if (path === '/admin') await page.locator('[data-admin-tab="pendientes"]').click();
  await expect(reject).toHaveCount(0); expect(deleted).toBe(true);
});

for (const active of [true, false]) test(`administración elimina permanentemente cuenta activa=${active}; cancelar y errores conservan la cuenta`, async ({ page }) => {
  await session(page); const barber = { ...account('barbero'), id: 2, activo: active, perfilBarbero: { id: 2, _count: { citas: 4, servicios: 1 } } };
  let fail = false, deleted = false, writes = 0;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return fulfillDataTable(route, { json: account('admin') });
    if (endpoint.endsWith('/admin/dashboard')) return fulfillDataTable(route, { json: { stats: {}, clientes: [], barberos: deleted ? [] : [barber], admins: [account('admin')], barberosPendientes: [] } });
    if (endpoint.endsWith('/usuarios/2') && route.request().method() === 'DELETE') {
      writes++;
      if (fail) return fulfillDataTable(route, { status: 500, json: { message: 'SQL password=secreto' } });
      deleted = true; return fulfillDataTable(route, { status: 204 });
    }
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto('/admin'); await page.locator('[data-admin-tab="barberos"]').click();
  const remove = page.getByRole('button', { name: 'Eliminar cuenta', exact: true });
  const popup = page.locator('.cbc-notification');
  await remove.click();
  await expect(popup).toContainText('Esta acción no se puede deshacer.');
  await popup.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(writes).toBe(0); expect(deleted).toBe(false); await expect(remove).toBeVisible();
  fail = true; await remove.click();
  await popup.getByRole('button', { name: 'Sí, eliminar cuenta', exact: true }).click();
  await expect(popup).toContainText('No se pudo eliminar la cuenta. Inténtalo nuevamente.');
  await expect(popup).not.toContainText('SQL');
  await popup.getByRole('button', { name: 'Entendido', exact: true }).click();
  expect(deleted).toBe(false); await expect(remove).toBeVisible();
  fail = false; await remove.click();
  await popup.getByRole('button', { name: 'Sí, eliminar cuenta', exact: true }).click();
  await expect(popup).toContainText('Cuenta eliminada permanentemente.');
  await expect(remove).toHaveCount(0);
  expect(writes).toBe(2); expect(deleted).toBe(true);
  await page.reload(); await page.locator('[data-admin-tab="barberos"]').click();
  await expect(remove).toHaveCount(0);
});

test('agenda usa configuración del servidor, conserva copia y rechaza sobrescribir otra revisión', async ({ page }) => {
  await session(page); await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
  let revision = 'v1', config = { startTime: '10:00', endTime: '11:00', blockMinutes: 30 }, writes: any[] = [], citas: any[] = [], blocks: any[] = [], published = false;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return fulfillDataTable(route, { json: { ...account('barbero'), perfilBarbero: { id: 10 } } });
    if (endpoint.endsWith('/profesional/calendario')) return fulfillDataTable(route, { json: { citas, bloqueos: blocks, revision, configuracion: config, publicada: published } });
    if (endpoint.endsWith('/disponibilidad/semana')) {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.revision !== revision) return fulfillDataTable(route, { status: 409, json: { message: 'La agenda cambió en otro dispositivo. Recarga la semana.' } });
      config = body.configuracion; revision = 'v' + (writes.length + 1); published = true;
      citas = body.bloques.map((b: any, i: number) => ({ id: String(i), fecha_hora: b.inicio, disponibleHasta: b.fin, estado: 'disponible' }));
      blocks = body.bloqueos.map((b: any, i: number) => ({ id: 'b' + i, ...b, origen: 'agenda' }));
      return fulfillDataTable(route, { json: { citas, omittedOccupiedBlocks: 0 } });
    }
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto('/perfil-profesional');
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  const calendar = page.locator('#disponibilidad-profesional');
  await expect(calendar.getByLabel('Hora de entrada', { exact: true })).toHaveValue('10:00');
  await calendar.getByRole('button', { name: 'Habilitar semana', exact: true }).click();
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1); expect(writes[0].revision).toBe('v1'); expect(writes[0].bloques).toHaveLength(14);
  await expect(calendar.getByRole('button', { name: 'Guardar horarios', exact: true })).toBeEnabled();
  await page.reload(); await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue('30');
  revision = 'other-device';
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect(calendar.getByRole('status')).toContainText('La agenda cambió');
  await expect(page.locator('.swal2-popup')).toContainText('La agenda cambió');
  await page.getByRole('button', { name: 'Entendido', exact: true }).click();
  await calendar.getByRole('button', { name: 'Recargar semana', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'Copiar semana', exact: true })).toBeEnabled();
  await calendar.getByRole('button', { name: 'Copiar semana', exact: true }).click();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await calendar.getByRole('button', { name: 'Pegar aquí', exact: true }).click();
  await page.locator('.swal2-confirm').click();
  await calendar.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].configuracion).toEqual(config); expect(writes[2].revision).toBe('other-device');
  expect(writes[2].bloques).toHaveLength(14);
  await expect(calendar.getByText('Agenda guardada y disponible para las reservas de clientes.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/group4-calendar.png', fullPage: true });
});
