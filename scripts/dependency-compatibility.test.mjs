import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const apiRequire = createRequire(new URL('../apps/api/package.json', import.meta.url));
const kitRequire = createRequire(apiRequire.resolve('drizzle-kit'));
const loaderRequire = createRequire(kitRequire.resolve('@esbuild-kit/esm-loader'));
const transformer = loaderRequire('@esbuild-kit/core-utils');
const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url));
const configRequire = createRequire(webRequire.resolve('@vercel/config/v1'));
const { convertRewrites } = configRequire('@vercel/routing-utils');
const { routes } = webRequire('@vercel/config/v1');

test('the Drizzle loader transforms TypeScript with its patched esbuild dependency', async () => {
  const source = `
    export const config: { dialect: string; schema: string } = {
      dialect: 'postgresql', schema: './src/db/schema/index.ts'
    };
  `;
  const commonjs = transformer.transformSync(source, 'drizzle-config.cts');
  const module = { exports: {} };
  runInNewContext(commonjs.code, { module, exports: module.exports });
  assert.equal(module.exports.config.dialect, 'postgresql');
  assert.equal(module.exports.config.schema, './src/db/schema/index.ts');
  assert.equal(commonjs.map.version, 3);

  const esm = await transformer.transform(source, 'drizzle-config.mts');
  const result = await import(
    `data:text/javascript;base64,${Buffer.from(esm.code).toString('base64')}`
  );
  assert.deepEqual(result.config, {
    dialect: 'postgresql',
    schema: './src/db/schema/index.ts',
  });
  assert.equal(esm.map.version, 3);
});

test('Vercel route conversion preserves nested API rewrites and the application fallback', () => {
  const [api, shell] = convertRewrites([
    routes.rewrite('/api/:path*', 'https://api.example.test/api/:path*'),
    routes.rewrite('/(.*)', '/index.html'),
  ]);
  const apiPattern = new RegExp(api.src);
  for (const path of ['/api/notes', '/api/notes/a%2Fb', '/api/study/session']) {
    const match = apiPattern.exec(path);
    assert.ok(match);
    assert.equal(api.dest.replace('$1', match[1]), `https://api.example.test${path}`);
  }
  assert.ok(apiPattern.test('/api'));
  assert.equal(apiPattern.test('/library'), false);
  const shellPattern = new RegExp(shell.src);
  for (const path of ['/', '/today', '/library/decks/example']) {
    assert.ok(shellPattern.test(path));
  }
  assert.equal(shell.dest, '/index.html');
});
