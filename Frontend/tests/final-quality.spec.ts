import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { qualityFixture, qualityPages, ready } from './quality-fixture';

for (const [width, height] of [[1920,1080],[1600,900],[1366,768],[1280,720],[1024,768],[768,1024],[390,844],[375,667],[360,800]]) {
  test(`RNF02 geometría ${width}x${height}`, async ({ browser }, info) => {
    test.setTimeout(120000);
    const findings: unknown[] = [];
    for (const [path, role] of qualityPages) {
      const page = await browser.newPage({ viewport: { width, height } });
      await qualityFixture(page, role); await ready(page, 'http://127.0.0.1:4322' + path);
      const overflow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('body *')].filter(el => {
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        if (!r.width || !r.height || s.visibility === 'hidden' || s.position === 'fixed') return false;
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (['auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth) return false;
        }
        // Clipping containers can hide overflow from document.scrollWidth; inspect the actual boxes.
        return r.right > innerWidth + 2 || r.left < -2;
      }).map(el => ({ tag: el.tagName, class: el.className, text: el.textContent?.trim().slice(0, 60) })).slice(0, 15));
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
      if (overflow.length || pageOverflow) findings.push({ path, pageOverflow, overflow });
      if (width === 360 || width === 1280) await page.screenshot({ path: info.outputPath(path.replace(/\W/g, '_') + '.png'), fullPage: true });
      await page.close();
    }
    await info.attach('geometry', { body: JSON.stringify(findings, null, 2), contentType: 'application/json' });
    expect(findings).toEqual([]);
  });
}

for (const theme of ['original', 'light', 'dark']) {
  test(`RNF11 axe ${theme}`, async ({ browser }, info) => {
    test.setTimeout(180000);
    const findings: unknown[] = [], incomplete: unknown[] = [];
    for (const [path, role] of qualityPages) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await qualityFixture(page, role, theme); await ready(page, 'http://127.0.0.1:4322' + path);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      if (result.violations.length) findings.push({ path, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
      if (result.incomplete.length) incomplete.push({ path, rules: result.incomplete.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })) });
      await context.close();
    }
    await info.attach('axe-findings', { body: JSON.stringify(findings, null, 2), contentType: 'application/json' });
    await info.attach('axe-manual-review', { body: JSON.stringify(incomplete, null, 2), contentType: 'application/json' });
    expect(findings).toEqual([]);
  });
}

for (const kind of ['service', 'slot', 'admin']) {
  test(`RNF11 teclado modal ${kind}`, async ({ page }) => {
    await qualityFixture(page, kind === 'admin' ? 'admin' : 'barbero');
    await ready(page, kind === 'admin' ? '/admin' : '/perfil-profesional');
    if (kind === 'service' || kind === 'slot') await page.locator('.pro-nav-link[href="#organizacion"]').click();
    if (kind === 'service') await page.getByRole('tab', { name: 'Servicios' }).click();
    if (kind === 'admin') await page.getByRole('button', { name: 'Clientes', exact: true }).click();
    const trigger = kind === 'service' ? page.locator('#open-service-modal') : kind === 'slot' ? page.locator('.barber-slot:not(:disabled)').first() : page.locator('[data-edit-id]').first();
    await trigger.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible(); await expect(dialog).toHaveAccessibleName(/Agregar servicio|Editar bloque|Actualizar datos/);
    for (let i = 0; i < 18; i++) {
      await page.keyboard.press(i < 9 ? 'Tab' : 'Shift+Tab');
      expect(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
    }
    await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  });
}
