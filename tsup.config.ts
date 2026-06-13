import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'server/index': 'src/server/index.ts',
    'bin/cc-manage': 'bin/cc-manage.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: false,
  splitting: false,
  sourcemap: true,
  external: ['better-sqlite3'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
