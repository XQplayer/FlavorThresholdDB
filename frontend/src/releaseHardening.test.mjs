import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('release build does not expose Excel import or ship SheetJS', async () => {
  const app = await readFile(new URL('./App.jsx', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(pkg.dependencies?.xlsx, undefined);
  assert.doesNotMatch(app, /from ['"]xlsx['"]|XLSX\.read|handleFileUpload|file-upload/);
});

test('release verification artifacts stay outside source control boundaries', async () => {
  const ignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.match(ignore, /^\/\.playwright-cli\/$/m);
  assert.match(ignore, /^\/\.superpowers\/$/m);
  assert.equal(pkg.scripts?.['test:e2e'], 'node ../scripts/e2e/verify_release_candidate.mjs');
});
