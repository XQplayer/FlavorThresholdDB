import { comparisonMatchSets } from '../../spectra/spectrumContract';

export default function MirrorSpectrumPlot({ spectrumA, spectrumB, comparison }) {
  const peaksA = spectrumA?.peaks || [];
  const peaksB = spectrumB?.peaks || [];
  const maxMz = Math.max(1, ...peaksA.map(peak => Number(peak[0]) || 0), ...peaksB.map(peak => Number(peak[0]) || 0));
  const matched = comparisonMatchSets(comparison);
  const renderPeaks = (peaks, side) => peaks.map(([mz, intensity], index) => {
    const x = 42 + (Number(mz) / maxMz) * 660;
    const height = Math.max(1, (Number(intensity) / 100) * 122);
    const y2 = side === 'a' ? 150 - height : 150 + height;
    return <line key={`${side}-${mz}-${index}`} x1={x} y1="150" x2={x} y2={y2} className={`mirror-peak ${side}${matched[side].has(index) ? ' matched' : ''}`} />;
  });

  return (
    <svg id="open-spectra-mirror" className="mirror-spectrum-plot" viewBox="0 0 720 340" role="img" aria-label="Aligned mirror spectrum comparison">
      <text x="42" y="16" className="mirror-title">A · {spectrumA?.source} · {spectrumA?.spectrum_id}</text>
      <text x="42" y="330" className="mirror-title">B · {spectrumB?.source} · {spectrumB?.spectrum_id}</text>
      <text x="520" y="16" className="mirror-setting">{comparison?.tolerance ? `${comparison.tolerance.value} ${comparison.tolerance.mode}` : ''}</text>
      <line x1="620" y1="28" x2="642" y2="28" className="mirror-peak matched"/><text x="648" y="32">matched</text>
      <line x1="42" y1="150" x2="706" y2="150" className="spectrum-axis" />
      {renderPeaks(peaksA, 'a')}
      {renderPeaks(peaksB, 'b')}
      <text x="10" y="40">A</text><text x="10" y="292">B</text><text x="664" y="316">m/z</text>
    </svg>
  );
}
