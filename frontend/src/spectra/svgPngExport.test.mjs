import test from 'node:test';
import assert from 'node:assert/strict';

import { exportSvgElementAsPng } from './svgPngExport.js';

test('SVG export rasterizes at scale with background and cleans object URLs', async () => {
  const calls = [];
  const svg = { getAttribute: name => ({ viewBox: '0 0 720 310' }[name] || null), cloneNode: () => ({ setAttribute() {}, outerHTML: '<svg viewBox="0 0 720 310"></svg>' }) };
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ fillStyle: '', fillRect: (...args) => calls.push(['fillRect', ...args]), drawImage: (...args) => calls.push(['drawImage', ...args]) }),
    toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })),
  };
  const urls = [];
  const result = await exportSvgElementAsPng(svg, {
    filename: 'mirror.png', scale: 2,
    serialize: node => node.outerHTML,
    loadImage: async url => ({ url }),
    createCanvas: () => canvas,
    createObjectURL: blob => { const url = `blob:${blob.type}:${urls.length}`; urls.push(url); return url; },
    revokeObjectURL: url => calls.push(['revoke', url]),
    download: (url, filename) => calls.push(['download', url, filename]),
  });
  assert.deepEqual([canvas.width, canvas.height], [1440, 620]);
  assert.deepEqual(calls[0], ['fillRect', 0, 0, 1440, 620]);
  assert.equal(calls.some(call => call[0] === 'drawImage'), true);
  assert.equal(calls.some(call => call[0] === 'download' && call[2] === 'mirror.png'), true);
  assert.equal(calls.filter(call => call[0] === 'revoke').length, 2);
  assert.equal(result.mimeType, 'image/png');
});

test('SVG export rejects missing and zero-sized plots', async () => {
  await assert.rejects(() => exportSvgElementAsPng(null), /SVG element/);
  await assert.rejects(() => exportSvgElementAsPng({ getAttribute: () => '0 0 0 0' }), /dimensions/);
});
