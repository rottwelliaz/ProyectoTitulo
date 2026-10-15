import { test, expect, type Page } from '@playwright/test';

const service = (nombre_servicio: string, precio: number, duracion_minutos: number) =>
  ({ id: nombre_servicio, nombre_servicio, precio, duracion_minutos });
const barbers = [
  { id: 1, nombre: 'Álvaro Pérez', rol: 'barbero', aprobado: true, perfilBarbero: {
    id: 11, biografia: 'Especialista en coloración',
    lugarTrabajo: { nombre_barberia: 'Club Centro', direccion: 'Concepción' },
    servicios: [service('Corte', 10000, 30), service('Barba', 5000, 15), service('Diseño artístico', 15000, 45)],
  } },
  { id: 2, nombre: 'Bruno Soto', rol: 'barbero', aprobado: true, perfilBarbero: {
    id: 12, biografia: null, lugarTrabajo: { nombre_barberia: 'Club Norte', direccion: 'Talcahuano' },
    servicios: [service('Fade', 12000, 40)],
  } },
  { id: 3, nombre: 'Carla Díaz', rol: 'barbero', aprobado: true, perfilBarbero: {
    id: 13, biografia: null, lugarTrabajo: null, servicios: [],
  } },
];
const names = (page: Page) => page.locator('.barber-profile-card h2');
async function catalog(page: Page, data: unknown = barbers) {
  await page.route('**/usuarios?rol=barbero', route => route.fulfill({ json: data }));
}

test.beforeEach(({ page }) => {
  page.on('pageerror', error => { throw error; });
});

test('consulta el endpoint público y excluye pendientes y otros roles', async ({ page }) => {
  await catalog(page, [...barbers,
    { ...barbers[0], id: 4, nombre: 'Pendiente', aprobado: false },
    { ...barbers[0], id: 5, nombre: 'Cliente', rol: 'cliente' },
  ]);
  const requested = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/api/usuarios'));
  await page.goto('/barberos');
  expect(new URL((await requested).url()).searchParams.get('rol')).toBe('barbero');
  await expect(names(page)).toHaveText(['Álvaro Pérez', 'Bruno Soto', 'Carla Díaz']);
  await expect(page.locator('#barbers-count')).toContainText('3');
});

test('busca nombre, todos los servicios, biografía, ubicación y barbería', async ({ page }) => {
  await catalog(page);
  await page.goto('/barberos?buscar=alvaro');
  await expect(names(page)).toHaveText(['Álvaro Pérez']);
  for (const query of ['  PEREZ  ', 'diseño artistico', 'coloracion', 'concepcion', 'club centro']) {
    await page.locator('#barber-search').fill(query);
    await expect(names(page)).toHaveText(['Álvaro Pérez']);
    await expect(page.locator('#top-search')).toHaveValue(query);
  }
  await page.locator('#top-search').fill('talcahuano');
  await expect(names(page)).toHaveText(['Bruno Soto']);
  await expect(page.locator('#barber-search')).toHaveValue('talcahuano');
  await page.locator('#barber-search').fill('sin coincidencias');
  await expect(names(page)).toHaveCount(0);
  await expect(page.locator('#barbers-grid')).toContainText('No hay barberos que coincidan');
  await page.locator('#barber-search').fill('');
  await expect(names(page)).toHaveCount(3);
});

