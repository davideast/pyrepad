import { defineConfig } from 'vite';
import { pyric } from '@pyric/cli/vite';

export default defineConfig({
  plugins: [
    pyric({
      runtimeChip: { initiallyOpen: false }
    })
  ],
  server: {
    port: 5173,
    host: '0.0.0.0'
  }
});
