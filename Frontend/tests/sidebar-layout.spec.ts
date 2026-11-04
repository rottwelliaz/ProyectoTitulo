import { test, expect, type Page } from '@playwright/test';
import { qualityFixture, ready } from './quality-fixture';

const panels = [
  ['/perfil', 'cliente'], ['/mis-citas', 'cliente'],
  ['/configuracion', 'cliente'],
  ['/perfil-profesional', 'barbero'],
  ['/admin', 'admin'],
] as const;

async function geometry(page: Page) {
  return page.locator('.panel-sidebar').evaluate(sidebar => {
    const nav = sidebar.querySelector<HTMLElement>('.panel-sidebar-nav')!;
    const bounds = (el: Element) => {
      const { top, bottom, left, right } = el.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return {
      sidebar: bounds(sidebar), nav: bounds(nav),
      brand: bounds(sidebar.querySelector('.panel-sidebar-brand')!),
      footer: sidebar.querySelector('.panel-sidebar-footer') ? bounds(sidebar.querySelector('.panel-sidebar-footer')!) : null,
      links: [...nav.querySelectorAll<HTMLElement>('a, button')].filter(el => el.getClientRects().length).map(bounds),
      navOverflow: nav.scrollHeight - nav.clientHeight,
      sidebarOverflow: sidebar.scrollHeight - sidebar.clientHeight,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      height: innerHeight,
    };
  });
}

for (const theme of ['original', 'light', 'dark']) {
  for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1180, 820], [1024, 768], [768, 1024], [390, 844], [320, 568], [844, 390]]) {
    test(`sidebar ${theme} ${width}x${height}`, async ({ browser }, info) => {
      test.setTimeout(90000);
      for (const [path, role] of panels) {
        const page = await browser.newPage({ viewport: { width, height } });
        await qualityFixture(page, role, theme);
        await ready(page, path);
        const layout = await geometry(page);
        expect(layout.sidebar.top, path).toBeGreaterThanOrEqual(0);
        expect(layout.sidebar.bottom, path).toBeLessThanOrEqual(height + 1);
        expect(layout.sidebarOverflow, path).toBeLessThanOrEqual(1);
        expect(layout.pageOverflow, path).toBeLessThanOrEqual(1);
        expect(layout.brand.bottom, path).toBeLessThanOrEqual(layout.nav.top);
        if (layout.footer) {
          expect(layout.footer.top, path).toBeGreaterThanOrEqual(layout.nav.bottom);
          expect(layout.footer.bottom, path).toBeLessThanOrEqual(height);
        }
        expect(layout.navOverflow, path).toBeLessThanOrEqual(1);
        for (const link of layout.links) {
          expect(link.top, path).toBeGreaterThanOrEqual(layout.nav.top);
          expect(link.bottom, path).toBeLessThanOrEqual(layout.nav.bottom + 1);
          expect(link.left, path).toBeGreaterThanOrEqual(0);
          expect(link.right, path).toBeLessThanOrEqual(width);
        }

        // A long main section must scroll without moving either end of the sidebar.
        await page.locator('.panel-layout > section').evaluate(main => {
          const content = document.createElement('div');
          content.style.height = '2400px';
          main.append(content);
        });
        await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 800); });
        expect(await page.evaluate(() => scrollY), path).toBe(800);
        const scrolled = await geometry(page);
        expect(scrolled.sidebar.top, path).toBe(layout.sidebar.top);
        expect(scrolled.footer?.bottom, path).toBe(layout.footer?.bottom);
        if ((width === 1280 || width === 390) && theme === 'original') {
          await page.screenshot({ path: info.outputPath(`${path.slice(1)}.png`) });
        }
        await page.close();
      }
    });
  }
}

test('short windows scroll only navigation and keep the logo and footer accessible', async ({ browser }) => {
  for (const [width, height] of [[1280, 240], [390, 240]]) {
    for (const [path, role] of panels) {
      const page = await browser.newPage({ viewport: { width, height } });
      await qualityFixture(page, role);
      await ready(page, path);
      const before = await geometry(page);
      expect(before.sidebar.bottom, path).toBeLessThanOrEqual(height);
      expect(before.sidebarOverflow, path).toBeLessThanOrEqual(1);
      if (path !== '/configuracion') expect(before.navOverflow, path).toBeGreaterThan(0);
      const last = page.locator('.panel-sidebar-nav > :is(a, button):visible').last();
      await last.focus();
      await expect.poll(async () => {
        const current = await geometry(page);
        return current.links.at(-1)!.bottom - current.nav.bottom;
      }).toBeLessThanOrEqual(1);
      const after = await geometry(page);
      expect(after.links.at(-1)!.bottom, path).toBeLessThanOrEqual(after.nav.bottom + 1);
      expect(after.links.at(-1)!.top, path).toBeGreaterThanOrEqual(after.nav.top);
      expect(after.brand, path).toEqual(before.brand);
      expect(after.footer, path).toEqual(before.footer);
      expect(await page.evaluate(() => scrollY), path).toBe(0);
      await page.close();
    }
  }
});

test('sidebar links and account menu still work after scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await qualityFixture(page, 'barbero');
  await ready(page, '/perfil-profesional');
  await page.locator('.pro-nav-link[href="#mis-citas"]').click();
  await expect(page.locator('#mis-citas')).toBeVisible();
  await page.locator('.pro-nav-link[href="#configuracion-reservas"]').click();
  await expect(page.locator('#configuracion-reservas')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  await page.locator('[data-session-dropdown]').getByRole('link', { name: 'Configuración', exact: true }).click();
  await expect(page).toHaveURL(/\/configuracion/);
  await page.locator('.panel-sidebar-nav a[href="/perfil"]').click();
  await expect(page).toHaveURL(/\/perfil$/);
});

for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [390, 844], [844, 390]]) {
  test(`conversation sidebar ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await qualityFixture(page);
    await ready(page, '/mensajes');
    await page.locator('.messages-sidebar-list').evaluate(list => {
      for (let i = 0; i < 40; i++) {
        const button = document.createElement('button');
        button.className = 'conversation-item';
        button.textContent = `Contacto ${i}`;
        list.append(button);
      }
    });
    const layout = await page.locator('.messages-sidebar').evaluate(sidebar => {
      const list = sidebar.querySelector<HTMLElement>('.messages-sidebar-list')!;
      return {
        top: sidebar.getBoundingClientRect().top,
        bottom: sidebar.getBoundingClientRect().bottom,
        listOverflow: list.scrollHeight - list.clientHeight,
        pageOverflow: document.documentElement.scrollHeight - innerHeight,
      };
    });
    expect(layout.top).toBeGreaterThan(0);
    expect(layout.bottom).toBeLessThanOrEqual(height);
    expect(layout.pageOverflow).toBeLessThanOrEqual(1);
    expect(layout.listOverflow).toBeGreaterThan(0);
    await page.locator('.conversation-item').last().focus();
    await expect(page.locator('.conversation-item').last()).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}
