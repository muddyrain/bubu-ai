import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import config from './electron.vite.config';

describe('renderer build and development configuration', () => {
  it('permits only the fixed loopback server and does not open a browser', async () => {
    const resolved = await config({ command: 'serve', mode: 'development' });
    expect(resolved.main?.define?.['__DEV__']).toBe('true');
    expect(resolved.renderer?.server).toMatchObject({
      host: '127.0.0.1', port: 5173, strictPort: true, open: false,
      hmr: { host: '127.0.0.1', port: 5173 },
    });
  });

  it('adds matching CSP nonces to the Vite and React HMR scripts without starting Electron', async () => {
    const resolved = await config({ command: 'serve', mode: 'development' });
    const root = fileURLToPath(new URL('./src/renderer', import.meta.url));
    const source = await readFile(`${root}/index.html`, 'utf8');
    // Attach HMR to an HTTP server that never listens on a port.
    const httpServer = createHttpServer();
    const server = await createServer({
      ...resolved.renderer,
      root,
      configFile: false,
      logLevel: 'silent',
      server: { middlewareMode: true, hmr: { server: httpServer }, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    try {
      const html = await server.transformIndexHtml('/', source);
      const nonce = resolved.renderer?.html?.cspNonce;
      expect(nonce).toBeTruthy();
      expect(html).toContain(`'nonce-${nonce}'`);
      expect(resolved.renderer?.server?.headers?.['Content-Security-Policy']).toContain(`'nonce-${nonce}'`);
      expect(html).toContain('ws://127.0.0.1:5173');
      expect(html).toContain('/@vite/client');
      expect(html).toContain('/@react-refresh');
      for (const script of html.matchAll(/<script\b[^>]*>/g)) {
        expect(script[0]).toContain(`nonce="${nonce}"`);
      }
      expect(html).not.toContain('unsafe-inline');
      expect(html).not.toContain('unsafe-eval');
      expect(html).not.toContain('__BUBU_CSP__');
    } finally {
      await server.close();
    }
  });

  it('builds production Main without a runtime development-mode switch', async () => {
    const resolved = await config({ command: 'build', mode: 'production' });
    expect(resolved.main?.define?.['__DEV__']).toBe('false');
    expect(resolved.renderer?.html?.cspNonce).toBeUndefined();
    expect(resolved.preload?.build?.externalizeDeps).toBe(false);
  });
});
