import { test, expect, type Page } from '@playwright/test';
import { ready } from './quality-fixture';

const currentPassword = 'Clave actual de prueba 2026';
const newPassword = 'Nueva clave de prueba 2026';
async function profileFixture(page: Page, role = 'cliente', theme = 'original') {
  const user = { id: 1, rol: role, nombre: 'Cliente Prueba', email: 'password@test.invalid', telefono: '912345678',
    aprobado: true, fecha_creacion: '2026-01-01T12:00:00Z' };
  const calls: unknown[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    if (path === '/auth/me/password') {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { message: 'Contraseña actualizada correctamente.' } });
    }
    return route.fulfill({ json: path === '/auth/me' ? user : path === '/usuarios/solicitud-profesional' ? null : [] });
  });
  await page.goto('/login');
  await page.evaluate(({ user, theme }) => {
    localStorage.setItem('token', 'password-test-token');
    localStorage.setItem('user', JSON.stringify({ ...user, rol: 'admin' }));
    localStorage.setItem('ui-theme', theme);
  }, { user, theme });
  await ready(page, '/perfil');
  return { calls, user };
}
async function fill(page: Page, next = newPassword, confirm = next, current = currentPassword) {
  await page.getByLabel('Contraseña actual', { exact: true }).fill(current);
  await page.getByLabel('Nueva contraseña', { exact: true }).fill(next);
  await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill(confirm);
}
const submit = (page: Page) => page.getByRole('button', { name: 'Guardar nueva contraseña' }).click();

