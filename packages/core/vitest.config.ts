import { defineConfig } from 'vitest/config';

// @zstate/core は framework 非依存 → node 環境で軽量・高速にテストする。
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**/*.ts'],
      // 型のみ（ランタイム実体なし）のファイルは対象外
      exclude: ['src/lib/typed-machine-types.ts', 'src/lib/types.ts', 'src/lib/devtools-types.ts'],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
});
