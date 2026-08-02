import { comparisonExportFilename } from '../../spectra/spectrumContract';
import MirrorSpectrumPlot from './MirrorSpectrumPlot';

function downloadText(body, mime, filename) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function comparisonCsv(comparison, spectrumA, spectrumB) {
  const rows = [
    ['spectrum_a', spectrumA.spectrum_id], ['spectrum_b', spectrumB.spectrum_id],
    ['tolerance_value', comparison.tolerance?.value], ['tolerance_mode', comparison.tolerance?.mode],
    ['similarity', comparison.similarity], [],
    ['mz_a', 'mz_b', 'intensity_a', 'intensity_b', 'delta_da', 'delta_ppm'],
    ...(comparison.matches || []).map(match => [match.mz_a, match.mz_b, match.intensity_a, match.intensity_b, match.delta_da, match.delta_ppm]),
  ];
  return rows.map(row => row.map(value => JSON.stringify(value ?? '')).join(',')).join('\n');
}

export default function SpectrumComparison({ slots, comparison, tolerance, toleranceMode, onToleranceChange, onToleranceModeChange, onClear, isEnglish }) {
  const warningLabels = comparison?.compatibility?.warnings || [];
  const blocked = comparison?.compatibility && !comparison.compatibility.comparable;

  function exportComparison(format) {
    if (!slots.a || !slots.b || !comparison) return;
    if (format === 'svg') {
      const svg = document.getElementById('open-spectra-mirror');
      if (svg) downloadText(new XMLSerializer().serializeToString(svg), 'image/svg+xml', comparisonExportFilename(slots.a, slots.b, 'svg'));
      return;
    }
    const body = format === 'json'
      ? JSON.stringify({ comparison, spectra: { a: slots.a, b: slots.b } }, null, 2)
      : comparisonCsv(comparison, slots.a, slots.b);
    downloadText(body, format === 'json' ? 'application/json' : 'text/csv', comparisonExportFilename(slots.a, slots.b, format));
  }

  return <section className="spectrum-comparison-panel">
    <header><h5>{isEnglish ? 'Mirror comparison' : '镜像谱比较'}</h5><button type="button" onClick={onClear}>{isEnglish ? 'Clear' : '清空'}</button></header>
    <div className="comparison-toolbar">
      <label>{isEnglish ? 'Tolerance' : '匹配容差'}<input type="number" min="0" step={toleranceMode === 'ppm' ? '1' : '0.01'} value={tolerance} onChange={event => onToleranceChange(event.target.value)} /></label>
      <select aria-label={isEnglish ? 'Tolerance mode' : '容差单位'} value={toleranceMode} onChange={event => onToleranceModeChange(event.target.value)}><option value="da">Da</option><option value="ppm">ppm</option></select>
      {comparison && <div className="comparison-export-actions"><button type="button" onClick={() => exportComparison('json')}>JSON</button><button type="button" onClick={() => exportComparison('csv')}>CSV</button><button type="button" onClick={() => exportComparison('svg')}>SVG</button></div>}
    </div>
    <div className="comparison-slot-label">A · {slots.a?.source || '—'} · {slots.a?.spectrum_id || (isEnglish ? 'Select spectrum' : '请选择谱图')}</div>
    {slots.a && slots.b && <MirrorSpectrumPlot spectrumA={slots.a} spectrumB={slots.b} comparison={comparison} />}
    <div className="comparison-slot-label">B · {slots.b?.source || '—'} · {slots.b?.spectrum_id || (isEnglish ? 'Select spectrum' : '请选择谱图')}</div>
    {blocked && <p className="comparison-warning">{isEnglish ? 'These experiment types are not directly comparable.' : '实验类型不兼容，仅展示镜像谱，不计算相似度。'}</p>}
    {warningLabels.length > 0 && <p className="comparison-warning">{isEnglish ? 'Experimental differences' : '实验条件差异'}: {warningLabels.join(', ')}</p>}
    {comparison && !comparison.error && <div className="comparison-metrics"><strong>{isEnglish ? 'Cosine' : '余弦相似度'} {comparison.similarity ?? '—'}</strong><span>{isEnglish ? 'Matched peaks' : '共有峰'} {comparison.matched_peak_count}</span><span>A {Math.round((comparison.coverage_a || 0) * 100)}%</span><span>B {Math.round((comparison.coverage_b || 0) * 100)}%</span></div>}
  </section>;
}
