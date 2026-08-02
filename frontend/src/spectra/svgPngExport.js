import { normalizePngScale } from './spectrumPresentation.js';

function defaultLoadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to render spectrum SVG'));
    image.src = url;
  });
}

function defaultDownload(url, filename) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Unable to create PNG blob')), 'image/png'));
}

export async function exportSvgElementAsPng(svgElement, options = {}) {
  if (!svgElement?.getAttribute) throw new Error('SVG element is required');
  const viewBox = String(svgElement.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  const width = viewBox[2];
  const height = viewBox[3];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('SVG dimensions must be positive');

  const scale = normalizePngScale(options.scale ?? 2);
  const serialize = options.serialize || (node => new XMLSerializer().serializeToString(node));
  const createCanvas = options.createCanvas || (() => document.createElement('canvas'));
  const createObjectURL = options.createObjectURL || (blob => URL.createObjectURL(blob));
  const revokeObjectURL = options.revokeObjectURL || (url => URL.revokeObjectURL(url));
  const loadImage = options.loadImage || defaultLoadImage;
  const download = options.download || defaultDownload;
  const clone = svgElement.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const svgUrl = createObjectURL(new Blob([serialize(clone)], { type: 'image/svg+xml;charset=utf-8' }));
  let pngUrl;
  try {
    const image = await loadImage(svgUrl);
    const canvas = createCanvas();
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    context.fillStyle = options.background || '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await canvasBlob(canvas);
    pngUrl = createObjectURL(blob);
    download(pngUrl, options.filename || 'spectra-mirror.png');
    return { width: canvas.width, height: canvas.height, mimeType: blob.type, filename: options.filename || 'spectra-mirror.png' };
  } finally {
    revokeObjectURL(svgUrl);
    if (pngUrl) revokeObjectURL(pngUrl);
  }
}
