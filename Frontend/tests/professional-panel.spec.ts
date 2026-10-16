import { test, expect, type Page } from '@playwright/test';
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQMgkTMgljgFAAEA4CcV2GZ44AAAAASUVORK5CYII=';

async function fixture(page: Page, theme = 'original') {
  const state = {
    fail: '', requests: [] as string[],
    configuration: { startTime: '09:00', endTime: '19:00', blockMinutes: 60 },
    profile: { id: 10, biografia: 'Biografía original', especialidades: ['Barba'], foto_perfil: photo, requiereComprobante: false, lugarTrabajo: { id: 3, nombre_barberia: 'Conce Club', direccion: 'Centro 123' } },
    services: Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, nombre_servicio: `Servicio ${String.fromCharCode(65 + i)}`, descripcion: 'Corte profesional', precio: 12000, duracion_minutos: 30, activo: i !== 6 })),
    blocks: [{ id: 'block', inicio: '2030-01-08T16:00:00Z', fin: '2030-01-08T17:00:00Z', tipo: 'descanso', origen: 'manual' }],
    appointments: [{ id: 'c1', fecha_hora: '2030-01-08T14:00:00Z', estado: 'confirmada', duracionReservada: 30, disponibleHasta: null as string | null, cliente: { nombre: 'Cliente real' }, servicio: { nombre_servicio: 'Corte histórico', duracion_minutos: 30 } }],
  };
  await page.clock.setFixedTime(new Date('2030-01-07T12:00:00Z'));
  await page.addInitScript(theme => { localStorage.setItem('token', 'test'); localStorage.setItem('ui-theme', theme); }, theme);
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api', '');
    state.requests.push(path + url.search);
    if (state.fail && path === state.fail) return route.fulfill({ status: 500, json: { message: 'No se pudo guardar: error de prueba.' } });
    if (path === '/auth/me') return route.fulfill({ json: { id: 2, rol: 'barbero', nombre: 'Barbero real', email: 'b@test.invalid', fecha_creacion: '2026-01-01T12:00:00Z', foto_perfil: state.profile.foto_perfil, perfilBarbero: state.profile } });
    if (path === '/auth/me/photo') { state.profile.foto_perfil = photo; return route.fulfill({ json: { foto_perfil: photo } }); }
    if (path === '/profesional/perfil') { Object.assign(state.profile, request.postDataJSON()); return route.fulfill({ json: state.profile }); }
    if (path === '/profesional/estadisticas') return route.fulfill({ json: { total: url.searchParams.get('desde') === '2030-02-01' ? 0 : 3, estados: { pendiente: 0, confirmada: url.searchParams.get('desde') === '2030-02-01' ? 0 : 1, cancelada: url.searchParams.get('desde') === '2030-02-01' ? 0 : 1, rechazada: 0, finalizada: url.searchParams.get('desde') === '2030-02-01' ? 0 : 1, inasistencia: 0 } } });
    if (path === '/profesional/calendario') return route.fulfill({ json: { citas: state.appointments, bloqueos: state.blocks, revision: 'test-revision', configuracion: state.configuration } });
    if (path === '/profesional/bloqueos') { const block = { id: 'new-block', ...request.postDataJSON(), origen: 'manual' }; state.blocks.push(block); return route.fulfill({ status: 201, json: block }); }
    if (path.startsWith('/profesional/bloqueos/')) { state.blocks = state.blocks.filter(b => b.id !== path.split('/').pop()); return route.fulfill({ status: 204 }); }
    if (path === '/citas/mias') return route.fulfill({ json: state.appointments.filter(c => c.estado !== 'disponible') });
    if (path === '/citas/disponibilidad/semana') {
      const payload = request.postDataJSON();
      state.configuration = payload.configuracion;
      state.blocks = [...state.blocks.filter(b => b.origen !== 'agenda'), ...payload.bloqueos.map((b: any, i: number) => ({ id: `draft-${i}`, ...b, origen: 'agenda' }))];
      return route.fulfill({ json: { citas: [], omittedOccupiedBlocks: 0 } });
    }
    if (path === '/servicios' && request.method() === 'POST') { const item = { id: 'new', ...request.postDataJSON(), activo: true }; state.services.push(item); return route.fulfill({ status: 201, json: item }); }
    if (path === '/servicios') return route.fulfill({ json: state.services });
    if (path.startsWith('/servicios/')) {
      const service = state.services.find(s => s.id === path.split('/').pop())!;
      if (request.method() === 'DELETE') { service.activo = false; return route.fulfill({ status: 204 }); }
      Object.assign(service, request.postDataJSON()); return route.fulfill({ json: service });
    }
    if (path.startsWith('/lugartrabajo') && request.method() === 'PUT') { Object.assign(state.profile.lugarTrabajo, request.postDataJSON()); return route.fulfill({ json: state.profile.lugarTrabajo }); }
    if (path === '/lugartrabajo') return route.fulfill({ json: [state.profile.lugarTrabajo] });
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil-profesional');
  await expect(page.locator('#professional-name')).toHaveText('Barbero real');
  return state;
}

