import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/public-api.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  outDir: 'dist',
});
