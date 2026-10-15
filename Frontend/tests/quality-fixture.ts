import { expect, type Page } from '@playwright/test';
export const profile = { id: 10, biografia: 'Cortes clásicos y modernos en Concepción.', especialidades: ['Corte', 'Barba'], foto_perfil: null, requiereComprobante: false,
  usuario: { id: 2, nombre: 'Profesional de prueba' }, lugarTrabajo: { id: 3, nombre_barberia: 'Club de prueba', direccion: 'Dirección de prueba 123' },
  servicios: [{ id: 's1', nombre_servicio: 'Corte de prueba', descripcion: 'Servicio de prueba', precio: 10000, duracion_minutos: 30, activo: true }] };
export async function qualityFixture(page: Page, role = 'cliente', theme = 'original') {
  await page.clock.setFixedTime(new Date('2030-01-07T12:00:00Z'));
  const user = { id: 1, nombre: 'Usuario de prueba', email: 'quality@test.invalid', telefono: '912345678', rol: role, aprobado: true, activo: true, fecha_creacion: '2026-01-01T12:00:00Z', perfilBarbero: profile };
  await page.addInitScript(({ theme, user }) => { localStorage.setItem('token', 'quality-test'); localStorage.setItem('user', JSON.stringify(user)); localStorage.setItem('ui-theme', theme); }, { theme, user });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api', '');
    let json: unknown = [];
    if (path === '/auth/me') json = user;
    if (path === '/usuarios') json = [{ ...user, id: 2, rol: 'barbero', nombre: profile.usuario.nombre }];
    if (path.endsWith('/perfil')) json = profile;
    if (path.endsWith('/disponibilidad')) json = { citas: [], servicios: profile.servicios };
    if (path === '/citas/barberos') json = [profile];
    if (path === '/servicios') json = profile.servicios;
    if (path === '/lugartrabajo') json = [profile.lugarTrabajo];
    if (path === '/profesional/calendario') json = { citas: [], bloqueos: [], revision: 'quality', configuracion: { startTime: '09:00', endTime: '19:00', blockMinutes: 60 } };
    if (path === '/profesional/estadisticas') json = { total: 0, estados: { pendiente: 0, confirmada: 0, finalizada: 0, cancelada: 0, rechazada: 0, inasistencia: 0 } };
    if (path === '/usuarios/admin/dashboard') json = { stats: { totalUsuarios: 1, clientes: 1, barberos: 0, barberosPendientes: 0, barberosAprobados: 0, admins: 0 }, clientes: [{ ...user, rol: 'cliente' }], barberos: [], barberosPendientes: [], admins: [] };
    return route.fulfill({ json });
  });
}
export const qualityPages = [
  ['/home', 'cliente'], ['/login', 'cliente'], ['/registro', 'cliente'], ['/barberos', 'cliente'], ['/barbero?barbero=10', 'cliente'], ['/booking', 'cliente'], ['/perfil', 'cliente'], ['/configuracion', 'cliente'], ['/mensajes', 'cliente'], ['/perfil-profesional', 'barbero'], ['/admin', 'admin'], ['/admin-barberos', 'admin'], ['/404', 'cliente'],
];
export async function ready(page: Page, path: string) {
  await page.goto(path);
  if (await page.locator('html[data-private]').count()) await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
  await page.locator('astro-island').evaluateAll(async islands => { await Promise.all(islands.map(el => el.hasAttribute('ssr') ? new Promise<void>(resolve => el.addEventListener('astro:hydrate', () => resolve(), { once: true })) : Promise.resolve())); });
  await expect(page.locator('body')).not.toContainText('Cargando servicios...');
}
