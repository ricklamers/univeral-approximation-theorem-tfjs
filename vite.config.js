import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/univeral-approximation-theorem-tfjs/',  // Add this line - should match your repo name
})
