import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Plain vitest + @vue/test-utils (happy-dom). Components import from 'vue' and
// use relative paths so tests run without the full Nuxt runtime/auto-imports.
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'happy-dom',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    exclude: ['node_modules/**', '.nuxt/**', '.output/**'],
  },
})
