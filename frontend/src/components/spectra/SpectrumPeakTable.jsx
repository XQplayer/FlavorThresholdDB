import { useMemo, useState } from 'react';
import { filterPeakRows, peakRowsToTsv, sortPeakRows } from '../../spectra/spectrumPresentation';

function formatNumber(value, digits = 4) {
  return value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function SpectrumPeakTable({ rows = [], isEnglish, comparison = false }) {
  const [sort, setSort] = useState({ field: 'mz', direction: 'asc' });
  const [query, setQuery] = useState('');
  const [copyState, setCopyState] = useState('');
  const sortedRows = useMemo(() => sortPeakRows(filterPeakRows(rows, query), sort.field, sort.direction), [query, rows, sort]);
  const changeSort = field => setSort(current => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
  const copyRows = async () => {
    try { await navigator.clipboard.writeText(peakRowsToTsv(sortedRows)); setCopyState(isEnglish ? 'Copied' : '已复制'); }
    catch { setCopyState(isEnglish ? 'Copy failed' : '复制失败'); }
  };

  return <div className="peak-table-block">
    <div className="peak-table-toolbar">
      <strong>{isEnglish ? 'Peak table' : '峰表'}</strong>
      <div className="peak-table-tools"><label><span className="sr-only">{isEnglish ? 'Search peaks' : '检索峰'}</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder={isEnglish ? 'm/z or 40-50' : 'm/z 或 40-50'} /></label><button type="button" onClick={() => changeSort('mz')}>m/z</button><button type="button" onClick={() => changeSort('intensity')}>{isEnglish ? 'Intensity' : '强度'}</button><button type="button" disabled={!sortedRows.length} onClick={copyRows}>{isEnglish ? 'Copy' : '复制'}</button>{copyState && <small role="status">{copyState}</small>}</div>
    </div>
    <div className="peak-table-scroll" tabIndex="0" role="region" aria-label={isEnglish ? 'Scrollable spectrum peak table' : '可滚动谱图峰表'}>
      <table>
        <thead><tr>{comparison && <th>{isEnglish ? 'Side' : '谱图'}</th>}<th>m/z</th><th>{isEnglish ? 'Relative intensity' : '相对强度'}</th>{comparison && <><th>{isEnglish ? 'Match' : '匹配'}</th><th>{isEnglish ? 'Partner m/z' : '对应 m/z'}</th><th>Δ Da</th><th>Δ ppm</th></>}</tr></thead>
        <tbody>{sortedRows.length ? sortedRows.map(row => <tr key={`${row.side}-${row.peak_index}`} className={row.matched ? 'matched' : ''}>{comparison && <td>{row.side}</td>}<td>{formatNumber(row.mz)}</td><td>{formatNumber(row.intensity, 2)}</td>{comparison && <><td>{row.matched ? (isEnglish ? 'Matched' : '匹配') : '—'}</td><td>{formatNumber(row.partner_mz)}</td><td>{formatNumber(row.delta_da, 6)}</td><td>{formatNumber(row.delta_ppm, 3)}</td></>}</tr>) : <tr><td colSpan={comparison ? 7 : 2}>{isEnglish ? 'No peaks available.' : '暂无峰数据。'}</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
