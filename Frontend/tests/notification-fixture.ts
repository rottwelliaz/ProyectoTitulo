import { build } from 'vite';
import type { Page } from '@playwright/test';

export const notificationModuleUrl = '/__test__/notifications.js';
let moduleBundle: Promise<string> | undefined;

// Compile the utility for the browser in both dev and preview. Playwright alone
// serves this fixture; no test entry point is added to the deployed application.
export async function installNotificationModule(page: Page) {
  const source = new URL('../src/lib/notifications.ts', import.meta.url);
  const sourcePath = decodeURIComponent(source.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '');
  const root = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:\/)/, '');
  moduleBundle ??= build({
    configFile: false, root, logLevel: 'error',
    build: {
      write: false, lib: { entry: sourcePath, formats: ['es'] },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  }).then(result => {
    const output = Array.isArray(result) ? result[0] : result;
    if (!('output' in output)) throw new Error('No se pudo compilar el módulo de prueba de notificaciones.');
    const module = output.output.find(file => file.type === 'chunk');
    if (!module || module.type !== 'chunk') throw new Error('Falta el módulo compilado de notificaciones.');
    return module.code;
  });
  const body = await moduleBundle;
  await page.route(`**${notificationModuleUrl}`, route => route.fulfill({ contentType: 'text/javascript', body }));
}
