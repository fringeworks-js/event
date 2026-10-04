import createExternalOptionFunction from '@fringeworks/dev/createExternalOptionFunction';
import distPackage from '@fringeworks/rollup-plugin-dist-package';
import copy from 'rollup-plugin-copy';
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.test.{ts,tsx}',
    '!src/**/*.d.{ts,tsx}',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  unbundle: true,
  sourcemap: false,
  clean: true,
  outDir: 'dist',
  minify: false,
  inputOptions: {
    external: createExternalOptionFunction(),
  },
  outputOptions: {
    preserveModules: true,
    preserveModulesRoot: 'src',
  },
  plugins: [
    distPackage({
      content: {
        main: './index.cjs',
        module: './index.mjs',
        types: './index.d.cts',
        exports: {
          '.': {
            import: { types: './index.d.mts', default: './index.mjs' },
            require: { types: './index.d.cts', default: './index.cjs' },
          },
          './package.json': './package.json',
          './constants': {
            import: { types: './constants.d.mts', default: './constants.mjs' },
            require: { types: './constants.d.cts', default: './constants.cjs' },
          },
          './*/constants': {
            import: {
              types: './*/constants.d.mts',
              default: './*/constants.mjs',
            },
            require: {
              types: './*/constants.d.cts',
              default: './*/constants.cjs',
            },
          },
          './types': {
            import: { types: './types.d.mts', default: './types.mjs' },
            require: { types: './types.d.cts', default: './types.cjs' },
          },
          './*/types': {
            import: { types: './*/types.d.mts', default: './*/types.mjs' },
            require: { types: './*/types.d.cts', default: './*/types.cjs' },
          },
          './*': {
            import: { types: './*/index.d.mts', default: './*/index.mjs' },
            require: { types: './*/index.d.cts', default: './*/index.cjs' },
          },
        },
      },
      resolveWorkspaceDeps: true,
    }),
    copy({
      targets: [
        {
          src: ['LICENSE', 'README.md', 'README.ja.md'],
          dest: 'dist',
        },
      ],
    }),
  ],
});
