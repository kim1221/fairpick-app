import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL

  return {
    plugins: [react()],
    server: {
      // VITE_API_URL이 설정되면 proxy 불필요 (axios가 직접 해당 URL로 요청)
      // 설정 안 됐을 때만 로컬 백엔드로 proxy
      proxy: apiUrl ? undefined : {
        '/admin': {
          target: 'http://localhost:5001',
          changeOrigin: true,
        },
        '/api': {
          target: 'http://localhost:5001',
          changeOrigin: true,
        },
      },
    },
  }
})