test('servicios completos: crear, editar, desactivar, activar y retirar con persistencia al recargar', async ({ page }) => {
  await fixture(page);
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  await page.getByRole('tab', { name: 'Servicios' }).click();
  await expect(page.locator('.pro-service-item')).toHaveCount(7);
  await page.getByRole('button', { name: 'Agregar servicio' }).click();
  const dialog = page.locator('#service-modal');
  await dialog.getByLabel('Nombre del servicio').fill('Corte nuevo'); await dialog.getByLabel('Descripción').fill('Descripción nueva');
  await dialog.getByLabel('Precio (CLP)').fill('18000'); await dialog.getByLabel('Duración (minutos)').fill('45');
  await dialog.getByRole('button', { name: 'Guardar servicio' }).click();
  await expect(page.locator('.pro-service-item')).toHaveCount(8);
  const card = () => page.locator('.pro-service-item').filter({ hasText: 'Corte nuevo' });
  await card().getByRole('button', { name: 'Editar', exact: true }).click();
  await dialog.getByLabel('Precio (CLP)').fill('20000'); await dialog.getByRole('button', { name: 'Guardar servicio' }).click();
  await card().getByRole('button', { name: 'Desactivar', exact: true }).click();
  await expect(card().getByText('Inactivo', { exact: true })).toBeVisible();
  await page.reload(); await page.getByRole('tab', { name: 'Servicios' }).click(); await expect(card().getByText('Inactivo', { exact: true })).toBeVisible();
  await card().getByRole('button', { name: 'Activar', exact: true }).click();
  page.on('dialog', dialog => dialog.accept());
  await card().getByRole('button', { name: 'Retirar', exact: true }).click();
  await expect(card().getByText('Inactivo', { exact: true })).toBeVisible();
  await expect(page.getByText('Servicio retirado. Su historial se conserva.')).toBeVisible();
});

test('perfil, fotografía y lugar de trabajo guardan y conservan los valores al recargar', async ({ page }) => {
  const state = await fixture(page);
  await page.getByLabel('Biografía', { exact: true }).fill('Biografía actualizada');
  await page.getByLabel('Especialidades', { exact: false }).fill('Barba, Corte clásico');
  await page.getByRole('button', { name: 'Guardar perfil profesional', exact: true }).click();
  await expect(page.getByText('Perfil profesional guardado.', { exact: true })).toBeVisible();
  await expect(page.locator('.pro-verified')).toBeVisible();
  const photoChooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Cambiar foto de perfil' }).click();
  await (await photoChooser).setFiles('tests/fixtures/profile.png');
  await expect(page.getByText('Fotografía guardada.', { exact: true })).toBeVisible();
  await page.locator('.pro-nav-link[href="#mi-negocio"]').click();
  await page.getByRole('button', { name: 'Editar lugar', exact: true }).click();
  await page.locator('#workplace-form input[name="direccion"]').fill('Centro 456');
  await page.locator('#save-workplace').click();
  await expect.poll(() => state.profile.lugarTrabajo.direccion).toBe('Centro 456');
  await page.reload();
  await expect(page.getByLabel('Biografía', { exact: true })).toHaveValue('Biografía actualizada');
  await expect(page.getByLabel('Especialidades', { exact: false })).toHaveValue('Barba, Corte clásico');
  await expect(page.locator('.professional-photo-preview')).toHaveAttribute('src', photo);
  await expect(page.locator('#workplace-form input[name="direccion"]')).toHaveValue('Centro 456');
});

test('un fallo de guardado no muestra éxito ni cambia valores persistidos', async ({ page }) => {
  const state = await fixture(page); state.fail = '/profesional/perfil';
  await page.getByLabel('Biografía', { exact: true }).fill('No se guardará');
  await page.getByRole('button', { name: 'Guardar perfil profesional', exact: true }).click();
  await expect(page.locator('#editar-perfil-profesional [role="alert"]')).toContainText('error de prueba');
  await expect(page.getByText('Perfil profesional guardado.', { exact: true })).toHaveCount(0);
  state.fail = ''; await page.reload(); await expect(page.getByLabel('Biografía', { exact: true })).toHaveValue('Biografía original');
});

