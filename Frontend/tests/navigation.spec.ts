import { test, expect, type Page } from '@playwright/test';
import { privateRoutes, roles, roleHome, loginDestination, type Role } from '../src/lib/access';

type ScriptError = { message: string; url: string };
const scriptErrors = new WeakMap<Page, ScriptError[]>();
const expectedRedirects = new WeakMap<Page, { from: string; to: string }>();

function expectRedirect(page: Page, from: string, to: string) {
  expectedRedirects.set(page, { from, to });
}
test.beforeEach(({ page }) => {
  const errors: ScriptError[] = [];
  scriptErrors.set(page, errors);
  page.on('pageerror', error => errors.push({ message: error.message, url: page.url() }));
});
test.afterEach(({ page, browserName }) => {
  const redirect = expectedRedirects.get(page);
  const arrived = redirect && new URL(page.url()).pathname === redirect.to;
  const unexpected = scriptErrors.get(page)?.filter(({ message, url }) => {
    if (browserName !== 'firefox' || !arrived || new URL(url).pathname !== redirect.from) return true;
    // Firefox reports canceled Astro imports from the document being replaced.
    // Errors from the destination or any other script still fail the test.
    return !/^error loading dynamically imported module: http:\/\/127\.0\.0\.1:4322\/_astro\/[^\s]+\.js$/.test(message);
  });
  expect(unexpected).toEqual([]);
});

async function mockApi(page: Page, role: Role = 'cliente', status = 200) {
  const user = { id: 1, rol: role, nombre: 'Usuario de prueba', email: 'test@example.com', aprobado: true, fecha_creacion: '2026-01-01', perfilBarbero: { id: 1 } };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path.endsWith('/auth/login')) body = { token: 'test-token', user };
    if (path.endsWith('/auth/me')) body = user;
    if (path.endsWith('/admin/dashboard')) body = { stats: { totalUsuarios: 0, clientes: 0, barberos: 0, barberosPendientes: 0, barberosAprobados: 0, admins: 0 }, clientes: [], barberos: [], barberosPendientes: [], admins: [] };
    await route.fulfill({ status: path.endsWith('/auth/me') ? status : 200, json: body });
  });
  return user;
}

async function session(page: Page, role: Role, theme = 'original') {
  await page.goto("/");
  await page.evaluate(({ role, theme }) => {
    localStorage.setItem('token', 'test-token');
    // Deliberately wrong cached role: the server must be the source of truth.
    localStorage.setItem('user', JSON.stringify({ id: 1, rol: role === 'admin' ? 'cliente' : 'admin' }));
    localStorage.setItem('ui-theme', theme);
  }, { role, theme });
}

