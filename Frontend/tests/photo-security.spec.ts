import { test, expect, type Page } from '@playwright/test';
import { safePhotoUrl } from '../src/lib/profilePhoto';

const validPhoto = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQMgkTMgljgFAAEA4CcV2GZ44AAAAASUVORK5CYII=';
const attack = `data:image/png;base64,AAAA');\"><img data-photo-attack src=x onerror="window.photoInjected=true"><span style="`;

test('la frontera de renderizado rechaza esquemas activos, atributos y estilos inyectados', () => {
  for (const value of [attack, 'javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:text/html;base64,PGgxLz4=', '//evil.example/image', 'https://user:pass@example.com/a.png', 'https://example.com/a\" onerror=alert(1)', 'https://example.com/\nphoto']) expect(safePhotoUrl(value)).toBeNull();
  expect(safePhotoUrl(validPhoto)).toBe(validPhoto);
  expect(safePhotoUrl('/_astro/photo.png')).toBe('/_astro/photo.png');
  expect(safePhotoUrl('https://example.com/photo.jpg')).toBe('https://example.com/photo.jpg');
});

async function mockPhotos(page: Page, role: 'cliente' | 'barbero' | 'admin', photo: string) {
  await page.addInitScript(({ photo, role }) => {
    localStorage.setItem('token', 'test');
    localStorage.setItem('user', JSON.stringify({ id: 1, rol: role }));
    localStorage.setItem('profile-photo-1', photo);
  }, { photo, role });
  const professional = { id: 2, nombre: 'Barbero Foto', email: 'barbero@example.com', rol: 'barbero', aprobado: true, fecha_creacion: '2026-01-01T12:00:00Z', perfilBarbero: { id: 10, foto_perfil: photo, servicios: [{ id: 'cut', nombre_servicio: 'Corte', duracion_minutos: 30, precio: 12000 }], lugarTrabajo: { nombre_barberia: 'Conce', direccion: 'Centro' } } };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 1, nombre: 'Usuario', rol: role, email: 'usuario@example.com', aprobado: true, fecha_creacion: '2026-01-01T12:00:00Z', foto_perfil: photo, perfilBarbero: role === 'barbero' ? professional.perfilBarbero : null } });
    if (path.endsWith('/usuarios')) return route.fulfill({ json: [professional] });
    if (path.endsWith('/admin/dashboard')) return route.fulfill({ json: { stats: {}, clientes: [], barberos: [professional], admins: [], barberosPendientes: [] } });
    if (path.endsWith('/citas/barberos')) return route.fulfill({ json: [{ id: 10, usuario: { nombre: 'Barbero Foto' }, foto_perfil: photo, servicios: professional.perfilBarbero.servicios, requiereComprobante: false }] });
    if (path.endsWith('/conversations')) return route.fulfill({ json: [{ id: 'chat', updatedAt: '2026-01-01T12:00:00Z', otherUser: { id: 2, nombre: 'Barbero Foto', rol: 'barbero', foto_perfil: photo }, lastMessage: null }] });
    return route.fulfill({ json: [] });
  });
}

const surfaces = [
  ['/home', '.barber-avatar', 'cliente'], ['/barberos', '.barber-profile-photo', 'cliente'],
  ['/admin', '.admin-user-avatar', 'admin'], ['/mensajes', '.conversation-item .message-avatar', 'cliente'],
  ['/booking', '.booking-avatar', 'cliente'], ['/perfil', '.profile-photo', 'cliente'],
] as const;

for (const [path, selector, role] of surfaces) {
  test(`${path}: una fotografía maliciosa no crea HTML ni ejecuta código`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await mockPhotos(page, role, attack);
    await page.goto(path);
    if (path === '/admin') await page.getByRole('button', { name: 'Barberos', exact: true }).click();
    await expect(page.locator(selector).first()).toBeVisible();
    await expect(page.locator('[data-photo-attack]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { photoInjected?: boolean }).photoInjected)).toBeUndefined();
    expect(await page.locator(selector).first().getAttribute('style') || '').not.toContain('onerror');
    expect(await page.locator('[data-user-avatar]').first().getAttribute('style') || '').not.toContain('onerror');
    expect(errors).toEqual([]);
  });
  test(`${path}: conserva la visualización de fotografías válidas`, async ({ page }) => {
    await mockPhotos(page, role, validPhoto);
    await page.goto(path);
    if (path === '/admin') await page.getByRole('button', { name: 'Barberos', exact: true }).click();
    await expect(page.locator(selector).first()).toHaveClass(/has-photo/);
    await expect(page.locator(selector).first()).toHaveAttribute('style', /data:image\/png;base64/);
  });
}

for (const accepted of [true, false]) {
  test(`la carga ${accepted ? 'usa la foto normalizada del servidor' : 'rechazada conserva la foto anterior'}`, async ({ page }) => {
    await mockPhotos(page, 'cliente', validPhoto);
    let requestPhoto = '';
    await page.route('**/api/auth/me/photo', async route => {
      requestPhoto = route.request().postDataJSON().foto_perfil;
      return route.fulfill({ status: accepted ? 200 : 400, json: accepted ? { id: 1, foto_perfil: validPhoto } : { message: 'Imagen inválida' } });
    });
    await page.goto('/perfil');
    await expect(page.locator('.profile-photo')).toHaveClass(/has-photo/);
    await page.locator('#profile-photo-input').setInputFiles('src/assets/logotesis.png');
    await expect.poll(() => requestPhoto.length).toBeGreaterThan(0);
    await expect(page.getByText(accepted ? 'Foto actualizada en todo tu perfil.' : 'Imagen inválida', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('profile-photo-1'))).toBe(validPhoto);
    await expect(page.locator('.profile-photo')).toHaveAttribute('style', /data:image\/png;base64/);
    expect(requestPhoto).not.toBe(validPhoto);
  });
}
