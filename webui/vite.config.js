import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建产物直接输出到 Python 包的 static 目录，部署方式保持不变
export default defineConfig({
  plugins: [react()],
  // 相对路径 base：页面挂在网关任何子路径（如 /ssh-mcp/）下都能加载 assets，
  // 本地 dev 不受影响（仍跑在 /）。统一约定见工作空间根 CLAUDE.md。
  base: './',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:18899',
    },
  },
  build: {
    outDir: '../src/ssh_mcp/web/static',
    emptyOutDir: true,
  },
})