for (const [path, allowed] of Object.entries(privateRoutes)) {
  test(`Invitado: ${path} conserva URL completa al ir a login`, async ({ page }) => {
    if (path === '/booking' || path === '/perfil-profesional') expectRedirect(page, path, '/login');
    await page.goto(`${path}?origen=prueba#seccion`);
    await expect(page).toHaveURL(new RegExp('/login\\?redirect='));
    expect(new URL(page.url()).searchParams.get('redirect')).toBe(`${path}?origen=prueba#seccion`);
    await expect(page.locator('#login-form')).toBeVisible();
  });
  for (const role of roles) {
    test(`${role}: ${path} ${allowed.includes(role) ? 'permitida' : 'denegada'}`, async ({ page }) => {
      if (!allowed.includes(role) && (path === '/booking' || path === '/perfil-profesional')) expectRedirect(page, path, roleHome(role));
      await mockApi(page, role);
      await session(page, role);
      await page.goto(path);
      const target = allowed.includes(role) ? path : roleHome(role);
      await expect(page).toHaveURL(new RegExp(`${target}/?$`));
      if (Object.hasOwn(privateRoutes, target)) {
        await expect(page.locator('html')).toHaveAttribute('data-private', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
      } else {
        // Public destinations validate the navigation's session without a private-page gate.
        await expect(page.locator('html')).not.toHaveAttribute('data-private', 'true');
        await expect(page.locator('.session-gate')).toHaveCount(0);
      }
      await expect(page.locator('html')).toHaveAttribute('data-user-role', role);
      await expect(page.locator('.profile-booking')).toHaveCount(0);
      await expect(page.locator('[data-session-user]')).toBeVisible();
      await expect(page.locator('[data-session-name]')).toHaveText('Usuario de prueba');
    });
  }
}

test('Sesión vencida o cuenta pendiente vuelve a login', async ({ page }) => {
  expectRedirect(page, '/perfil-profesional', '/login');
  for (const status of [401, 403]) {
    await mockApi(page, 'barbero', status);
    await session(page, 'barbero');
    await page.goto('/perfil-profesional');
    await expect(page).toHaveURL(/\/login\?redirect=/);
    expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
    await page.unrouteAll();
  }
});

test('Un fallo del servidor mantiene oculto el contenido y permite reintentar', async ({ page }) => {
  await mockApi(page, 'admin', 503);
  await session(page, 'admin');
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'error');
  await expect(page.locator('.admin-root')).toBeHidden();
  await expect(page.locator('#session-retry')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBe('test-token');
});

test('El perfil no aparece mientras el servidor valida la sesión', async ({ page }) => {
  await mockApi(page);
  await session(page, 'cliente');
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/auth/me', async route => {
    await blocked;
    await route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente', fecha_creacion: '2026-01-01' } });
  });
  await page.goto('/perfil');
  await expect(page.locator('.profile-root')).toBeHidden();
  await expect(page.locator('#session-status')).toBeVisible();
  release();
  await expect(page.locator('.profile-root')).toBeVisible();
});

test('Una sesión que vence durante una acción vuelve al login', async ({ page }) => {
  await mockApi(page, 'admin');
  await session(page, 'admin');
  await page.goto('/admin-barberos');
  await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
  await page.route('**/api/usuarios/barberos/pendientes', route => route.fulfill({ status: 401, json: { message: 'Token inválido' } }));
  await page.locator('#refresh-pending-barbers').click();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
});

test('El menú de inicio se puede abrir y usar en móvil', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockApi(page, 'admin');
  await session(page, 'admin');
  await page.goto('/home');
  await page.locator('[data-session-trigger]').click();
  await expect(page.locator('[data-session-dropdown]')).toBeVisible();
  await expect(page.locator('[data-session-role-link="cliente barbero"]')).toBeHidden();
  await page.locator('[data-session-role-link="admin"]').click();
  await expect(page).toHaveURL(/\/admin$/);
});

test('El invitado ve un único acceso y ningún perfil en las páginas públicas', async ({ page }) => {
  await page.route('**/api/usuarios?rol=barbero', route => route.fulfill({ json: [] }));
  for (const path of ['/home', '/barberos']) {
    await page.goto(path);
    await expect(page.locator('[data-session-guest]')).toBeVisible();
    await expect(page.locator('[data-session-guest]')).toHaveText('Iniciar sesión / Registrarse');
    await expect(page.locator('[data-session-user]')).toBeHidden();
    await expect(page.getByText('Invitado', { exact: true })).toHaveCount(0);
  }
});

test('La navegación no muestra el estado invitado mientras valida una sesión', async ({ page }) => {
  await session(page, 'cliente');
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      await blocked;
      return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente Activo', fecha_creacion: '2026-01-01' } });
    }
    return route.fulfill({ json: [] });
  });

  await page.goto('/home');
  await expect(page.locator('[data-session-guest]')).toBeHidden();
  await expect(page.locator('[data-session-user]')).toBeHidden();
  release();
  await expect(page.locator('[data-session-user]')).toBeVisible();
  await expect(page.locator('[data-session-name]')).toHaveText('Cliente Activo');
});

test('Cerrar sesión limpia los datos locales y vuelve al acceso', async ({ page }) => {
  await mockApi(page, 'cliente');
  await session(page, 'cliente');
  await page.goto('/home');
  await page.locator('[data-session-trigger]').click();
  await page.locator('[data-session-logout]').click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('user'))).toBeNull();
});

