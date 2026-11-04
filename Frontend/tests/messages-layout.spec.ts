import { test, expect, type Page } from '@playwright/test';
import { qualityFixture, ready } from './quality-fixture';

async function messagesFixture(page: Page, role: 'cliente' | 'barbero', theme = 'original') {
  await qualityFixture(page, role, theme);
  // The validated session, rather than a stale cached role, chooses the sidebar.
  await page.addInitScript(() => localStorage.setItem('user', JSON.stringify({ rol: 'admin' })));
  const otherUser = { id: 2, nombre: 'Contacto de prueba', rol: role === 'cliente' ? 'barbero' : 'cliente' };
  const timestamp = '2030-01-07T11:30:00Z';
  const messages = Array.from({ length: 60 }, (_, i) => ({
    id: `m${i}`, conversationId: 'c0', senderId: i % 2 ? 1 : 2,
    content: `Mensaje de prueba ${i}`, read: true, createdAt: timestamp,
  }));
  const conversations = Array.from({ length: 35 }, (_, i) => ({
    id: `c${i}`, clientId: role === 'cliente' ? 1 : 2, barberId: role === 'barbero' ? 1 : 2,
    createdAt: timestamp, updatedAt: timestamp, otherUser: { ...otherUser, nombre: `${otherUser.nombre} ${i}` },
    lastMessage: messages.at(-1),
  }));
  await page.route('**/api/conversations**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/messages')) {
      if (route.request().method() === 'POST') {
        messages.push({ ...messages[0], id: 'sent', senderId: 1, content: route.request().postDataJSON().content });
        return route.fulfill({ json: messages.at(-1) });
      }
      return route.fulfill({ json: messages });
    }
    return route.fulfill({ json: conversations });
  });
  return { messages };
}

async function expectBoundedLayout(page: Page) {
  const geometry = await page.evaluate(() => {
    const bounds = (selector: string) => {
      const { top, bottom, left, right } = document.querySelector(selector)!.getBoundingClientRect();
      return { top, bottom, left, right };
    };
    return {
      width: innerWidth, height: innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      verticalOverflow: document.documentElement.scrollHeight - innerHeight,
      app: bounds('.messages-app'), header: bounds('.messages-topbar'),
    };
  });
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.verticalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.app.top).toBeGreaterThanOrEqual(geometry.header.bottom);
  expect(geometry.app.bottom).toBeLessThanOrEqual(geometry.height);
  expect(geometry.app.right).toBeLessThanOrEqual(geometry.width);
  expect(geometry.app.left).toBeGreaterThanOrEqual(0);
}

