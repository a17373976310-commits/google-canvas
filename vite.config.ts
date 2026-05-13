import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const requestedEdition = (env.VITE_APP_EDITION || '').toLowerCase();
    const appEdition = requestedEdition || (mode === 'development' ? 'admin' : 'client');
    const licenseAdminPanelPath = appEdition === 'admin'
      ? path.resolve(__dirname, 'components/LicenseAdminPanel.tsx')
      : path.resolve(__dirname, 'components/LicenseAdminPanel.stub.tsx');

    return {
      server: {
        port: 5173,
        strictPort: true,
        host: '0.0.0.0',
        proxy: {
          '/execute': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
          '/test-provider': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
          '/test-provider-image': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
          '/health': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
          '/history': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
          '/history-assets': {
            target: 'http://127.0.0.1:8000',
            changeOrigin: true,
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@/components/LicenseAdminPanel': licenseAdminPanelPath,
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
