
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    server: {
      proxy: {
        // Redirect any request starting with /api to our backend server
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    define: {
      // We don't need to expose API_KEY to the frontend anymore!
      // But keeping it empty string to prevent build errors if referenced elsewhere
      'process.env.API_KEY': JSON.stringify(''),
    },
  };
});
