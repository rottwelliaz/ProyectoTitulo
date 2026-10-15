import { test, expect, type Page } from '@playwright/test';
import { registrationError, newPasswordError } from '../src/lib/registration';

const profile = { id: 11, biografia: 'Especialista en cortes clásicos y modernos.', especialidades: ['Fade', 'Barba'], foto_perfil: null,
  usuario: { nombre: 'Juan Pérez', foto_perfil: null }, lugarTrabajo: { nombre_barberia: 'Club Centro', direccion: 'Concepción 123' },
  servicios: [{ id: 'corte', nombre_servicio: 'Corte clásico', descripcion: 'Asesoría incluida', precio: 10000, duracion_minutos: 30 },
    { id: 'barba', nombre_servicio: 'Barba', descripcion: null, precio: 5000, duracion_minutos: 15 }] };
const user = { id: 1, nombre: 'Cliente', email: 'cliente@test.invalid', rol: 'cliente', aprobado: true };
async function mockProfile(page: Page, data: unknown = profile) {
  await page.route('**/usuarios/barberos/11/perfil', route => route.fulfill({ json: data }));
  await page.route('**/usuarios/barberos/11/disponibilidad?*', route => route.fulfill({ json: { citas: [{ id: 'slot', fecha_hora: '2035-01-15T15:00:00Z', disponibleHasta: '2035-01-15T16:00:00Z' }], servicios: profile.servicios } }));
}
for (const theme of ['original', 'light', 'dark']) {
  test(`perfil público completo sin sesión, tema ${theme} y reserva con retorno`, async ({ page }, testInfo) => {
    await page.addInitScript(value => localStorage.setItem('ui-theme', value), theme);
    await mockProfile(page);
    await page.goto('/barbero?barbero=11');
    await expect(page.getByRole('heading', { name: 'Juan Pérez' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const text of ['Especialista en cortes clásicos y modernos.', 'Fade', 'Club Centro', 'Concepción 123', '30 min', '12:00']) await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
    const reserve = page.getByRole('link', { name: 'Reservar una hora' });
    await expect(reserve).toHaveAttribute('href', '/login?redirect=%2Fbooking%3Fbarbero%3D11%23servicios');
    await page.screenshot({ path: testInfo.outputPath(`perfil-${theme}.png`), fullPage: true });
    await reserve.click(); await expect(page).toHaveURL(/login\?redirect=/);
    await page.route('**/auth/login', route => route.fulfill({ json: { token: 'valid', user } }));
    await page.route('**/auth/me', route => route.fulfill({ json: user }));
    await page.route('**/citas/barberos', route => route.fulfill({ json: [] }));
    await page.locator('[name=email]').fill(user.email); await page.locator('[name=password]').fill('legacy');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/booking\?barbero=11#servicios/);
  });
}
test('fecha y servicio actualizan disponibilidad; error, vacío y perfil inexistente tienen mensajes', async ({ page }) => {
  await mockProfile(page); await page.goto('/barbero?barbero=11');
  await expect(page.getByText('12:00', { exact: true })).toBeVisible();
  await page.route('**/usuarios/barberos/11/disponibilidad?*', route => route.fulfill({ json: { citas: [], servicios: profile.servicios } }));
  const request = page.waitForRequest(r => r.url().includes('servicioId=barba'));
  await page.getByLabel('Servicio', { exact: true }).selectOption('barba'); await request;
  await expect(page.getByText('No hay horarios disponibles', { exact: false })).toBeVisible();
  await page.route('**/usuarios/barberos/11/disponibilidad?*', route => route.fulfill({ status: 503, json: { message: 'No se pudo consultar la disponibilidad.' } }));
  await page.getByLabel('Fecha', { exact: true }).fill('2035-01-15');
  await expect(page.getByRole('alert')).toContainText('No se pudo consultar');
  await page.route('**/usuarios/barberos/11/perfil', route => route.fulfill({ status: 404, json: { message: 'Este perfil no está disponible' } }));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('Este perfil no está disponible');
});
test('perfil incompleto y texto malicioso se muestran sin ejecutar HTML; vista móvil sin desborde', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockProfile(page, { ...profile, usuario: { nombre: '<img src=x onerror=alert(1)>', foto_perfil: 'javascript:alert(1)' }, biografia: '<script>alert(1)</script>', especialidades: [], servicios: [], lugarTrabajo: null });
  await page.goto('/barbero?barbero=11');
  await expect(page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.getByText('No hay servicios activos por el momento.')).toBeVisible();
  await expect(page.getByText('Especialidades por informar.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reservar una hora' })).toHaveCount(0);
  expect(await page.locator('.public-identity img').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('cliente autenticado reserva directamente y barbero solo consulta', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/auth/me', route => route.fulfill({ json: user })); await mockProfile(page);
  await page.goto('/barbero?barbero=11');
  await expect(page.getByRole('link', { name: 'Reservar una hora' })).toHaveAttribute('href', '/booking?barbero=11#servicios');
  await page.route('**/auth/me', route => route.fulfill({ json: { ...user, rol: 'barbero' } }));
  await page.reload(); await expect(page.getByText('Las reservas se realizan con una cuenta de cliente.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Reservar una hora' })).toHaveCount(0);
});
test('registro valida antes de enviar incluso al omitir la validación nativa; muestra duplicados', async ({ page }) => {
  let sent = 0;
  await page.route('**/usuarios', route => { sent++; return route.fulfill({ status: 409, json: { message: 'El correo electrónico ya está registrado' } }); });
  await page.goto('/registro');
  await page.locator('[name=nombre]').fill('María Pérez'); await page.locator('[name=email]').fill('invalido');
  await page.locator('[name=password]').fill('corta'); await page.locator('[name=telefono]').fill('912345678');
  await page.locator('#register-form').evaluate((form: HTMLFormElement) => { form.noValidate = true; });
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('#register-message')).toContainText('correo electrónico válido'); expect(sent).toBe(0);
  await page.locator('[name=email]').fill('maria@example.com'); await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('#register-message')).toContainText('al menos 12 caracteres'); expect(sent).toBe(0);
  await page.locator('[name=password]').fill('á'.repeat(37)); await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('#register-message')).toContainText('72 bytes'); expect(sent).toBe(0);
  await page.locator('[name=password]').fill('una clave larga'); await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.locator('#register-message')).toContainText('ya está registrado'); expect(sent).toBe(1);
});
test('frontend: obligatorios, espacios y límite bcrypt', () => {
  const value = { nombre: 'María Pérez', email: 'maria@example.com', password: 'una clave larga', telefono: '912345678' };
  expect(registrationError(value)).toBeNull();
  for (const key of ['nombre', 'email', 'password', 'telefono']) expect(registrationError({ ...value, [key]: '' })).not.toBeNull();
  expect(newPasswordError(' '.repeat(12))).not.toBeNull(); expect(newPasswordError('á'.repeat(37))).not.toBeNull();
});
test('login informa límite de intentos sin guardar sesión', async ({ page }) => {
  await page.route('**/auth/login', route => route.fulfill({ status: 429, headers: { 'Retry-After': '60' }, json: { message: 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.' } }));
  await page.goto('/login'); await page.locator('[name=email]').fill('cliente@example.com'); await page.locator('[name=password]').fill('legacy');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#login-message')).toContainText('Demasiados intentos');
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});
test('borrar la fecha cancela la carga y descarta una respuesta tardía', async ({ page }) => {
  await mockProfile(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/usuarios/barberos/11/disponibilidad?*', async route => {
    await gate;
    await route.fulfill({ json: { citas: [{ id: 'late', fecha_hora: '2035-01-15T15:00:00Z' }] } }).catch(() => undefined);
  });
  await page.goto('/barbero?barbero=11');
  await expect(page.getByText('Consultando horarios...')).toBeVisible();
  await page.getByLabel('Fecha', { exact: true }).fill('');
  await expect(page.getByText('Selecciona una fecha.')).toBeVisible();
  release();
  await expect(page.getByText('12:00', { exact: true })).toHaveCount(0);
});