for (const role of ['cliente', 'barbero'] as const) {
  for (const [width, height] of [[1920, 1080], [1366, 768], [1280, 720], [1024, 768], [768, 1024], [520, 800], [390, 844], [320, 568], [844, 390]]) {
    test(`${role}: mensajes integrados ${width}x${height}`, async ({ page }, info) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await messagesFixture(page, role);
      await ready(page, '/mensajes?conversation=c0');
      await expect(page.locator('.message-row')).toHaveCount(60);
      await expect(page.locator('.panel-sidebar')).toHaveCount(1);
      const sidebar = page.locator(role === 'barbero' ? '.pro-sidebar' : '.profile-sidebar');
      const active = sidebar.locator('a[aria-current="page"]');
      await expect(active).toHaveText('Mensajes');
      await expect(active).toHaveClass(/is-active/);
      await expectBoundedLayout(page);

      if (width > 1180) {
        await expect(sidebar).toBeVisible();
        const layout = await sidebar.evaluate(el => {
          const nav = el.querySelector('.panel-sidebar-nav')!;
          return {
            right: el.getBoundingClientRect().right,
            bottom: el.getBoundingClientRect().bottom,
            navOverflow: nav.scrollHeight - nav.clientHeight,
            mainLeft: document.querySelector('.messages-root')!.getBoundingClientRect().left,
          };
        });
        expect(layout.mainLeft).toBeGreaterThanOrEqual(layout.right);
        expect(layout.bottom).toBeLessThanOrEqual(height);
        expect(layout.navOverflow).toBeLessThanOrEqual(1);
      } else {
        await expect(sidebar).toBeHidden();
        const menu = page.locator('#messages-menu-toggle');
        await menu.click();
        await expect(sidebar).toBeVisible();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
        const composer = await page.locator('#message-form').boundingBox();
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(height);
        const bottom = await sidebar.evaluate(el => el.getBoundingClientRect().bottom);
        const header = await page.locator('.messages-topbar').boundingBox();
        expect(bottom).toBeLessThanOrEqual(header!.y);
        await page.keyboard.press('Escape');
        await expect(sidebar).toBeHidden();
        await expect(menu).toBeFocused();
      }

      // Long histories and contact lists scroll independently from the main navigation.
      const history = page.locator('#messages-history');
      expect(await history.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await history.evaluate(el => { el.scrollTop = 0; });
      await expect(page.locator('#message-input')).toBeInViewport();
      expect(await page.evaluate(() => scrollY)).toBe(0);
      if (width <= 520) await page.getByRole('button', { name: 'Volver a conversaciones' }).click();
      await expect(page.locator('#conversations-list')).toBeVisible();
      expect(await page.locator('#conversations-list').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await page.locator('[data-conversation-id="c34"]').focus();
      await expect(page.locator('[data-conversation-id="c34"]')).toBeInViewport();
      expect(await page.evaluate(() => scrollY)).toBe(0);
      await page.locator('[data-conversation-id="c0"]').click();
      await expect(page.locator('#chat-name')).toHaveText('Contacto de prueba 0');
      await expectBoundedLayout(page);
      if (width === 1280 || width === 390) await page.screenshot({ path: info.outputPath(`${role}-${width}.png`) });
      expect(errors).toEqual([]);
    });
  }

  for (const width of [1280, 390]) {
    test(`${role}: entrar, enviar, recibir y salir ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      const { messages } = await messagesFixture(page, role);
      const panel = role === 'cliente' ? '/perfil' : '/perfil-profesional';
      await ready(page, panel);
      await page.locator('.panel-sidebar a[href="/mensajes"]').click();
      await expect(page).toHaveURL(/\/mensajes/);
      if (width <= 520) await page.locator('[data-conversation-id="c0"]').click();
      await expect(page.locator('.message-row')).toHaveCount(60);
      await page.getByLabel('Escribir mensaje').fill('Mensaje enviado desde el panel');
      await page.getByRole('button', { name: 'Enviar', exact: true }).click();
      await expect(page.locator('.is-sent .message-bubble p').last()).toHaveText('Mensaje enviado desde el panel');
      await expect(page.getByLabel('Escribir mensaje')).toHaveValue('');
      messages.push({ ...messages[0], id: 'received', content: 'Respuesta del contacto' });
      await expect(page.locator('.is-received .message-bubble p').last()).toHaveText('Respuesta del contacto');
      if (width <= 1180) await page.getByRole('button', { name: 'Abrir menú principal' }).click();
      const target = role === 'cliente' ? '/perfil' : '/perfil-profesional#mis-citas';
      await page.locator(`.panel-sidebar a[href="${target}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${target}$`));
      if (role === 'barbero') await expect(page.locator('[data-pro-panel="mis-citas"]')).toBeVisible();
    });
  }

  for (const theme of ['light', 'dark']) {
    test(`${role}: tema ${theme} y cambio entre escritorio y móvil`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await messagesFixture(page, role, theme);
      await ready(page, '/mensajes?conversation=c0');
      await expect(page.locator('#chat-name')).toHaveText('Contacto de prueba 0');
      await expect(page.locator('.panel-sidebar')).toBeVisible();
      await expectBoundedLayout(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'Abrir menú principal' }).click();
      await expect(page.locator('.panel-sidebar')).toBeVisible();
      await page.getByRole('button', { name: 'Cerrar menú principal' }).click();
      await expect(page.locator('.panel-sidebar')).toBeHidden();
      await page.locator('[data-conversation-id="c0"]').click();
      await expect(page.locator('#message-input')).toBeInViewport();
      await expectBoundedLayout(page);
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(page.locator('.panel-sidebar')).toBeVisible();
      await expect(page.locator('.messages-sidebar')).toBeVisible();
      await expect(page.locator('#chat-name')).toHaveText('Contacto de prueba 0');
      await expect(page.locator('#message-input')).toBeInViewport();
      await expectBoundedLayout(page);
    });
  }
}
