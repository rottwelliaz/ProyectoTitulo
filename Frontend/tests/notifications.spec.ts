import { fulfillDataTable } from './datatable-fixture';
import { test, expect, type Page } from '@playwright/test';
import { confirmAction, notifyError, notifySuccess, notifyWarning } from '../src/lib/notifications';
import { qualityFixture, ready, profile } from './quality-fixture';
import { installNotificationModule, notificationModuleUrl } from './notification-fixture';

test.beforeEach(async ({ page }) => { await installNotificationModule(page); });

const popup = (page: Page) => page.locator('.cbc-notification');
async function notify(page: Page, kind: 'notifySuccess' | 'notifyError' | 'notifyWarning', text: string) {
  await page.evaluate(async ({ kind, text, path }) => {
    const notifications = await import(/* @vite-ignore */ path);
    void notifications[kind](text);
  }, { kind, text, path: notificationModuleUrl });
  await expect(popup(page)).toBeVisible();
}

test('la utilidad se puede llamar durante SSR sin acceder al navegador', async () => {
  expect(await confirmAction('Prueba SSR')).toBe(false);
  expect(await notifyError()).toBe(false);
  expect(await notifyWarning('Prueba SSR')).toBe(false);
  await notifySuccess('Prueba SSR');
});

const backgrounds = { original: 'rgb(6, 37, 68)', light: 'rgb(255, 255, 255)', dark: 'rgb(21, 23, 28)' };
for (const theme of ['original', 'light', 'dark'] as const) for (const width of [1280, 768, 320]) {
  test(`avisos ${theme} a ${width}px: éxito, error y advertencia`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width, height: 844 });
    await qualityFixture(page, 'cliente', theme);
    await ready(page, '/home');
    await notify(page, 'notifyWarning', 'Revisa los datos antes de continuar.');
    await expect(popup(page)).toHaveCSS('background-color', backgrounds[theme]);
    await expect(popup(page).locator('.swal2-warning')).toBeVisible();
    await expect(popup(page).getByRole('button', { name: 'Entendido' })).toBeFocused();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
      expect(await popup(page).evaluate(el => el.contains(document.activeElement))).toBe(true);
    }
    const bounds = await popup(page).boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await popup(page).screenshot({ path: info.outputPath(`${theme}-${width}.png`) });
    await page.keyboard.press('Escape');
    await expect(popup(page)).toHaveCount(0);
    await notify(page, 'notifyError', 'No se pudo guardar la información.');
    await expect(popup(page).locator('.swal2-error')).toBeVisible();
    await expect(popup(page)).toHaveCSS('background-color', backgrounds[theme]);
    await popup(page).getByRole('button', { name: 'Entendido' }).click();
    await expect(popup(page)).toHaveCount(0);
    await notify(page, 'notifySuccess', 'Información guardada.');
    await expect(popup(page)).toHaveClass(/swal2-toast/);
    await expect(popup(page)).toHaveCSS('background-color', backgrounds[theme]);
    await expect(popup(page).locator('.swal2-success')).toBeVisible();
    const closeBounds = await popup(page).getByRole('button', { name: 'Cerrar notificación' }).boundingBox();
    expect(closeBounds!.width).toBeGreaterThanOrEqual(44);
    expect(closeBounds!.height).toBeGreaterThanOrEqual(44);
    await popup(page).screenshot({ path: info.outputPath(`toast-${theme}-${width}.png`) });
    await page.mouse.move(0, 843);
    await expect(popup(page)).toHaveCount(0, { timeout: 8000 });
    expect(errors).toEqual([]);
  });
}