for (const theme of ['original', 'light', 'dark']) {
  for (const width of [1280, 390, 320]) {
    test(`formulario ${theme} a ${width}px, visibilidad y guardado`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      const { calls, user } = await profileFixture(page, 'cliente', theme);
      await fill(page);
      const form = page.locator('#password-change-form');
      const toggle = page.getByLabel('Mostrar contraseñas');
      for (const input of await form.locator('input[type=password]').all()) await expect(input).toHaveAttribute('type', 'password');
      await toggle.check();
      await expect(form.locator('input[type=text]')).toHaveCount(3);
      await toggle.uncheck();
      await expect(form.locator('input[type=password]')).toHaveCount(3);
      await expect(page.getByLabel('Contraseña actual', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
      await expect(page.getByLabel('Nueva contraseña', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
      const overflow = await form.evaluate(el => ({
        document: document.documentElement.scrollWidth - innerWidth,
        fields: [...el.querySelectorAll('input, label, button')].filter(child => {
          const bounds = child.getBoundingClientRect(); return bounds.left < 0 || bounds.right > innerWidth;
        }).length,
      }));
      expect(overflow).toEqual({ document: 0, fields: 0 });
      if (width !== 320) await form.screenshot({ path: info.outputPath(`password-${theme}-${width}.png`) });
      await toggle.check();
      await submit(page);
      await expect(page.locator('.cbc-notification')).toContainText('actualizada correctamente');
      expect(calls).toEqual([{ currentPassword, newPassword, confirmPassword: newPassword }]);
      for (const input of await form.locator('input:not([type=checkbox])').all()) {
        await expect(input).toHaveValue('');
        await expect(input).toHaveAttribute('type', 'password');
      }
      await expect(toggle).not.toBeChecked();
      await expect(page.locator('#profile-input-nombre')).toHaveValue(user.nombre);
      await expect(page.locator('#profile-input-email')).toHaveValue(user.email);
      const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      expect(storage).not.toContain(currentPassword);
      expect(storage).not.toContain(newPassword);
    });
  }
}

for (const [next, confirm, current, error] of [
  [newPassword, 'Confirmación diferente de prueba', currentPassword, 'no coinciden'],
  [currentPassword, currentPassword, currentPassword, 'diferente de la actual'],
  ['1234567', '1234567', currentPassword, 'La contraseña debe tener al menos 8 caracteres'],
  [' '.repeat(12), ' '.repeat(12), currentPassword, 'solo espacios'],
  ['á'.repeat(37), 'á'.repeat(37), currentPassword, '72 bytes'],
  [newPassword, newPassword, '', 'contraseña actual'],
]) {
  test(`validación local: ${error}`, async ({ page }) => {
    const { calls } = await profileFixture(page);
    await fill(page, next, confirm, current);
    await submit(page);
    await expect(page.locator('#password-change-message')).toContainText(error);
    expect(calls).toHaveLength(0);
  });
}

test('bloquea solicitudes duplicadas durante el guardado y conserva espacios de la contraseña', async ({ page }) => {
  await profileFixture(page);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let count = 0;
  const next = ' Una nueva clave segura 2026 ';
  await page.route('**/api/auth/me/password', async route => {
    count++;
    expect(route.request().postDataJSON()).toEqual({ currentPassword, newPassword: next, confirmPassword: next });
    await wait;
    await route.fulfill({ json: { message: 'Correcto' } });
  });
  await fill(page, next);
  await page.locator('#password-change-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await expect(page.locator('#password-change-form')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
  await expect.poll(() => count).toBe(1);
  release();
  await expect(page.locator('.cbc-notification')).toContainText('actualizada correctamente');
  expect(count).toBe(1);
});

for (const theme of ['light', 'dark']) for (const length of [7, 8, 9]) {
  test(`cambio de contraseña de ${length} caracteres en ${theme}`, async ({ page }) => {
    const { calls } = await profileFixture(page, 'cliente', theme);
    const next = 'x'.repeat(length);
    await fill(page, next, next, 'legacy');
    await submit(page);
    if (length < 8) {
      await expect(page.locator('#password-change-message')).toHaveText('La contraseña debe tener al menos 8 caracteres');
      expect(calls).toHaveLength(0);
    } else {
      await expect(page.locator('.cbc-notification')).toContainText('actualizada correctamente');
      expect(calls).toEqual([{ currentPassword: 'legacy', newPassword: next, confirmPassword: next }]);
    }
  });
}

for (const [status, message, expected] of [
  [400, 'La contraseña actual es incorrecta.', 'actual es incorrecta'],
  [429, 'Demasiados intentos. Espera unos minutos e inténtalo nuevamente.', 'Demasiados intentos'],
  [500, 'Error interno', 'No se pudo cambiar la contraseña'],
] as const) {
  test(`error del servidor ${status} permite reintentar sin cerrar la sesión`, async ({ page }) => {
    await profileFixture(page);
    await page.route('**/api/auth/me/password', route => route.fulfill({ status, json: { message } }));
    await fill(page);
    await submit(page);
    await expect(page.locator('#password-change-message')).toContainText(expected);
    await expect(page.getByRole('button', { name: 'Guardar nueva contraseña' })).toBeEnabled();
    await expect(page).toHaveURL(/\/perfil$/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('password-test-token');
  });
}

test('fallo de comunicación no muestra éxito y permite reintentar', async ({ page }) => {
  await profileFixture(page);
  await page.route('**/api/auth/me/password', route => route.abort('failed'));
  await fill(page);
  await submit(page);
  await expect(page.locator('#password-change-message')).toContainText('Revisa tu conexión');
  await expect(page.getByRole('button', { name: 'Guardar nueva contraseña' })).toBeEnabled();
});

test('sesión expirada limpia credenciales y muestra aviso al volver al login', async ({ page }) => {
  await profileFixture(page);
  await page.route('**/api/auth/me/password', route => route.fulfill({ status: 401, json: { message: 'Token inválido' } }));
  await fill(page);
  await submit(page);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.locator('#login-message')).toContainText('Tu sesión expiró');
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  expect(await page.evaluate(() => sessionStorage.getItem('password-change-session-expired'))).toBeNull();
});

test('sin autenticación, Mi Perfil redirige al inicio de sesión', async ({ page }) => {
  await page.goto('/perfil');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.locator('#password-change-form')).toHaveCount(0);
});

for (const role of ['barbero', 'admin']) {
  for (const width of [1280, 390]) {
  test(`${role} accede desde su panel y cambia su contraseña a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { calls } = await profileFixture(page, role);
    await ready(page, role === 'barbero' ? '/perfil-profesional' : '/admin');
    await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
    await page.locator('[data-session-dropdown]').getByRole('link', { name: 'Mi perfil', exact: true }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.locator('#password-change-form')).toBeVisible();
    await fill(page);
    await submit(page);
    await expect(page.locator('.cbc-notification')).toContainText('actualizada correctamente');
    expect(calls).toEqual([{ currentPassword, newPassword, confirmPassword: newPassword }]);
    await expect(page.locator('[data-session-role]')).toHaveText(role === 'barbero' ? 'Barbero' : 'Administrador');
  });
  }
}
