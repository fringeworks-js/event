import createTsdownConfig from '@fringeworks/dev/createTsdownConfig';
import { defineConfig } from 'tsdown';

const config = createTsdownConfig();

export default defineConfig({
  ...config,
  outputOptions: {
    ...config.outputOptions,
    // [Symbol.dispose] の型を利用者側で解決できるようにする（rolldown-plugin-dts は lib の参照を出力から削除するため banner で追加する）
    banner: (chunk) =>
      /^EventDispatcher\/EventDispatcher\.d\.[cm]ts$/.test(chunk.fileName)
        ? '/// <reference lib="esnext.disposable" />'
        : '',
  },
});