test('Mi perfil conserva edición, navegación y citas con el nuevo panel', async ({ page }) => {
  const user = {
    id: 11,
    rol: 'cliente',
    nombre: 'Cliente Original',
    email: 'cliente@example.com',
    telefono: '+56911111111',
    aprobado: true,
    fecha_creacion: '2026-01-01',
  };
  let updatePayload: Record<string, string> | null = null;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/citas/cliente/mias')) {
      return route.fulfill({ json: [{
        id: 'appointment-1', fecha_hora: '2027-01-15T14:00:00.000Z', estado: 'confirmada',
        barbero: { usuario: { nombre: 'Barbero Demo' }, lugarTrabajo: { nombre_barberia: 'Conce Barber Club' } },
        servicio: { nombre_servicio: 'Corte clásico' },
      }] });
    }
    if (path.endsWith('/auth/me') && request.method() === 'PUT') {
      updatePayload = request.postDataJSON();
      return route.fulfill({ json: { ...user, ...updatePayload } });
    }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: user });
    return route.fulfill({ json: {} });
  });
  await session(page, 'cliente', 'original');
  await page.goto('/perfil');

  await expect(page.getByRole('heading', { name: 'Mi perfil', exact: true })).toBeVisible();
  await expect(page.getByText('Cuenta personal')).toBeVisible();
  await expect(page.getByText('Corte clásico')).toBeVisible();
  await expect(page.locator('[data-session-role-link="barbero"]')).toBeHidden();
  await expect(page.locator('[data-session-role-link="admin"]')).toBeHidden();

  await page.locator('#edit-profile-button').click();
  await expect(page.locator('#profile-input-nombre')).toBeEnabled();
  await page.locator('#profile-input-nombre').fill('Cliente Actualizado');
  await page.locator('#profile-input-email').fill('actualizado@example.com');
  await page.locator('#profile-input-telefono').fill('+56922222222');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page.locator('#profile-message')).toContainText('Perfil actualizado correctamente');
  await expect(page.locator('#profile-input-nombre')).toBeDisabled();
  expect(updatePayload).toEqual({
    nombre: 'Cliente Actualizado', email: 'actualizado@example.com', telefono: '+56922222222',
  });
});

test('El barbero configura y conserva la exigencia de comprobante', async ({ page }) => {
  let requiresProof = false;
  let settingsPayload: { requiereComprobante: boolean } | null = null;
  const professional = () => ({
    id: 2,
    rol: 'barbero',
    nombre: 'Barbero Configurable',
    email: 'barbero@example.com',
    aprobado: true,
    fecha_creacion: '2026-01-01',
    perfilBarbero: { id: 10, requiereComprobante: requiresProof, servicios: [] },
  });

  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me/booking-settings')) {
      settingsPayload = request.postDataJSON();
      requiresProof = settingsPayload!.requiereComprobante;
      return route.fulfill({ json: { id: 10, requiereComprobante: requiresProof } });
    }
    if (path.endsWith('/auth/me')) return route.fulfill({ json: professional() });
    if (path.endsWith('/servicios')) return route.fulfill({ json: [] });
    if (path.includes('/lugartrabajo')) return route.fulfill({ json: {} });
    if (path.endsWith('/citas/mias')) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await session(page, 'barbero');
  await page.goto('/perfil-profesional');
  const toggle = page.locator('#requires-proof-switch');
  await page.locator('.pro-nav-link[href="#configuracion-reservas"]').click();
  await expect(toggle).toBeEnabled();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator('#proof-setting-title')).toHaveText('Reserva sin comprobante');

  await toggle.check();
  await expect(page.locator('#proof-setting-message')).toContainText('Configuración guardada correctamente');
  expect(settingsPayload).toEqual({ requiereComprobante: true });

  await page.reload();
  await expect(toggle).toBeChecked();
  await expect(page.locator('#proof-setting-title')).toHaveText('Comprobante obligatorio');
});

