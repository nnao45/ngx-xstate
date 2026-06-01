import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 開発/テスト時は @zstate/core を dist ではなくソース直参照する（再ビルド不要）。
const coreSrc = fileURLToPath(new URL('../core/src/public-api.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@zstate/core': coreSrc,
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/types.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
