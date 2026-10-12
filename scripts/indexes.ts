import generateIndexFiles from '@fringeworks/dev/generateIndexFiles';
import fs from 'fs';
import * as prettier from 'prettier';

const indexPaths = generateIndexFiles();

// 作成したindexファイルをPrettierで整形
for (const indexPath of indexPaths) {
  const options = await prettier.resolveConfig(indexPath);
  const source = fs.readFileSync(indexPath, 'utf8');
  const formatted = await prettier.format(source, {
    ...options,
    filepath: indexPath,
  });
  fs.writeFileSync(indexPath, formatted);
}
