import { test, expect, type Page } from '@playwright/test';

const bank = { bancoNombre: 'Titular Privado', bancoRut: '12345678-5', bancoNombreBanco: 'Banco Privado', bancoTipoCuenta: 'Cuenta Corriente', bancoNroCuenta: '987654321', bancoCorreo: 'privado@example.com' };
async function prepare(page: Page, requiresProof = true, paymentStatus = 200, delay = 0) {
  const payments: { path: string; body: unknown }[] = [];
  const bookings: unknown[] = [];
  const slot = new Date(Date.now() + 3600000).toISOString();
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente', aprobado: true } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [10, 20].map(id => ({ id, usuario: { nombre: `Barbero ${id}` }, requiereComprobante: requiresProof, servicios: [{ id: `service-${id}`, nombre_servicio: 'Corte', precio: 12000, duracion_minutos: 30 }] })) });
    if (path.includes('/citas/disponibilidad/')) return route.fulfill({ json: { citas: [{ id: `slot-${path.split('/').pop()}`, fecha_hora: slot }] } });
    if (path.endsWith('/pago')) {
      payments.push({ path, body: route.request().postDataJSON() });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return route.fulfill({ status: paymentStatus, json: paymentStatus === 200
        ? { citaId: 'slot-10', servicioId: 'service-10', barberoId: 10, ...bank }
        : { message: 'No se pueden consultar datos de pago en este momento.' } });
    }
    if (path.endsWith('/agendar')) { bookings.push(route.request().postDataJSON()); return route.fulfill({ json: { id: 'reserved', estado: 'confirmada' } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking');
  await page.locator('.booking-barber-card').first().click();
  await page.locator('.booking-service-card').click();
  await page.locator('.booking-slots button').click();
  return { payments, bookings };
}

test('los datos se consultan solo al continuar al pago y el comprobante permite reservar', async ({ page }) => {
  const state = await prepare(page);
  expect(state.payments).toHaveLength(0);
  await expect(page.getByText(bank.bancoNroCuenta)).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect(page.getByText(bank.bancoNroCuenta)).toBeVisible();
  expect(state.payments).toEqual([{ path: '/api/citas/slot-10/pago', body: { servicioId: 'service-10' } }]);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain('banco'); expect(stored).not.toContain(bank.bancoNroCuenta);
  await page.locator('.booking-proof-field input').setInputFiles('src/assets/logotesis.png');
  await page.getByRole('button', { name: 'Reservar con comprobante' }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.bookings).toHaveLength(1);
  await expect(page.getByText(bank.bancoNroCuenta)).toHaveCount(0);
});

test('sin comprobante no se consultan datos bancarios', async ({ page }) => {
  const state = await prepare(page, false);
  await page.getByRole('button', { name: 'Reservar ahora' }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.payments).toHaveLength(0);
  expect(state.bookings).toEqual([{ servicioId: 'service-10', comprobanteTransferencia: null, comprobanteNombre: null }]);
});

test('cambiar de profesional descarta respuestas bancarias tardías', async ({ page }) => {
  const state = await prepare(page, true, 200, 350);
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect.poll(() => state.payments.length).toBe(1);
  await page.locator('.booking-barber-card').nth(1).click();
  await page.waitForTimeout(450);
  await expect(page.locator('.booking-payment')).toHaveCount(0);
  await expect(page.getByText(bank.bancoNroCuenta)).toHaveCount(0);
});

test('una denegación de pago muestra el error sin información bancaria', async ({ page }) => {
  await prepare(page, true, 429);
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect(page.getByText('No se pueden consultar datos de pago en este momento.')).toBeVisible();
  await expect(page.locator('.booking-payment')).toHaveCount(0);
});

test('el propietario edita su cuenta sin persistirla en localStorage', async ({ page }) => {
  let edited: unknown;
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 2, rol: 'barbero', nombre: 'Barbero', aprobado: true, perfilBarbero: { id: 10, requiereComprobante: true, ...bank } } });
    if (path.endsWith('/me/banking')) { edited = route.request().postDataJSON(); return route.fulfill({ json: { id: 10, ...bank } }); }
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil-profesional');
  await expect(page.locator('input[name=nroCuenta]')).toHaveValue(bank.bancoNroCuenta);
  const stored = await page.evaluate(() => localStorage.getItem('user'));
  expect(stored).not.toContain('banco'); expect(stored).not.toContain(bank.bancoNroCuenta);
  await page.locator('.pro-nav-link[href="#mi-negocio"]').click();
  await page.locator('#edit-banking').click();
  await page.locator('input[name=nroCuenta]').fill('123456');
  await page.locator('#banking-form button[type=submit]').click();
  await expect.poll(() => edited).toMatchObject({ nroCuenta: '123456' });
});
