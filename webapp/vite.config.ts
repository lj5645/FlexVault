import { fileURLToPath } from 'node:url';
import path from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: rootDir,
  plugins: [preact()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
      '@shared': path.resolve(rootDir, '../shared'),
    },
  },
  build: {
    outDir: path.resolve(rootDir, '../dist'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'esnext',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/')) {
            return 'vendor';
          }

          const normalized = id.replace(/\\/g, '/');

          if (
            normalized.includes('/src/components/AuthViews.tsx') ||
            normalized.includes('/src/components/PublicSendPage.tsx') ||
            normalized.includes('/src/components/RecoverTwoFactorPage.tsx') ||
            normalized.includes('/src/components/JwtWarningPage.tsx') ||
            normalized.includes('/src/lib/app-auth.ts')
          ) {
            return 'auth-suite';
          }

          if (
            normalized.includes('/src/components/ImportPage.tsx') ||
            normalized.includes('/src/lib/import-') ||
            normalized.includes('/src/lib/export-formats.ts') ||
            normalized.includes('/src/components/VaultPage.tsx') ||
            normalized.includes('/src/components/SendsPage.tsx') ||
            normalized.includes('/src/components/TotpCodesPage.tsx') ||
            normalized.includes('/src/components/vault/')
          ) {
            return 'workspace-suite';
          }

          if (
            normalized.includes('/src/components/BackupCenterPage.tsx') ||
            normalized.includes('/src/components/backup-center/') ||
            normalized.includes('/src/components/SettingsPage.tsx') ||
            normalized.includes('/src/components/SecurityDevicesPage.tsx') ||
            normalized.includes('/src/components/AdminPage.tsx')
          ) {
            return 'management-suite';
          }

          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(rootDir, '..')],
    },
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/identity': 'http://127.0.0.1:8787',
      '/setup': 'http://127.0.0.1:8787',
      '/icons': 'http://127.0.0.1:8787',
      '/config': 'http://127.0.0.1:8787',
      '/notifications': 'http://127.0.0.1:8787',
      '/.well-known': 'http://127.0.0.1:8787',
    },
  },
});