async function prepareBooking(page: Page, requiresProof: boolean) {
  const slotDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  let bookingPayload: Record<string, unknown> | null = null;
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) {
      return route.fulfill({ json: { id: 1, rol: 'cliente', nombre: 'Cliente', aprobado: true } });
    }
    if (path.endsWith('/citas/barberos')) {
      return route.fulfill({ json: [{
        id: 10,
        biografia: null,
        foto_perfil: null,
        requiereComprobante: requiresProof,
        usuario: { id: 2, nombre: 'Barbero Demo' },
        lugarTrabajo: { id: 3, nombre_barberia: 'Conce Barber Club', direccion: 'Concepción' },
        servicios: [{ id: 'service-1', nombre_servicio: 'Corte clásico', descripcion: null, precio: 12000, duracion_minutos: 45 }],
      }] });
    }
    if (path.includes('/citas/disponibilidad/')) {
      return route.fulfill({ json: { citas: [{ id: 'slot-1', fecha_hora: slotDate }], servicios: [] } });
    }
    if (path.endsWith('/citas/slot-1/pago')) {
      return route.fulfill({ json: {
        citaId: 'slot-1', servicioId: 'service-1', barberoId: 10,
        bancoNombre: 'Barbero Demo', bancoRut: '11111111-1', bancoNombreBanco: 'Banco Demo',
        bancoTipoCuenta: 'Cuenta corriente', bancoNroCuenta: '123456', bancoCorreo: 'barbero@example.com',
      } });
    }
    if (path.endsWith('/citas/slot-1/agendar')) {
      bookingPayload = request.postDataJSON();
      return route.fulfill({ json: { id: 'slot-1', estado: 'confirmada' } });
    }
    return route.fulfill({ json: [] });
  });
  await session(page, 'cliente');
  await page.goto('/booking');
  await page.locator('.booking-barber-card').click();
  await page.locator('.booking-service-card').click();
  await page.locator('.booking-slots button').click();
  return () => bookingPayload;
}

test('La reserva exige archivo cuando el barbero mantiene el comprobante activo', async ({ page }) => {
  await prepareBooking(page, true);
  await page.getByRole('button', { name: 'Continuar al pago' }).click();
  await expect(page.getByRole('heading', { name: 'Transferencia y comprobante' })).toBeVisible();
  await expect(page.locator('.booking-proof-field input')).toHaveAttribute('required', '');
  await expect(page.getByRole('button', { name: 'Reservar con comprobante' })).toBeDisabled();
});

test('La reserva se completa sin sección de pago cuando el barbero desactiva el comprobante', async ({ page }) => {
  const getPayload = await prepareBooking(page, false);
  await expect(page.getByText('Este profesional permite reservar sin comprobante de pago.')).toBeVisible();
  await page.getByRole('button', { name: 'Reservar ahora' }).click();
  await expect(page.getByText('Hora reservada y confirmada correctamente.')).toBeVisible();
  await expect(page.locator('.booking-payment')).toHaveCount(0);
  expect(getPayload()).toEqual({
    servicioId: 'service-1',
    comprobanteTransferencia: null,
    comprobanteNombre: null,
  });
});

for (const role of roles) {
  test(`Login ${role}: retorno permitido y bloqueo de destino ajeno`, async ({ page }) => {
    await mockApi(page, role);
    const target = `${roleHome(role)}?origen=login#resumen`;
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
    await page.locator('[name=email]').fill('test@example.com');
    await page.locator('[name=password]').fill('test-password');
    await page.locator('#login-button').click();
    await expect(page).toHaveURL(new RegExp(`${roleHome(role)}\\?origen=login#resumen$`));
    expect(loginDestination('/admin', 'cliente')).toBe('/home');
  });
}

test('Login cliente sin retorno abre Inicio y conserva acceso a Mi perfil', async ({ page }) => {
  await mockApi(page, 'cliente');
  await page.goto('/login');
  await page.locator('[name=email]').fill('cliente@example.com');
  await page.locator('[name=password]').fill('test-password');
  await page.locator('#login-button').click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.locator('[data-session-user]')).toBeVisible();
  await expect(page.locator('[data-session-name]')).toHaveText('Usuario de prueba');
  await expect(page.locator('[data-user-avatar]')).toBeVisible();

  await page.locator('[data-session-trigger]').click();
  await page.getByRole('link', { name: 'Mi perfil' }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole('heading', { name: 'Mi perfil', exact: true })).toBeVisible();
});

