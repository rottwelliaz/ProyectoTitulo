import { fulfillDataTable } from './datatable-fixture';
import { test, expect } from '@playwright/test';
import { canAccess, loginDestination } from '../src/lib/access';

const pending = { id: 2, nombre: 'Barbero Pendiente', email: 'barbero@test.invalid', telefono: '912345678', rol: 'barbero', aprobado: false, activo: true,
  fecha_creacion: '2026-01-01', solicitudProfesional: { estado: 'pendiente' } };

for (const rol of ['cliente', 'barbero']) test(`registro envía rol ${rol} y muestra SweetAlert2 con el resultado`, async ({ page }) => {
  let received: any;
  await page.route('**/api/usuarios', route => { received = route.request().postDataJSON(); return fulfillDataTable(route, { status: 201, json: { ...pending, rol, aprobado: rol === 'cliente' } }); });
  await page.goto('/registro');
  await page.locator('[name=nombre]').fill('Cuenta Prueba'); await page.locator('[name=email]').fill(pending.email);
  await page.locator('[name=password]').fill('password-test-2026'); await page.locator('[name=telefono]').fill(pending.telefono);
  await page.locator('label').filter({ has: page.locator(`[name=rol][value=${rol}]`) }).click();
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  await expect(page.locator('.cbc-notification')).toContainText(rol === 'barbero' ? 'Tu cuenta de barbero está pendiente de aprobación.' : 'Cuenta creada correctamente.');
  expect(received.rol).toBe(rol); expect(received.aprobado).toBeUndefined();
});

test('barbero pendiente inicia sesión y llega a Mi perfil conservando su rol', async ({ page }) => {
  let professionalCalls = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/profesional/')) professionalCalls++;
    return fulfillDataTable(route, { json: path.endsWith('/auth/login') ? { token: 'pending-test', user: pending }
      : path.endsWith('/auth/me') ? pending : path.endsWith('/solicitud-profesional') ? pending.solicitudProfesional : [] });
  });
  await page.goto('/login?redirect=/perfil-profesional');
  await page.locator('[name=email]').fill(pending.email); await page.locator('[name=password]').fill('password-test-2026');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(/\/perfil\/?$/);
  await expect(page.locator('#profile-role')).toHaveText('barbero');
  await expect(page.locator('#professional-application')).toBeHidden();
  await expect(page.locator('#apply-professional')).toBeHidden();
  await expect(page.locator('#refresh-application')).toBeHidden();
  expect(professionalCalls).toBe(0);
  await page.goto('/perfil-profesional'); await expect(page).toHaveURL(/\/perfil\/?$/);
  expect(professionalCalls).toBe(0);
});

test('navegación considera aprobación separada del rol', () => {
  expect(canAccess('/perfil-profesional', 'barbero', false)).toBe(false);
  expect(canAccess('/perfil-profesional', 'barbero', true)).toBe(true);
  expect(canAccess('/perfil', 'barbero', false)).toBe(true);
  expect(loginDestination('/perfil-profesional', 'barbero', false)).toBe('/perfil');
});

for (const path of ['/admin', '/admin-barberos']) for (const fail of [false, true]) test(`${path}: aprobación ${fail ? 'fallida conserva la solicitud' : 'exitosa la retira'}`, async ({ page }) => {
  let approved = false;
  await page.addInitScript(() => localStorage.setItem('token', 'admin-test'));
  await page.route('**/api/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint.endsWith('/auth/me')) return fulfillDataTable(route, { json: { ...pending, id: 1, rol: 'admin', aprobado: true } });
    const users = approved ? [] : [pending];
    if (endpoint.endsWith('/admin/dashboard')) return fulfillDataTable(route, { json: { stats: {}, clientes: [], admins: [], barberos: users, barberosPendientes: users } });
    if (endpoint.endsWith('/barberos/pendientes')) return fulfillDataTable(route, { json: users });
    if (endpoint.endsWith('/aprobar-barbero')) {
      if (fail) return fulfillDataTable(route, { status: 409, json: { message: 'La solicitud cambió. Actualiza el panel.' } });
      approved = true; return fulfillDataTable(route, { json: { ...pending, aprobado: true } });
    }
    return fulfillDataTable(route, { json: [] });
  });
  await page.goto(path);
  if (path === '/admin') await page.locator('[data-admin-tab=pendientes]').click();
  const approve = page.getByRole('button', { name: path === '/admin' ? 'Aprobar' : 'Aprobar barbero', exact: true });
  await approve.click();
  await expect(page.locator('.cbc-notification')).toContainText(fail ? 'La solicitud cambió.' : 'El barbero ha sido aprobado correctamente.');
  expect(approved).toBe(!fail);
  if (fail) { await page.getByRole('button', { name: 'Entendido', exact: true }).click(); await expect(approve).toBeVisible(); }
  else await expect(approve).toHaveCount(0);
});
