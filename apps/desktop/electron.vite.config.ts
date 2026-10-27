import { randomBytes } from 'node:crypto';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { DEV_SERVER_URL } from './src/shared/ipc';

export default defineConfig(({ command }) => {
  const development = command === 'serve';
  const nonce = randomBytes(16).toString('base64');
  const csp = [
    "default-src 'none'",
    `script-src 'self'${development ? ` 'nonce-${nonce}'` : ''}`,
    `style-src 'self'${development ? ` 'nonce-${nonce}'` : ''}`,
    "img-src 'self'",
    "font-src 'self'",
    `connect-src ${development ? `${DEV_SERVER_URL} ws://127.0.0.1:5173` : "'none'"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join('; ');

  return {
    main: {
      define: { __DEV__: JSON.stringify(development) },
      build: {
        rollupOptions: {
          output: { format: 'cjs', entryFileNames: 'index.cjs' },
        },
      },
    },
    preload: {
      build: {
        externalizeDeps: false,
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: 'index.cjs',
            inlineDynamicImports: true,
          },
        },
      },
    },
    renderer: {
      base: './',
      html: development ? { cspNonce: nonce } : {},
      plugins: [
        {
          name: 'bubu-csp',
          transformIndexHtml: {
            order: 'pre',
            handler: (html) => html.replace('__BUBU_CSP__', csp),
          },
        },
        react(),
      ],
      server: {
        headers: { 'Content-Security-Policy': csp },
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
        open: false,
        hmr: { host: '127.0.0.1', port: 5173 },
      },
    },
  };
});
