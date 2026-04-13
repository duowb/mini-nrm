import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts'],
  platform: 'node',
  dts: true,
  clean: true,
  outDir: 'dist',
  sourcemap: false,
  format: ['cjs', 'esm'],
})
