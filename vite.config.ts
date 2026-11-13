import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/mapa-situacao/',
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
