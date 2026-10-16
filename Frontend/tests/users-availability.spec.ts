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
        if (fail) return route.fulfill({ status: 500, json: { message: 'No se pudo guardar el perfil' } });
        const body = route.request().postDataJSON(); current = { ...current, ...body, telefono: body.telefono || null };
      }
      return route.fulfill({ json: current });
    }
    if (path.endsWith('/solicitud-profesional')) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil');
  await expect(page.locator('.profile-photo')).toHaveAttribute('style', /data:image\/png/);
  await expect(page.locator('.profile-photo')).not.toHaveAttribute('style', /stale/);
  for (const telephone of ['', '987654321', '912345678']) {
    await page.locator('[data-edit-field="profile-input-telefono"]').click();
    await page.locator('#profile-input-telefono').fill(telephone);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(page.locator('#profile-message')).toHaveText('Perfil actualizado correctamente.');
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
    if (path.endsWith('/auth/me')) return route.fulfill({ json: account() });
    if (path.endsWith('/solicitud-profesional')) {
      if (route.request().method() === 'POST') { count++; application = { estado: 'pendiente' }; }
      return route.fulfill({ json: application });
    }
    return route.fulfill({ json: [] });
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

for (const path of ['/admin', '/admin-barberos']) test(`${path}: rechazo con motivo persiste y desaparece de pendientes`, async ({ page }) => {
  await session(page); const client = { ...account(), id: 2, solicitudProfesional: { estado: 'pendiente', motivoRechazo: '' } }; let received: any;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return route.fulfill({ json: account('admin') });
    const pending = client.solicitudProfesional.estado === 'pendiente' ? [client] : [];
    if (endpoint.endsWith('/admin/dashboard')) return route.fulfill({ json: { stats: {}, clientes: [client], barberos: [], admins: [account('admin')], barberosPendientes: pending } });
    if (endpoint.endsWith('/barberos/pendientes')) return route.fulfill({ json: pending });
    if (endpoint.endsWith('/rechazar-barbero')) { received = route.request().postDataJSON(); client.solicitudProfesional = { estado: 'rechazada', motivoRechazo: received.motivoRechazo }; return route.fulfill({ json: client }); }
    return route.fulfill({ json: [] });
  });
  await page.goto(path);
  if (path === '/admin') await page.locator('[data-admin-tab="pendientes"]').click();
  page.on('dialog', dialog => dialog.accept('Información incompleta'));
  await page.getByRole('button', { name: path === '/admin' ? 'Rechazar' : 'Rechazar solicitud', exact: true }).click();
  await expect.poll(() => received?.motivoRechazo).toBe('Información incompleta');
  await expect(page.getByText(/No hay (solicitudes|barberos) pendientes/)).toBeVisible();
  await page.reload();
  if (path === '/admin') { await page.locator('[data-admin-tab="clientes"]').click(); await expect(page.getByText(/Solicitud: rechazada Información incompleta/)).toBeVisible(); }
});

test('administración desactiva y reactiva sin ocultar el historial; muestra errores', async ({ page }) => {
  await session(page); const barber = { ...account('barbero'), id: 2, perfilBarbero: { id: 2, _count: { citas: 4, servicios: 1 } } }; let fail = false;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return route.fulfill({ json: account('admin') });
    if (endpoint.endsWith('/admin/dashboard')) return route.fulfill({ json: { stats: {}, clientes: [], barberos: [barber], admins: [account('admin')], barberosPendientes: [] } });
    if (endpoint.endsWith('/usuarios/2')) {
      if (fail) return route.fulfill({ status: 500, json: { message: 'No se pudo desactivar la cuenta' } });
      barber.activo = route.request().method() !== 'DELETE'; return route.fulfill(barber.activo ? { json: barber } : { status: 204 });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/admin'); await page.locator('[data-admin-tab="barberos"]').click();
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(page.getByText('Desactivado', { exact: true })).toBeVisible();
  await expect(page.getByText('Citas: 4', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reactivar', exact: true }).click();
  await expect(page.getByText('Aprobado', { exact: true })).toBeVisible();
  fail = true; await page.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(page.locator('#admin-dashboard-message')).toHaveText('No se pudo desactivar la cuenta');
  await expect(page.getByText('Aprobado', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/group4-admin.png', fullPage: true });
});

test('agenda usa configuración del servidor, conserva copia y rechaza sobrescribir otra revisión', async ({ page }) => {
  await session(page); await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
  let revision = 'v1', config = { startTime: '10:00', endTime: '11:00', blockMinutes: 30 }, writes: any[] = [], citas: any[] = [], blocks: any[] = [], published = false;
  await page.route('**/api/**', async route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return route.fulfill({ json: { ...account('barbero'), perfilBarbero: { id: 10 } } });
    if (endpoint.endsWith('/profesional/calendario')) return route.fulfill({ json: { citas, bloqueos: blocks, revision, configuracion: config, publicada: published } });
    if (endpoint.endsWith('/disponibilidad/semana')) {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.revision !== revision) return route.fulfill({ status: 409, json: { message: 'La agenda cambió en otro dispositivo. Recarga la semana.' } });
      config = body.configuracion; revision = 'v' + (writes.length + 1); published = true;
      citas = body.bloques.map((b: any, i: number) => ({ id: String(i), fecha_hora: b.inicio, disponibleHasta: b.fin, estado: 'disponible' }));
      blocks = body.bloqueos.map((b: any, i: number) => ({ id: 'b' + i, ...b, origen: 'agenda' }));
      return route.fulfill({ json: { citas, omittedOccupiedBlocks: 0 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil-profesional');
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  const calendar = page.locator('#disponibilidad-profesional');
  await expect(calendar.getByLabel('Hora de entrada', { exact: true })).toHaveValue('10:00');
  await calendar.getByRole('button', { name: 'Guardar agenda', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1); expect(writes[0].revision).toBe('v1'); expect(writes[0].bloques).toHaveLength(14);
  await expect(calendar.getByRole('button', { name: 'Guardar agenda', exact: true })).toBeEnabled();
  await page.reload(); await expect(calendar.getByLabel('Duración de cada bloque', { exact: true })).toHaveValue('30');
  revision = 'other-device';
  await calendar.getByRole('button', { name: 'Guardar agenda', exact: true }).click();
  await expect(calendar.getByRole('status')).toContainText('La agenda cambió');
  await calendar.getByRole('button', { name: 'Recargar semana', exact: true }).click();
  await expect(calendar.getByRole('button', { name: 'Copiar semana', exact: true })).toBeEnabled();
  await calendar.getByRole('button', { name: 'Copiar semana', exact: true }).click();
  await calendar.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await calendar.getByRole('button', { name: 'Pegar aquí', exact: true }).click();
  await expect.poll(() => writes.length).toBe(3);
  expect(writes[2].configuracion).toEqual(config); expect(writes[2].revision).toBe('other-device');
  expect(writes[2].bloques).toHaveLength(14);
  await expect(calendar.getByText('Agenda guardada y disponible para las reservas de clientes.', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/group4-calendar.png', fullPage: true });
});
