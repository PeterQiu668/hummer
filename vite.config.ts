import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    // 同时绑 IPv4 + IPv6
    host: true,
    port: 3000,           // 换到 3000，避开任何 5174 端口的浏览器缓存/HSTS/代理 PAC
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