test('navegación muestra un apartado a la vez y conserva enlaces directos', async ({ page }) => {
  const state = await fixture(page);
  state.appointments.push({ ...state.appointments[0], id: 'old', estado: 'finalizada', fecha_hora: '2029-12-01T14:00:00Z' });
  await page.reload();
  await expect(page.locator('#mi-perfil')).toBeVisible();
  await expect(page.locator('#mi-negocio')).toBeHidden();
  await expect(page.locator('#organizacion')).toBeHidden();
  await expect(page.locator('#mis-citas')).toBeHidden();
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await expect(page.locator('#mi-perfil')).toBeHidden();
  await expect(page.locator('#mis-citas')).toBeVisible();
  await expect(page.locator('#pro-view-title')).toHaveText('Mis citas');
  await expect(page.locator('.professional-statistics')).toBeVisible();
  await expect(page.locator('#panel-calendario')).toBeVisible();
  await expect(page.locator('#panel-reservas')).toBeHidden();
  await page.getByRole('tab', { name: 'Calendario y bloqueos' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Reservas' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-reservas .appointment-card')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Historial' }).click();
  await expect(page.locator('#panel-reservas .appointment-card')).toHaveCount(1);
  await expect(page.locator('#panel-reservas')).toContainText('Historial de citas');
  await expect(page.locator('.professional-statistics')).toBeVisible();
  await page.reload();
  await expect(page.locator('#mis-citas')).toBeVisible();
  await expect(page.locator('#panel-calendario')).toBeVisible();
  await page.goto('/perfil-profesional#servicios-profesional');
  await expect(page.locator('#organizacion')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Servicios' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-servicios')).toBeVisible();
});

test('vistas diaria, semanal y mensual usan el backend; bloqueos y estadísticas se actualizan', async ({ page }) => {
  const state = await fixture(page);
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await expect(page.locator('.professional-calendar-grid .is-confirmada')).toContainText('Cliente real');
  await expect(page.locator('.professional-calendar-grid .is-descanso')).toContainText('Descanso');
  const view = page.getByLabel('Vista del calendario', { exact: true });
  await expect(page.locator('.barber-slot.is-break[title="Gestionar en Citas y bloqueos"]').first()).toBeDisabled();
  await page.getByLabel('Fecha del calendario', { exact: true }).fill('2030-01-08');
  await view.selectOption('dia'); await expect(page.locator('.professional-calendar-day')).toHaveCount(1);
  await expect.poll(() => state.requests.some(r => r.includes('calendario?desde=2030-01-08&hasta=2030-01-08'))).toBe(true);
  await view.selectOption('mes'); await expect(page.locator('.professional-calendar-day')).toHaveCount(31);
  await page.getByRole('button', { name: 'Período siguiente', exact: true }).click();
  await expect(page.getByLabel('Fecha del calendario', { exact: true })).toHaveValue('2030-02-08');
  await expect.poll(() => state.requests.some(r => r.includes('calendario?desde=2030-02-01&hasta=2030-02-28'))).toBe(true);
  await page.getByLabel('Fecha del calendario', { exact: true }).fill('2030-01-08');
  await view.selectOption('dia');
  page.on('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Retirar bloqueo', exact: true }).click();
  await expect(page.locator('.professional-calendar-grid .is-descanso')).toHaveCount(0);
  await page.getByText('Agregar bloqueo o descanso', { exact: true }).click();
  await page.getByLabel('Día del bloqueo').fill('2030-01-08');
  await page.getByLabel('Inicio del bloqueo').fill('16:00'); await page.getByLabel('Fin del bloqueo').fill('17:00');
  await page.getByRole('button', { name: 'Guardar bloqueo', exact: true }).click();
  await expect(page.getByText('Bloqueo guardado.', { exact: true })).toBeVisible();
  await expect(page.locator('.professional-calendar-grid .is-bloqueado')).toHaveCount(1);
  const stats = page.locator('.professional-statistics');
  await expect(stats).toBeVisible();
  await stats.getByLabel('Desde', { exact: true }).fill('2030-02-01'); await stats.getByLabel('Hasta', { exact: true }).fill('2030-02-28');
  await stats.getByRole('button', { name: 'Consultar estadísticas' }).click();
  await expect(stats.locator('.pro-stat-card').filter({ hasText: 'Total de citas' }).locator('strong')).toHaveText('0');
});

test('descanso publicado en el editor semanal persiste sin depender de localStorage', async ({ page }) => {
  const state = await fixture(page);
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await page.getByLabel('Hora de entrada', { exact: true }).selectOption('09:00');
  await page.getByLabel('Hora de cierre', { exact: true }).selectOption('10:00');
  await page.getByLabel('Duración de cada bloque', { exact: true }).selectOption('30');
  await page.locator('.barber-slot:not(:disabled)').first().click(); await page.getByRole('button', { name: 'Descanso', exact: true }).click();
  await expect.poll(() => state.blocks.some(b => b.origen === 'agenda')).toBe(true);
  await page.evaluate(() => { for (const key of Object.keys(localStorage)) if (key.startsWith('barber-calendar-slots')) localStorage.removeItem(key); });
  await page.reload(); await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
  await expect(page.locator('.barber-slot.is-break').first()).toBeVisible();
});

for (const theme of ['original', 'light', 'dark']) for (const width of [1920, 1366, 768, 390, 320]) {
  test(`panel ${theme} a ${width}px sin desbordamiento`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 900 });
    await fixture(page, theme);
    await expect(page.locator('.pro-service-item')).toHaveCount(7);
    await page.locator('.pro-nav-link[href="#mis-citas"]').click();
    await expect(page.locator('.professional-calendar-grid .is-confirmada')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if ((width === 1920 || width === 390) && theme === 'light') await page.screenshot({ path: `test-results/professional-${theme}-${width}.png`, fullPage: true });
  });
}
