import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Dev only: forwards uncaught errors and console.error from the page (including the
 * Tauri WebView, whose console is otherwise invisible) to the dev server terminal.
 * Messages are error names/messages and stack frames, never document content.
 */
export function devErrorRelay(): Plugin {
  return {
    name: 'formflow-dev-error-relay',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev-error-relay.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(readFileSync(new URL('./dev-error-relay.client.js', import.meta.url)));
      });
      server.middlewares.use('/__dev-error', (req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => (body += c.toString()));
        req.on('end', () => {
          server.config.logger.error(`[webview] ${body.slice(0, 4000)}`, { timestamp: true });
          res.statusCode = 204;
          res.end();
        });
      });
    },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{ tag: 'script', attrs: { src: '/__dev-error-relay.js' }, injectTo: 'head-prepend' }],
    },
  };
}
