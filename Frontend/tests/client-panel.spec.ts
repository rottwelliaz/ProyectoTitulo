import { test, expect, type Page } from '@playwright/test';
import { qualityFixture, profile, ready } from './quality-fixture';
import { bookingAvailability } from './booking-fixture';
import { fulfillDataTable } from './datatable-fixture';

const professionals = [10, 20].map(id => ({ ...profile, id,
  usuario: { id: id + 1, nombre: `Profesional ${id}` },
  servicios: profile.servicios.map(service => ({ ...service, id: `service-${id}` })),
}));
const navigation = ['Perfil', 'Ver barberos', 'Reservar hora', 'Mis citas', 'Configuración', 'Mensajes'];

async function fixture(page: Page, theme = 'original', role = 'cliente') {
  await qualityFixture(page, role, theme);
  const appointments: any[] = [];
  const availabilityRequests: number[] = [];
  // Every API request is intercepted by this fixture or qualityFixture; no database writes.
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');
    if (path === '/usuarios') return route.fulfill({ json: professionals.map(barber => ({
      ...barber.usuario, rol: 'barbero', aprobado: true, activo: true, perfilBarbero: barber,
    })).concat([{ id: 99, nombre: 'Pendiente oculto', rol: 'barbero', aprobado: false, activo: true, perfilBarbero: professionals[0] }]) });
    if (/^\/usuarios\/barberos\/\d+\/perfil$/.test(path)) {
      return route.fulfill({ json: professionals.find(barber => barber.id === Number(path.split('/')[3])) });
    }
    if (path === '/citas/barberos') return route.fulfill({ json: professionals });
    if (path.startsWith('/citas/disponibilidad/')) {
      const id = Number(path.split('/').pop());
      availabilityRequests.push(id);
      return route.fulfill({ json: bookingAvailability(url.searchParams,
        appointments.some(appointment => appointment.barbero.id === id) ? [] : [
          { id: `slot-${id}`, fecha_hora: '2030-01-07T14:00:00Z', disponibleHasta: '2030-01-07T14:45:00Z' },
        ]) });
    }
    if (path.endsWith('/agendar')) {
      const id = Number(path.split('/')[2].replace('slot-', ''));
      const barber = professionals.find(barber => barber.id === id)!;
      appointments.push({ id: 'simulated-appointment', ...route.request().postDataJSON(),
        duracionReservada: 45, estado: 'confirmada', barbero: barber, servicio: barber.servicios[0],
      });
      return route.fulfill({ json: appointments.at(-1) });
    }
    if (path === '/citas/cliente/mias') return fulfillDataTable(route, { json: appointments });
    return route.fallback();
  });
  return { appointments, availabilityRequests };
}

async function expectPanel(page: Page, active: string) {
  await expect(page.locator('.panel-sidebar:visible')).toHaveCount(1);
  await expect(page.locator('.profile-nav a:visible')).toHaveText(navigation);
  await expect(page.locator('.profile-nav [aria-current="page"]')).toHaveText(active);
}

test.beforeEach(({ page }) => { page.on('pageerror', error => { throw error; }); });

