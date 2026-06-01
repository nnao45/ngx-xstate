import { defineConfig } from 'vitest/config';

// ルートからは両 package を projects として一括実行する（集約レポートは取らない）。
// カバレッジは package 独立で各 100% を担保するため `pnpm -r test:coverage` を使う。
export default defineConfig({
  test: {
    projects: ['packages/*'],
  },
});
