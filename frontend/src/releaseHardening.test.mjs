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

test('large chemistry renderers remain lazy loaded', async () => {
  const structureViewer = await readFile(new URL('./components/PubChemStructureViewer.jsx', import.meta.url), 'utf8');
  const classifier = await readFile(new URL('./lib/compoundClassification.js', import.meta.url), 'utf8');

  assert.match(structureViewer, /import\(['"]3dmol['"]\)/);
  assert.doesNotMatch(structureViewer, /^import .* from ['"]3dmol['"]/m);
  assert.match(classifier, /import\(['"]@rdkit\/rdkit['"]\)/);
  assert.doesNotMatch(classifier, /^import .* from ['"]@rdkit\/rdkit['"]/m);
});

test('release documents describe the current candidate boundaries', async () => {
  const readProjectFile = relativePath => readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  const [readme, changelog, sources, checklist, history] = await Promise.all([
    readProjectFile('README.md'),
    readProjectFile('CHANGELOG.md'),
    readProjectFile('docs/DATA_SOURCES.md'),
    readProjectFile('docs/RELEASE_CHECKLIST.md'),
    readProjectFile('PROJECT_HISTORY.md'),
  ]);

  assert.match(readme, /127\.0\.0\.1:5174/);
  assert.match(readme, /Excel.*(?:暂停|suspend)|(?:暂停|suspend).*Excel/i);
  assert.match(changelog, /cache.*version|version.*cache|缓存.*版本|版本.*缓存/i);
  assert.match(sources, /FlavorDB2/);
  assert.match(sources, /PubChem PUG View/);
  assert.match(checklist, /pnpm audit --prod/);
  assert.match(checklist, /单实例/);
  assert.match(history, /codex\/pubchem-volatile-properties/);
  assert.match(history, /未发布|发布候选/);
});

test('open spectra comparison exposes tolerance, matched peaks, warnings, and exports', async () => {
  const [workbench, comparison, mirror] = await Promise.all([
    readFile(new URL('./components/spectra/OpenSpectraWorkbench.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./components/spectra/SpectrumComparison.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./components/spectra/MirrorSpectrumPlot.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(workbench, /tolerance_mode/);
  assert.match(comparison, /type="number"/);
  assert.match(comparison, /compatibility\?\.warnings/);
  assert.match(comparison, /JSON|CSV/);
  assert.match(mirror, /comparisonMatchSets/);
  assert.match(mirror, /matched/);
  assert.match(mirror, /mirror-spectrum-plot/);
});

test('open spectra expose accessible bounded peak tables in detail and comparison views', async () => {
  const [table, workbench, comparison, styles] = await Promise.all([
    readFile(new URL('./components/spectra/SpectrumPeakTable.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./components/spectra/OpenSpectraWorkbench.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./components/spectra/SpectrumComparison.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./App.css', import.meta.url), 'utf8'),
  ]);
  assert.match(table, /<table/);
  assert.match(table, /tabIndex="0"/);
  assert.match(table, /peak-table-scroll/);
  assert.match(table, /partner_mz/);
  assert.match(workbench, /SpectrumPeakTable/);
  assert.match(comparison, /SpectrumPeakTable/);
  assert.match(styles, /\.peak-table-scroll[\s\S]*overflow:\s*auto/);
  assert.match(styles, /position:\s*sticky/);
});