test('catálogo → perfil → reserva → Mis citas conserva el panel y el profesional', async ({ page }) => {
  const state = await fixture(page);
  await ready(page, '/perfil');
  await expectPanel(page, 'Perfil');
  await page.locator('.profile-nav').getByRole('link', { name: 'Ver barberos', exact: true }).click();
  await expectPanel(page, 'Ver barberos');
  await expect(page.locator('.barber-profile-card')).toHaveCount(2);
  await expect(page.locator('#barbers-grid')).not.toContainText('Pendiente oculto');
  await page.locator('#barber-search').fill('Profesional 20');
  await page.getByRole('link', { name: 'Ver perfil', exact: true }).click();
  await expectPanel(page, 'Ver barberos');
  await expect(page.locator('.public-identity')).toContainText('Profesional 20');
  await expect(page.locator('.profile-nav a[href="/booking?barbero=20"]')).toBeVisible();
  await page.getByRole('link', { name: 'Reservar una hora', exact: true }).click();
  await expect(page).toHaveURL(/\/booking\?barbero=20#servicios$/);
  await expectPanel(page, 'Reservar hora');
  await page.reload();
  await expectPanel(page, 'Reservar hora');
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Profesional 20');
  await page.locator('.booking-service-card').click();
  await page.locator('.booking-calendar-cell.is-available').click();
  await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  expect(state.appointments).toHaveLength(1);
  expect(state.appointments[0].barbero.id).toBe(20);
  expect(state.availabilityRequests.every(id => id === 20)).toBe(true);
  await page.locator('.profile-nav').getByRole('link', { name: 'Mis citas', exact: true }).click();
  await expectPanel(page, 'Mis citas');
  await expect(page.locator('.client-appointment-item')).toContainText('Profesional 20');
  await expect(page.locator('.client-appointment-date')).toContainText('11:00–11:45');
  for (const [name, path] of [['Configuración', '/configuracion'], ['Mensajes', '/mensajes'], ['Perfil', '/perfil']]) {
    await page.locator('.profile-nav').getByRole('link', { name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expectPanel(page, name);
  }
});

test('el catálogo permite reservar con un solo enlace conservando el profesional', async ({ page }) => {
  await fixture(page);
  await ready(page, '/barberos');
  await expectPanel(page, 'Ver barberos');
  const card = page.locator('.barber-profile-card').filter({ hasText: 'Profesional 20' });
  await card.getByRole('link', { name: 'Reservar hora', exact: true }).click();
  await expect(page).toHaveURL(/\/booking\?barbero=20#servicios$/);
  await expectPanel(page, 'Reservar hora');
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Profesional 20');
  await expect(page.locator('.booking-service-card')).toHaveCount(1);
});

test('Ver barberos conserva el catálogo completo, fotografías, datos y navegación independiente de Reservar hora', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await fixture(page);
  const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQN0AAAAASUVORK5CYII=';
  const catalog = [...professionals.map(barber => ({ ...barber.usuario, rol: 'barbero', aprobado: true,
    foto_perfil: photo, perfilBarbero: barber,
  })), ...Array.from({ length: 10 }, (_, index) => ({
    id: index + 100, nombre: `Explorable ${index}`, rol: 'barbero', aprobado: true, foto_perfil: photo,
    perfilBarbero: { ...profile, id: index + 30, servicios: [], lugarTrabajo: null },
  }))];
  await page.route('**/api/usuarios?rol=barbero', route => route.fulfill({ json: catalog }));
  await ready(page, '/perfil');
  await page.locator('.profile-nav').getByRole('link', { name: 'Ver barberos', exact: true }).click();
  await expectPanel(page, 'Ver barberos');
  await expect(page.getByRole('main', { name: 'Catálogo de barberos', exact: true })).toBeVisible();
  await expect(page.locator('#barbers-count')).toContainText('12');
  await expect(page.locator('.barber-profile-card')).toHaveCount(8);
  await page.getByRole('button', { name: 'Ir a página 2', exact: true }).click();
  await expect(page.locator('.barber-profile-card')).toHaveCount(4);
  await page.locator('#barber-search').fill('Profesional 20');
  const card = page.locator('.barber-profile-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Club de prueba');
  await expect(card).toContainText('Dirección de prueba 123');
  expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(280);
  expect((await card.locator('.barber-profile-photo').boundingBox())!.height).toBeGreaterThanOrEqual(180);
  expect(await card.locator('.barber-profile-photo').evaluate(el => getComputedStyle(el).backgroundImage.includes('data:image/png'))).toBe(true);
  await expect(card.getByRole('link', { name: 'Ver perfil', exact: true })).toBeVisible();
  await card.getByRole('link', { name: 'Reservar hora', exact: true }).click();
  await expectPanel(page, 'Reservar hora');
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Profesional 20');
  await page.getByRole('link', { name: 'Ver catálogo de barberos', exact: true }).click();
  await expectPanel(page, 'Ver barberos');
  await expect(page.locator('#barbers-count')).toContainText('12');
  await page.reload();
  await expectPanel(page, 'Ver barberos');
  await expect(page.locator('#barbers-count')).toContainText('12');
});

test('reserva directa permite buscar, elegir explícitamente y conservar el barbero al recargar', async ({ page }) => {
  const state = await fixture(page);
  await ready(page, '/perfil');
  await page.locator('.profile-nav').getByRole('link', { name: 'Reservar hora', exact: true }).click();
  await expectPanel(page, 'Reservar hora');
  await expect(page.locator('.booking-barber-card')).toHaveCount(2);
  await expect(page.locator('.booking-barber-card.is-selected')).toHaveCount(0);
  expect(state.availabilityRequests).toEqual([]);
  await page.getByLabel('Buscar barbero o barbería').fill('inexistente');
  await expect(page.getByRole('status')).toContainText('No hay barberos que coincidan');
  await page.getByLabel('Buscar barbero o barbería').fill('profesional 20');
  await expect(page.locator('.booking-barber-card')).toHaveCount(1);
  await page.locator('.booking-barber-card').click();
  await expect(page).toHaveURL(/\/booking\?barbero=20$/);
  await expect(page.locator('.booking-service-card')).toHaveCount(1);
  await expect(page.locator('.booking-calendar-cell.is-available')).toHaveCount(1);
  await page.reload();
  await expectPanel(page, 'Reservar hora');
  await expect(page.locator('.booking-barber-card.is-selected')).toContainText('Profesional 20');
  expect(state.availabilityRequests.every(id => id === 20)).toBe(true);
});

for (const theme of ['original', 'light', 'dark']) for (const width of [320, 390, 768, 1280]) {
  test(`panel adaptable ${theme} ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await fixture(page, theme);
    for (const [path, active] of [['/barberos', 'Ver barberos'], ['/barbero?barbero=20', 'Ver barberos'], ['/booking?barbero=20', 'Reservar hora']]) {
      await ready(page, path);
      await expectPanel(page, active);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(1);
      await page.screenshot({ path: info.outputPath(`${path.split('?')[0].slice(1)}.png`), fullPage: true });
      if (width === 1280) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const sidebar = await page.locator('.panel-sidebar').boundingBox();
        expect(sidebar?.x).toBe(0);
        expect(Math.abs(sidebar!.y)).toBeLessThanOrEqual(1);
      }
      if (path.startsWith('/booking')) {
        await page.locator('.booking-service-card').click();
        await page.locator('.booking-calendar-cell.is-available').click();
        const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
        await confirm.scrollIntoViewIfNeeded();
        await expect(confirm).toBeEnabled();
        const button = (await confirm.boundingBox())!;
        const nav = (await page.locator('.panel-sidebar').boundingBox())!;
        expect(button.y).toBeGreaterThanOrEqual(width > 1180 ? 0 : nav.y + nav.height);
        expect(button.y + button.height).toBeLessThanOrEqual(845);
      }
    }
  });
}

for (const role of ['barbero', 'admin']) test(`${role} conserva el catálogo público y su navegación`, async ({ page }) => {
  await fixture(page, 'original', role);
  await ready(page, '/barberos');
  await expect(page.locator('[data-session-user]')).toBeVisible();
  await expect(page.locator('.panel-sidebar')).toBeHidden();
  await expect(page.locator('.barbers-nav')).toBeVisible();
  await ready(page, '/barbero?barbero=20');
  await expect(page.locator('.panel-sidebar')).toBeHidden();
  await expect(page.getByRole('link', { name: 'Reservar una hora', exact: true })).toHaveCount(0);
  await ready(page, role === 'admin' ? '/admin' : '/perfil-profesional');
  await expect(page.locator('.panel-sidebar')).toBeVisible();
  await expect(page.locator('.panel-sidebar').getByRole('link', { name: 'Ver barberos', exact: true })).toHaveCount(0);
});
