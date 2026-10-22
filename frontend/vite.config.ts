import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

const proxy = {
  '/api': { target: process.env.TRAVEL_API_TARGET ?? 'http://127.0.0.1:3080', changeOrigin: false },
  '/health': { target: process.env.TRAVEL_API_TARGET ?? 'http://127.0.0.1:3080', changeOrigin: false },
};
export default defineConfig({
  plugins: [vue()],
  server: { proxy },
  preview: { proxy },
  build: { sourcemap: false, outDir: process.env.TRAVEL_DIST_DIR ?? 'dist' },
});
