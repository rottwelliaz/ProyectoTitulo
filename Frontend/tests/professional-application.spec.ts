import { test, expect, type Page } from '@playwright/test';

async function fixture(page: Page, rol = 'cliente', aprobado = true, theme = 'light') {
  const state = {
    user: { id: 1, rol, aprobado, activo: true, nombre: 'Cuenta de prueba', email: 'cuenta@test.invalid', telefono: '912345678', fecha_creacion: '2026-01-01' },
    application: null as null | { estado: string }, reads: 0, writes: 0, fail: false,
  };
  await page.addInitScript(theme => {
    localStorage.setItem('token', 'application-test');
    localStorage.setItem('user', JSON.stringify({ id: 1, rol: 'cliente' }));
    localStorage.setItem('ui-theme', theme);
  }, theme);
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: state.user });
    if (path.endsWith('/solicitud-profesional')) {
      if (route.request().method() === 'POST') {
        state.writes++;
        state.application = { estado: 'pendiente' };
        state.user.rol = 'barbero';
        state.user.aprobado = false;
        return route.fulfill({ status: 201, json: state.application });
      }
      state.reads++;
      if (state.fail) return route.fulfill({ status: 500, json: { message: 'No se pudo consultar la solicitud.' } });
      return route.fulfill({ json: state.application });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

for (const theme of ['light', 'dark']) {
  for (const [rol, aprobado] of [['cliente', true], ['barbero', false], ['barbero', true], ['admin', true]] as const) {
    test(`${rol} aprobado=${aprobado}: visibilidad exclusiva en ${theme}`, async ({ page }) => {
      const state = await fixture(page, rol, aprobado, theme);
      await page.goto('/perfil');
      await expect(page.locator('#profile-role')).toHaveText(rol);
      if (rol === 'cliente') {
        await expect(page.locator('#professional-application')).toBeVisible();
        await expect(page.locator('#apply-professional')).toBeVisible();
        await expect(page.locator('#refresh-application')).toBeVisible();
        expect(state.reads).toBe(1);
      } else {
        await expect(page.locator('#professional-application')).toBeHidden();
        await expect(page.locator('#apply-professional')).toBeHidden();
        await expect(page.locator('#refresh-application')).toBeHidden();
        await page.locator('#apply-professional').evaluate((button: HTMLButtonElement) => button.click());
        expect(state.reads).toBe(0);
        expect(state.writes).toBe(0);
      }
    });
  }
}

test('cliente pendiente consulta el estado sin enviar solicitudes duplicadas', async ({ page }) => {
  const state = await fixture(page);
  state.application = { estado: 'pendiente' };
  await page.goto('/perfil');
  await expect(page.locator('#application-status')).toContainText('pendiente');
  await expect(page.locator('#apply-professional')).toBeHidden();
  await page.locator('#apply-professional').evaluate((button: HTMLButtonElement) => button.click());
  await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect.poll(() => state.reads).toBe(2);
  expect(state.writes).toBe(0);
});

test('el envío único respeta el rol devuelto por el servidor y oculta el apartado', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/perfil');
  await expect(page.locator('#apply-professional')).toBeVisible();
  await page.locator('#apply-professional').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('#profile-role')).toHaveText('barbero');
  await expect(page.locator('#professional-application')).toBeHidden();
  expect(state.writes).toBe(1);
  expect(state.reads).toBe(1);
});

test('una aprobación externa oculta el apartado al revalidar la sesión', async ({ page }) => {
  const state = await fixture(page);
  state.application = { estado: 'pendiente' };
  await page.goto('/perfil');
  await expect(page.locator('#application-status')).toContainText('pendiente');
  state.user.rol = 'barbero';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('html')).toHaveAttribute('data-user-role', 'barbero');
  await expect(page.locator('#professional-application')).toBeHidden();
  await page.locator('#apply-professional').evaluate((button: HTMLButtonElement) => button.click());
  expect(state.writes).toBe(0);
});

test('actualizar estado revalida el rol antes de consultar solicitudes', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/perfil');
  await expect(page.locator('#apply-professional')).toBeVisible();
  state.user.rol = 'admin';
  await page.getByRole('button', { name: 'Actualizar estado', exact: true }).click();
  await expect(page.locator('#professional-application')).toBeHidden();
  expect(state.reads).toBe(1);
});

test('un fallo de consulta no habilita el envío de una solicitud desconocida', async ({ page }) => {
  const state = await fixture(page);
  state.fail = true;
  await page.goto('/perfil');
  await expect(page.locator('#application-status')).toContainText('No se pudo consultar');
  await expect(page.locator('#apply-professional')).toBeHidden();
  expect(state.writes).toBe(0);
});

test('invitado vuelve al login sin mostrar el apartado', async ({ page }) => {
  await page.goto('/perfil');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.locator('#professional-application')).toHaveCount(0);
});
