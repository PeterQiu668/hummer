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
    // 端到端把 Electron 配置档写在 spikes/ 下；监听到其中被占用的临时文件会抛 EBUSY，
    // Vite 随即退出、桌面端加载不到页面（Windows 实测）。证据与构建产物也无需热更新。
    watch: { ignored: ['**/spikes/**', '**/release/**', '**/.claude/**', '**/apps/desktop/dist/**'] },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
