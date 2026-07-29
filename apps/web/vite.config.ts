import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom', 'react-router-dom'],
    },
    // Pre-bundle every dep reachable from the entry so the optimizer never
    // discovers one mid-load and re-serves modules under ?t= URLs. A late
    // discovery once duplicated src/auth/react.tsx and split its context
    // between provider and consumer ("Hub auth context is missing").
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react-router-dom',
        '@tanstack/react-query',
        '@fxl-business/hub-sdk/client',
        'lucide-react',
        'i18next',
        'react-i18next',
        '@radix-ui/react-alert-dialog',
        '@radix-ui/react-dialog',
        '@radix-ui/react-dropdown-menu',
        '@radix-ui/react-label',
        '@radix-ui/react-select',
        '@radix-ui/react-slot',
        '@radix-ui/react-tabs',
      ],
    },
    server: {
      port: 8006,
      strictPort: true,
      host: true,
      warmup: {
        clientFiles: [
          './src/main.tsx',
          './src/App.tsx',
          './src/router.tsx',
          './src/sales-ops/SalesOpsApp.tsx',
        ],
      },
      proxy: {
        '/auth': {
          target: env.VITE_AUTH_PROXY_TARGET || env.VITE_API_URL || 'http://localhost:3006',
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('/@tanstack/')) {
              return 'vendor-query';
            }
            if (id.includes('/@radix-ui/')) {
              return 'vendor-radix';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
