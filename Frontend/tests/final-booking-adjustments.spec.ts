import { test, expect } from '@playwright/test';
import { bookingAvailability } from './booking-fixture';
import { qualityFixture } from './quality-fixture';

for (const theme of ['light', 'dark']) {
  for (const payment of ['missing', 'complete', 'optional']) {
    test(`transferencias ${payment}, tema ${theme}`, async ({ page }) => {
      let paymentRequests = 0, bookings = 0;
      await page.clock.setFixedTime(new Date('2035-01-15T11:00:00Z'));
      await page.addInitScript(theme => {
        localStorage.setItem('token', 'test');
        localStorage.setItem('ui-theme', theme);
      }, theme);
      await page.route('**/api/**', async route => {
        const url = new URL(route.request().url()), path = url.pathname;
        if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente' } });
        if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero' }, requiereComprobante: payment !== 'optional', servicios: [
          { id: 'cut', nombre_servicio: 'Corte', precio: 10000 }, { id: 'beard', nombre_servicio: 'Barba', precio: 7000 },
        ] }] });
        if (path.includes('/citas/disponibilidad/')) return route.fulfill({ json: bookingAvailability(url.searchParams, [{ id: 'slot', fecha_hora: '2035-01-15T13:00:00Z' }]) });
        if (path.endsWith('/pago')) {
          paymentRequests++;
          if (payment === 'missing') return route.fulfill({ status: 409, json: { message: 'El profesional aún no ha completado sus datos para recibir transferencias' } });
          return route.fulfill({ json: { citaId: 'slot', servicioId: route.request().postDataJSON().servicioId, barberoId: 10,
            bancoNombre: 'Titular', bancoRut: '12345678-5', bancoNombreBanco: 'Banco', bancoTipoCuenta: 'Vista', bancoNroCuenta: '123', bancoCorreo: 'test@example.com' } });
        }
        if (path.endsWith('/agendar')) { bookings++; return route.fulfill({ json: { id: 'reserved' } }); }
        return route.fulfill({ json: [] });
      });
      await page.goto('/booking?barbero=10');
      await page.locator('.booking-service-card').first().click();
      await page.locator('.booking-calendar-cell.is-available').click();
      const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
      if (payment === 'missing') {
        await expect(page.locator('.swal2-title')).toHaveText('Transferencias no disponibles');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.cbc-notification')).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(21, 23, 28)');
        await page.getByRole('button', { name: 'Entendido', exact: true }).click();
        await expect(page.locator('.booking-summary')).toContainText('Transferencias no disponibles');
        await expect(page.locator('.booking-calendar-cell.is-selected')).toHaveCount(1);
        await expect(confirm).toBeDisabled();
        await page.locator('.booking-service-card').last().click();
        await expect.poll(() => paymentRequests).toBe(2);
        await page.getByRole('button', { name: 'Reintentar datos de pago' }).click();
        await expect.poll(() => paymentRequests).toBe(3);
        await expect(page.locator('.swal2-popup')).toHaveCount(0);
        await expect(confirm).toBeDisabled();
        expect(bookings).toBe(0);
      } else {
        if (payment === 'complete') {
          await expect(page.locator('.booking-proof-field input')).toBeVisible();
          await page.locator('.booking-proof-field input').setInputFiles('tests/fixtures/profile.png');
        }
        await expect(confirm).toBeEnabled();
        await expect(page.locator('.swal2-popup')).toHaveCount(0);
        await confirm.click();
        await expect.poll(() => bookings).toBe(1);
        if (payment === 'optional') expect(paymentRequests).toBe(0);
      }
    });
  }
}

for (const saved of [undefined, 30, 45, 60]) {
  test(`Organización conserva duración ${saved ?? 'inicial de 60'} y navegación de pagos`, async ({ page }) => {
    await qualityFixture(page, 'barbero');
    await page.route('**/api/profesional/calendario?**', route => route.fulfill({ json: { citas: [], bloqueos: [], revision: 'test', publicada: saved !== undefined,
      ...(saved === undefined ? {} : { configuracion: { startTime: '09:00', endTime: '19:00', blockMinutes: saved } }),
    } }));
    await page.goto('/perfil-profesional#organizacion');
    const duration = page.getByRole('combobox', { name: 'Duración de cada bloque', exact: true });
    await expect(duration).toBeEnabled();
    await expect(duration).toHaveValue(String(saved ?? 60));
    for (const minutes of [30, 45, 60]) {
      await duration.selectOption(String(minutes));
      await expect(duration).toHaveValue(String(minutes));
    }
    await page.reload();
    await expect(duration).toHaveValue(String(saved ?? 60));
    const payments = page.getByRole('link', { name: 'Datos de pago', exact: true });
    await expect(payments).toHaveAttribute('href', '#configuracion-reservas');
    await payments.click();
    await expect(payments).toHaveClass(/is-active/);
    await expect(page.locator('#configuracion-reservas')).toBeVisible();
    await expect(page.getByRole('switch')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Abrir configuración de cuenta' })).toBeVisible();
  });
}
