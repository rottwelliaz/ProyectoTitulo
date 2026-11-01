import { expect, test } from '@playwright/test';
import { escapeHtml, escapeHtmlValue } from '../src/lib/html';

test('escapa texto y atributos sin interpretar HTML ni entidades preexistentes', async ({ page }) => {
  const value = `Concepción & <img src=x onerror="alert(1)"> ' &amp;`;
  const escaped = escapeHtml(value);
  expect(escaped).toBe('Concepción &amp; &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &#039; &amp;amp;');
  await page.setContent(`<p data-value="${escaped}">${escaped}</p>`);
  await expect(page.locator('p')).toHaveText(value);
  await expect(page.locator('p')).toHaveAttribute('data-value', value);
  await expect(page.locator('img')).toHaveCount(0);
});

test('conserva la conversión de campos administrativos y mensajes', () => {
  for (const [value, expected] of [[null, ''], [undefined, ''], ['', ''], [0, '0'], [42, '42'], [false, 'false']] as const) {
    expect(escapeHtmlValue(value)).toBe(expected);
  }
  expect(escapeHtmlValue('<b>Nombre & apellido</b>')).toBe('&lt;b&gt;Nombre &amp; apellido&lt;/b&gt;');
});