const orders: Record<string, string[]> = {
  'name-asc': ['Álvaro Pérez', 'Bruno Soto', 'Carla Díaz'],
  'name-desc': ['Carla Díaz', 'Bruno Soto', 'Álvaro Pérez'],
  'price-asc': ['Álvaro Pérez', 'Bruno Soto', 'Carla Díaz'],
  'price-desc': ['Bruno Soto', 'Álvaro Pérez', 'Carla Díaz'],
  'duration-asc': ['Álvaro Pérez', 'Bruno Soto', 'Carla Díaz'],
  'duration-desc': ['Bruno Soto', 'Álvaro Pérez', 'Carla Díaz'],
  'services-asc': ['Carla Díaz', 'Bruno Soto', 'Álvaro Pérez'],
  'services-desc': ['Álvaro Pérez', 'Bruno Soto', 'Carla Díaz'],
};
for (const [order, expected] of Object.entries(orders)) {
  test(`ordenamiento ${order}, incluyendo profesionales sin servicios`, async ({ page }) => {
    await catalog(page);
    await page.goto('/barberos');
    await page.locator('#sort-filter').selectOption(order);
    await expect(names(page)).toHaveText(expected);
    await page.locator('#barber-search').fill('club');
    await expect(names(page)).toHaveText(expected.filter(name => name !== 'Carla Díaz'));
  });
}

test('conserva carga mientras se consulta y aplica el filtro escrito durante la espera', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route('**/usuarios?rol=barbero', async route => {
    requested = true;
    await gate;
    await route.fulfill({ json: barbers });
  });
  await page.goto('/barberos');
  await expect.poll(() => requested).toBe(true);
  await page.locator('#barber-search').fill('bruno');
  await expect(page.locator('#barbers-count')).toHaveText('Cargando barberos...');
  release();
  await expect(names(page)).toHaveText(['Bruno Soto']);
});

test('catálogo vacío distingue ausencia de profesionales de errores', async ({ page }) => {
  await catalog(page, []);
  await page.goto('/barberos');
  await expect(page.locator('#barbers-grid')).toContainText('No hay barberos disponibles por el momento');
  await expect(page.locator('#barbers-count')).toContainText('0');
});

for (const failure of ['network', 'http', 'json', 'shape']) {
  test(`error ${failure} no se convierte en resultados vacíos al filtrar`, async ({ page }) => {
    await page.route('**/usuarios?rol=barbero', route => {
      if (failure === 'network') return route.abort();
      if (failure === 'http') return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
      if (failure === 'json') return route.fulfill({ body: 'invalid json', contentType: 'application/json' });
      return route.fulfill({ json: { unexpected: [] } });
    });
    await page.goto('/barberos');
    await expect(page.locator('#barbers-count')).toHaveText('No se pudieron cargar los barberos');
    await page.locator('#barber-search').fill('alvaro');
    await page.locator('#sort-filter').selectOption('price-desc');
    await page.locator('#list-view').click();
    await expect(page.locator('#barbers-count')).toHaveText('No se pudieron cargar los barberos');
    await expect(page.locator('#barbers-grid')).toContainText('Revisa tu conexión');
    await expect(page.locator('#barbers-pagination button')).toHaveCount(0);
  });
}

test('paginación, vista de lista y filtros mantienen resultados coherentes', async ({ page }) => {
  const many = Array.from({ length: 10 }, (_, index) => ({ ...barbers[0], id: index + 20, nombre: `Barbero ${String(index).padStart(2, '0')}` }));
  await catalog(page, many);
  await page.goto('/barberos');
  await expect(names(page)).toHaveCount(8);
  await page.getByRole('button', { name: 'Ir a página 2', exact: true }).click();
  await expect(names(page)).toHaveText(['Barbero 08', 'Barbero 09']);
  await page.locator('#list-view').click();
  await expect(page.locator('#barbers-grid')).toHaveClass(/is-list/);
  await page.locator('#barber-search').fill('Barbero 00');
  await expect(names(page)).toHaveText(['Barbero 00']);
  await expect(page.locator('#barbers-pagination button')).toHaveCount(0);
});

for (const theme of ['original', 'light', 'dark']) {
  test(`conserva tema ${theme}, tarjetas y acceso del invitado`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('ui-theme', value), theme);
    await catalog(page);
    await page.goto('/barberos');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(names(page)).toHaveCount(3);
    await expect(page.locator('[data-session-guest]')).toBeVisible();
    const link = page.locator('.profile-button').first();
    await expect(link).toHaveAttribute('href', '/barbero?barbero=11');
    await link.click();
    await expect(page).toHaveURL(/\/barbero\?barbero=11/);
  });
}
