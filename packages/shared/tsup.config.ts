import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    colors: 'src/colors.ts',
    types: 'src/types.ts',
    'tts-preprocessing': 'src/tts-preprocessing.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});