test('tema abierto cambia sin recrear el diálogo, conserva campos y persiste al navegar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('token', 'theme-test');
    if (!localStorage.getItem('ui-theme')) localStorage.setItem('ui-theme', 'light');
  });
  await page.route('**/api/**', route => fulfillDataTable(route, { json: route.request().url().endsWith('/auth/me')
    ? { id: 1, rol: 'cliente', nombre: 'Cliente', aprobado: true, activo: true } : [] }));
  await ready(page, '/configuracion');
  await notify(page, 'notifyWarning', 'La notificación conserva su estado.');
  await popup(page).evaluate(el => {
    el.setAttribute('data-instance', 'original');
    const input = document.createElement('input');
    input.className = 'swal2-input'; input.value = 'Valor conservado'; input.setAttribute('aria-label', 'Dato de prueba');
    el.append(input);
  });
  await page.evaluate(() => {
    const radio = document.querySelector<HTMLInputElement>('input[value="dark"]')!;
    radio.checked = true; radio.dispatchEvent(new Event('change'));
  });
  await expect(popup(page)).toHaveCSS('background-color', backgrounds.dark);
  await expect(popup(page)).toHaveAttribute('data-instance', 'original');
  await expect(popup(page).getByLabel('Dato de prueba')).toHaveValue('Valor conservado');
  await expect(popup(page).getByLabel('Dato de prueba')).toHaveCSS('color', 'rgb(248, 250, 252)');
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ui-theme', newValue: 'light' })));
  await expect(popup(page)).toHaveCSS('background-color', backgrounds.light);
  await expect(popup(page).getByLabel('Dato de prueba')).toHaveValue('Valor conservado');
  await page.keyboard.press('Escape');
  // Read the saved preference on the next full navigation, as Layout does in production.
  await page.evaluate(() => localStorage.setItem('ui-theme', 'dark'));
  await page.goto('/home');
  await notify(page, 'notifyWarning', 'Tema conservado después de navegar.');
  await expect(popup(page)).toHaveCSS('background-color', backgrounds.dark);
});

test('una notificación se mantiene encima de un formulario modal y Escape conserva el formulario', async ({ page }) => {
  await qualityFixture(page, 'admin', 'light');
  await ready(page, '/admin');
  await page.locator('[data-admin-tab="clientes"]').click();
  await page.locator('[data-edit-id]').first().click();
  const form = page.locator('#admin-edit-modal');
  await expect(form).toBeVisible();
  await notify(page, 'notifyWarning', 'Información del formulario.');
  await expect(form.locator('.cbc-notification')).toBeVisible();
  const button = popup(page).getByRole('button', { name: 'Entendido' });
  await expect(button).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup(page)).toHaveCount(0);
  await expect(form).toBeVisible();
});