test('El retorno rechaza URLs externas, rutas inexistentes y bucles de login', () => {
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/login', '/registro', '/no-existe', '/admin', '/perfil/../../admin']) {
    expect(loginDestination(path, 'cliente')).toBe('/home');
  }
  expect(loginDestination('/booking/?barbero=7#servicios', 'cliente')).toBe('/booking?barbero=7#servicios');
});

test('404 personalizada en URL directa y navegación mediante enlace', async ({ page }) => {
  const response = await page.goto('/ruta-inexistente/anidada');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver a la página principal' }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.evaluate(() => {
    const link = document.createElement('a'); link.href = '/otra-ruta-inexistente'; link.textContent = 'Probar enlace inexistente'; document.body.append(link);
  });
  await page.getByRole('link', { name: 'Probar enlace inexistente' }).click();
  await expect(page.getByRole('heading', { name: 'Página no encontrada' })).toBeVisible();
});

test('Los tres temas se pueden seleccionar y persisten al recargar', async ({ page }) => {
  await mockApi(page, 'cliente');
  await session(page, 'cliente', 'original');
  await page.goto('/configuracion');
  await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');

  for (const theme of ['light', 'dark', 'original'] as const) {
    await page.locator(`[data-theme-option="${theme}"]`).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator(`input[name="interface-theme"][value="${theme}"]`)).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('ui-theme'))).toBe(theme);

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator(`input[name="interface-theme"][value="${theme}"]`)).toBeChecked();
  }
});

const readySelectors: Record<string, string> = {
  '/': 'main',
  '/perfil': '.profile-root',
  '/configuracion': '.settings-card',
  '/perfil-profesional': '#mi-perfil',
  '/admin': '.admin-root',
  '/admin-barberos': '#pending-barbers-list',
  '/booking': '.booking-root',
  '/mensajes': '.messages-app',
  '/home': '.home-root',
  '/barberos': '.barbers-page',
  '/login': '#login-form',
  '/registro': '#register-form',
  '/no-existe': '.not-found',
};

const responsiveViewports = [
  { width: 1920, height: 1080 },
  { width: 1600, height: 900 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

for (const { width, height } of responsiveViewports) {
  for (const theme of ['original', 'light', 'dark']) {
    test(`Diseño ${width}x${height} / ${theme}: páginas sin desbordamiento`, async ({ browser }) => {
      for (const [path, role] of [['/', 'cliente'], ['/perfil', 'cliente'], ['/configuracion', 'cliente'], ['/perfil-profesional', 'barbero'], ['/admin', 'admin'], ['/admin-barberos', 'admin'], ['/booking', 'cliente'], ['/mensajes', 'cliente'], ['/home', 'cliente'], ['/barberos', 'cliente'], ['/login', 'cliente'], ['/registro', 'cliente'], ['/no-existe', 'cliente']] as const) {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await mockApi(page, role);
        await session(page, role, theme);
        await page.goto(path);
        if (privateRoutes[path]) await expect(page.locator('html')).toHaveAttribute('data-auth-state', 'ready');
        await expect(page.locator(readySelectors[path])).toBeVisible();
        const captureDesktopReference = theme === 'original' && [1920, 1366, 1280].includes(width);
        const captureThemeReference = width === 1366 && theme !== 'original';
        const captureMobileReference = width === 375 && theme === 'dark';
        if (captureDesktopReference || captureThemeReference || captureMobileReference) {
          await page.screenshot({ path: test.info().outputPath(path.replaceAll('/', '_') + '.png'), fullPage: true });
        }
        const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => { const r=el.getBoundingClientRect();return r.width > 0 && r.right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute'; }).slice(0,12).map(el => ({tag:el.tagName,cls:el.className,width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right})));
        if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) console.log(path, overflow);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${path} desborda a ${width}x${height}` }).toBe(true);
        expect(errors, path).toEqual([]);
        await context.close();
      }
    });
  }
}
