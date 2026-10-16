import { test, expect } from '@playwright/test';

test('mis citas ofrece únicamente acciones correspondientes al estado y la fecha', async ({ page }) => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 3600000).toISOString();
  const appointments = [
    { id: 'pending', estado: 'pendiente', fecha_hora: future },
    { id: 'future', estado: 'confirmada', fecha_hora: future },
    { id: 'past', estado: 'confirmada', fecha_hora: past },
    { id: 'absent', estado: 'inasistencia', fecha_hora: past },
    { id: 'rejected', estado: 'rechazada', fecha_hora: past },
  ].map(c => ({ ...c, duracionReservada: 30, cliente: { nombre: c.id }, servicio: { nombre_servicio: 'Corte histórico', duracion_minutos: 30 } }));
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 2, rol: 'barbero', nombre: 'Barbero', aprobado: true, perfilBarbero: { id: 10 } } });
    if (path.endsWith('/citas/mias')) return route.fulfill({ json: appointments });
    if (path.endsWith('/pending/estado')) {
      expect(route.request().postDataJSON()).toEqual({ estado: 'rechazada' });
      return route.fulfill({ json: { ...appointments[0], estado: 'rechazada' } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil-profesional');
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await page.getByRole('tab', { name: 'Reservas' }).click();
  const card = (name: string) => page.locator('.appointment-card').filter({ has: page.locator('.appointment-info strong', { hasText: name }) });
  await expect(card('pending').getByRole('button', { name: 'Confirmar', exact: true })).toBeVisible();
  await expect(card('future').getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
  await expect(card('future').getByRole('button', { name: 'Finalizar', exact: true })).toHaveCount(0);
  page.on('dialog', d => d.accept());
  await card('pending').getByRole('button', { name: 'Rechazar', exact: true }).click();
  await page.getByRole('tab', { name: 'Historial' }).click();
  await expect(card('pending').locator('.appointment-status')).toHaveText('Rechazada');
  await expect(card('pending').getByRole('button')).toHaveCount(0);
  await expect(card('past').getByRole('button', { name: 'Cancelar', exact: true })).toHaveCount(0);
  await expect(card('past').getByRole('button', { name: 'Finalizar', exact: true })).toBeVisible();
  await expect(card('past').getByRole('button', { name: 'Marcar inasistencia', exact: true })).toBeVisible();
  await expect(card('absent').getByRole('button')).toHaveCount(0);
  await expect(card('rejected').getByRole('button')).toHaveCount(0);
});

test('cliente conserva etiquetas de rechazo e inasistencia sin acciones de cancelación', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('token', 'test'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente', email: 'cliente@test.invalid', aprobado: true, fecha_creacion: '2025-01-01T12:00:00Z' } });
    if (path.endsWith('/citas/cliente/mias')) return route.fulfill({ json: ['rechazada', 'inasistencia'].map(estado => ({ id: estado, estado, fecha_hora: '2026-01-02T15:00:00Z', servicio: { nombre_servicio: 'Servicio histórico' } })) });
    return route.fulfill({ json: [] });
  });
  await page.goto('/perfil');
  await expect(page.locator('.client-appointment-status.is-rechazada')).toHaveText('Rechazada');
  await expect(page.locator('.client-appointment-status.is-inasistencia')).toHaveText('Inasistencia');
  await expect(page.locator('.client-appointment-cancel')).toHaveCount(0);
});