test('textos se muestran sin interpretar HTML y un toast no reemplaza una confirmación', async ({ page }) => {
  await qualityFixture(page);
  await ready(page, '/home');
  const text = '<img src=x onerror="window.notificationAttack=true">';
  await page.evaluate(async ({ text, path }) => {
    const { confirmAction, notifySuccess } = await import(/* @vite-ignore */ path);
    void confirmAction(text);
    void notifySuccess('Operación anterior completada.');
  }, { text, path: notificationModuleUrl });
  await expect(popup(page).locator('.swal2-html-container')).toHaveText(text);
  await expect(popup(page).locator('.swal2-html-container img, .swal2-title img')).toHaveCount(0);
  await expect(popup(page).locator('.swal2-cancel')).toBeFocused();
  await popup(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(popup(page)).toHaveClass(/swal2-toast/);
  await expect(popup(page)).toContainText('Operación anterior completada.');
});

type Action = 'reserva cliente' | 'cita barbero' | 'servicio' | 'bloqueo' | 'lugar de trabajo' | 'agenda copiada' | 'cuenta de usuario';
const actions: Action[] = ['reserva cliente', 'cita barbero', 'servicio', 'bloqueo', 'lugar de trabajo', 'agenda copiada', 'cuenta de usuario'];
async function actionFixture(page: Page, action: Action) {
  const role = action === 'reserva cliente' ? 'cliente' : action === 'cuenta de usuario' ? 'admin' : 'barbero';
  await qualityFixture(page, role);
  const appointment = { id: 'c1', fecha_hora: '2030-01-08T14:00:00Z', estado: 'confirmada', comprobanteTransferencia: null,
    cliente: { id: 1, nombre: 'Cliente' }, barbero: { usuario: { nombre: 'Barbero' } }, servicio: profile.servicios[0] };
  let writes = 0, fail = false;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    if (route.request().method() !== 'GET') {
      writes++;
      if (fail) return fulfillDataTable(route, { status: 500, json: { message: 'SQL password=secreto; stack interno' } });
      return fulfillDataTable(route, { json: { ...appointment, estado: 'cancelada' } });
    }
    if (['/citas/cliente/mias', '/citas/mias'].includes(path)) return fulfillDataTable(route, { json: [appointment] });
    if (path === '/profesional/calendario') return fulfillDataTable(route, { json: { citas: [], bloqueos: [{ id: 'b1', inicio: '2030-01-08T16:00:00Z', fin: '2030-01-08T17:00:00Z', tipo: 'descanso' }], revision: 'v1', configuracion: { startTime: '09:00', endTime: '19:00', blockMinutes: 60 } } });
    return route.fallback();
  });
  await ready(page, role === 'cliente' ? '/mis-citas' : role === 'admin' ? '/admin' : '/perfil-profesional');
  if (role === 'admin') await page.locator('[data-admin-tab="clientes"]').click();
  if (action === 'cita barbero' || action === 'bloqueo') {
    await page.locator('.pro-nav-link[href="#mis-citas"]').click();
    if (action === 'cita barbero') await page.getByRole('tab', { name: 'Reservas', exact: true }).click();
  }
  if (action === 'servicio' || action === 'agenda copiada') {
    await page.locator('.pro-nav-link[href="#organizacion"]').click();
    if (action === 'servicio') await page.getByRole('tab', { name: 'Servicios', exact: true }).click();
    else {
      await page.getByRole('button', { name: 'Copiar semana', exact: true }).click();
      await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
    }
  }
  if (action === 'lugar de trabajo') await page.locator('.pro-nav-link[href="#mi-negocio"]').click();
  const trigger = action === 'reserva cliente' ? page.locator('.client-appointment-cancel')
    : action === 'cita barbero' ? page.locator('.appointment-card').getByRole('button', { name: 'Cancelar', exact: true })
    : action === 'servicio' ? page.getByRole('button', { name: 'Retirar', exact: true })
    : action === 'bloqueo' ? page.getByRole('button', { name: 'Retirar bloqueo', exact: true })
    : action === 'lugar de trabajo' ? page.locator('#delete-workplace')
    : action === 'agenda copiada' ? page.getByRole('button', { name: 'Pegar aquí', exact: true })
    : page.getByRole('button', { name: 'Eliminar cuenta', exact: true });
  return { trigger, writes: () => writes, fail: () => { fail = true; } };
}

for (const action of actions) test(`${action}: cancelar/cerrar no escribe; confirmar una sola vez`, async ({ page }) => {
  const state = await actionFixture(page, action);
  for (const dismiss of ['cancelar', 'escape', 'cerrar']) {
    await state.trigger.click();
    await expect(popup(page)).toBeVisible();
    expect(state.writes()).toBe(0);
    if (dismiss === 'cancelar') await popup(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    else if (dismiss === 'escape') await page.keyboard.press('Escape');
    else await popup(page).getByRole('button', { name: 'Cerrar notificación' }).click();
    await expect(popup(page)).toHaveCount(0);
    expect(state.writes()).toBe(0);
    await expect(state.trigger).toBeEnabled();
    await expect(state.trigger).toBeFocused();
  }
  await state.trigger.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(popup(page)).toHaveCount(1);
  expect(state.writes()).toBe(0);
  await popup(page).locator('.swal2-confirm').click();
  if (action === 'agenda copiada') {
    await expect(page.getByText('Semana copiada. Revisa los bloques antes de guardar.')).toBeVisible();
    expect(state.writes()).toBe(0);
    await page.getByRole('button', { name: 'Guardar horarios', exact: true }).click();
  }
  await expect.poll(state.writes).toBe(1);
});

test('error de una acción confirmada no expone diagnósticos del servidor ni muestra éxito', async ({ page }) => {
  const state = await actionFixture(page, 'servicio'); state.fail();
  await state.trigger.click();
  await popup(page).locator('.swal2-confirm').click();
  await expect(popup(page).locator('.swal2-error')).toBeVisible();
  await expect(popup(page)).toContainText('No se pudo actualizar el servicio.');
  await expect(popup(page)).not.toContainText('SQL');
  await expect(popup(page)).not.toContainText('secreto');
  await expect(popup(page).locator('.swal2-success')).toHaveCount(0);
  expect(state.writes()).toBe(1);
});
