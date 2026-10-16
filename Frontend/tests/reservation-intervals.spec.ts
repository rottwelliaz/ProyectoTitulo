import { test, expect } from '@playwright/test';

test('agenda publica intervalos con fin, respeta descansos y no crea inicio a la hora de cierre', async ({ page }) => {
  let payload: { fechaInicio: string; fechaFin: string; configuracion: { startTime: string; endTime: string; blockMinutes: number }; bloques: { inicio: string; fin: string }[] } | undefined;
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/profesional/calendario')) return route.fulfill({ json: { citas: [], bloqueos: [], revision: 'test-revision', configuracion: payload?.configuracion || { startTime: '09:00', endTime: '19:00', blockMinutes: 60 } } });
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 2, rol: 'barbero', nombre: 'Barbero', aprobado: true, perfilBarbero: { id: 10, requiereComprobante: false } } });
    if (path.endsWith('/disponibilidad/semana')) {
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { citas: [], omittedOccupiedBlocks: 0 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil-profesional');
  await page.locator('.pro-nav-link[href="#organizacion"]').click();
  await page.getByLabel('Semana siguiente', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Hora de entrada', exact: true }).selectOption('09:00');
  await page.getByRole('combobox', { name: 'Hora de cierre', exact: true }).selectOption('10:00');
  await page.getByRole('combobox', { name: 'Duración de cada bloque', exact: true }).selectOption('30');
  await page.getByRole('button', { name: 'Guardar agenda', exact: true }).click();
  await expect.poll(() => payload?.bloques.length).toBe(14);
  for (const block of payload!.bloques) {
    expect(new Date(block.fin).getTime() - new Date(block.inicio).getTime()).toBe(30 * 60000);
    // The date is serialized with an explicit offset (ISO UTC), not an ambiguous local date.
    expect(block.inicio).toMatch(/Z$/);
  }
  expect(await page.locator('.calendar-time-column time').allTextContents()).toEqual(['09:00', '09:30']);
  await page.locator('.barber-slot:not(:disabled)').first().click();
  await page.getByRole('button', { name: 'Descanso', exact: true }).click();
  await expect.poll(() => payload?.bloques.length).toBe(13);
});

test('disponibilidad se consulta de nuevo por servicio y no conserva respuestas antiguas', async ({ page }) => {
  const selected: string[] = [];
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente', aprobado: true } });
    if (url.pathname.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { id: 2, nombre: 'Barbero' }, requiereComprobante: false, servicios: [
      { id: 'short', nombre_servicio: 'Corto', precio: 10000, duracion_minutos: 30 },
      { id: 'long', nombre_servicio: 'Largo', precio: 15000, duracion_minutos: 60 },
    ] }] });
    if (url.pathname.includes('/citas/disponibilidad/')) {
      const service = url.searchParams.get('servicioId')!;
      selected.push(service);
      expect(url.searchParams.get('desde')).toMatch(/Z$/);
      expect(url.searchParams.get('hasta')).toMatch(/Z$/);
      if (service === 'short') await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ json: { citas: service === 'short' ? [{ id: 'slot', fecha_hora: new Date(Date.now() + 86400000).toISOString() }] : [], servicios: [] } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/booking');
  await page.locator('.booking-barber-card').click();
  await page.locator('.booking-service-card').filter({ hasText: 'Corto' }).click();
  await expect.poll(() => selected.includes('short')).toBe(true);
  await page.locator('.booking-service-card').filter({ hasText: 'Largo' }).click();
  await expect.poll(() => selected.includes('long')).toBe(true);
  await page.waitForTimeout(400);
  await expect(page.locator('.booking-slots button')).toHaveCount(0);
});
