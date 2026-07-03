import { defineConfig, loadEnv, type Plugin } from 'vite';

/** VITE_API_BASE_URL を CSP connect-src に反映する */
function cspConnectSrcPlugin(apiBase: string): Plugin {
  return {
    name: 'csp-connect-src',
    transformIndexHtml(html) {
      const origins = new Set(["'self'", 'http://localhost:8000', 'http://127.0.0.1:8000']);
      try {
        const url = new URL(apiBase);
        origins.add(`${url.protocol}//${url.host}`);
      } catch {
        // デフォルト localhost のみ
      }
      const connectSrc = Array.from(origins).join(' ');
      return html.replace(
        /connect-src [^;]+;/,
        `connect-src ${connectSrc};`
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:8000';

  return {
    server: {
      port: 3000,
      strictPort: true,
      headers: {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
      fs: {
        strict: true,
        deny: ['.env', '.env.*'],
      },
    },
    plugins: [cspConnectSrcPlugin(apiBase)],
  };
});
