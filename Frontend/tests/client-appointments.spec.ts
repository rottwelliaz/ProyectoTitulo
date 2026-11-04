import { test, expect } from '@playwright/test';
import { qualityFixture, ready } from './quality-fixture';

for (const theme of ['original', 'light', 'dark']) {
  for (const width of [1366, 390, 320]) {
    test(`Mis citas conserva el panel en ${theme} a ${width}px`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await qualityFixture(page, 'cliente', theme);
      const appointmentRequests: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/citas/cliente/mias')) appointmentRequests.push(request.url());
      });
      await ready(page, '/perfil');
      await expect(page.locator('#profile-form')).toBeVisible();
      await expect(page.locator('#client-appointments-card')).toHaveCount(0);
      expect(appointmentRequests).toHaveLength(0);

      const nav = page.locator('.profile-nav');
      await expect(nav.getByRole('link')).toHaveText(['Perfil', 'Mis citas', 'Configuración', 'Mensajes']);
      await nav.getByRole('link', { name: 'Mis citas', exact: true }).click();
      await expect(page).toHaveURL(/\/mis-citas\/?$/);
      await expect(page.getByRole('heading', { name: 'Mis citas', exact: true, level: 1 })).toBeVisible();
      await expect(page.locator('.profile-nav a[aria-current="page"]')).toHaveText('Mis citas');
      await expect(page.locator('.profile-sidebar')).toBeVisible();
      await expect(page.locator('#profile-form, #profile-photo-input, #password-change-form, #professional-application')).toHaveCount(0);
      await expect(page.locator('#client-appointments-list .dt-info')).toContainText('de 0 registros');
      await expect(page.locator('#client-appointments-list .dt-length select')).toHaveValue('10');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
      await expect(page.locator('.profile-nav a[aria-current="page"]')).toHaveText('Mis citas');
      await expect(page.locator('#client-appointments-list .dt-info')).toContainText('de 0 registros');
      await page.screenshot({ path: info.outputPath('mis-citas.png'), fullPage: true });
      await page.getByRole('link', { name: 'Reservar otra hora', exact: true }).click();
      await expect(page).toHaveURL(/\/booking\/?$/);

      await ready(page, '/mis-citas');
      await page.locator('.profile-nav').getByRole('link', { name: 'Perfil', exact: true }).click();
      await expect(page.locator('#profile-form')).toBeVisible();
      await expect(page.locator('#client-appointments-list')).toHaveCount(0);
      await page.locator('.profile-nav').getByRole('link', { name: 'Configuración', exact: true }).click();
      await expect(page.locator('.profile-nav a[href="/mis-citas"]')).toBeVisible();
      await page.locator('.profile-nav').getByRole('link', { name: 'Mensajes', exact: true }).click();
      if (width <= 1180) await page.getByRole('button', { name: 'Abrir menú principal', exact: true }).click();
      await expect(page.locator('.profile-nav a[aria-current="page"]')).toHaveText('Mensajes');
      await page.locator('.profile-nav').getByRole('link', { name: 'Mis citas', exact: true }).click();
      await expect(page.locator('#client-appointments-list .dt-info')).toContainText('de 0 registros');
    });
  }
}
