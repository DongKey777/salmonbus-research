import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local research APIs behind the dev server. The public build (--mode pages) never calls them.
const local = (port: number) => ({
  target: `http://127.0.0.1:${port}`, changeOrigin: true,
  configure(proxy: { on: (event: 'proxyReq', fn: (req: { getHeader: (k: string) => unknown; setHeader: (k: string, v: string) => void }) => void) => void }) {
    proxy.on('proxyReq', (req) => { if (req.getHeader('origin')) req.setHeader('origin', `http://127.0.0.1:${port}`); });
  },
});

export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  return {
    // GitHub Pages project page: https://<user>.github.io/salmonbus-research/
    base: pages ? (process.env.PAGES_BASE ?? '/salmonbus-research/') : '/',
    plugins: [react()],
    server: { host: '127.0.0.1', port: 62421, strictPort: true, proxy: { '/api/v8': local(62436), '/api/v7': local(62434), '/api/v3': local(62424) } },
    build: pages
      ? { outDir: 'dist-pages', emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 800 }
      : { outDir: 'dist', sourcemap: true },
  };
});
