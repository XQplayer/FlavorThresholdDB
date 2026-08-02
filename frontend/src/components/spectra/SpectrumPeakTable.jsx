import { useMemo, useState } from 'react';
import { sortPeakRows } from '../../spectra/spectrumPresentation';

function formatNumber(value, digits = 4) {
  return value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function SpectrumPeakTable({ rows = [], isEnglish, comparison = false }) {
  const [sort, setSort] = useState({ field: 'mz', direction: 'asc' });
  const sortedRows = useMemo(() => sortPeakRows(rows, sort.field, sort.direction), [rows, sort]);
  const changeSort = field => setSort(current => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));

  return <div className="peak-table-block">
    <div className="peak-table-toolbar">
      <strong>{isEnglish ? 'Peak table' : '峰表'}</strong>
      <div><button type="button" onClick={() => changeSort('mz')}>m/z</button><button type="button" onClick={() => changeSort('intensity')}>{isEnglish ? 'Intensity' : '强度'}</button></div>
    </div>
    <div className="peak-table-scroll" tabIndex="0" role="region" aria-label={isEnglish ? 'Scrollable spectrum peak table' : '可滚动谱图峰表'}>
      <table>
        <thead><tr>{comparison && <th>{isEnglish ? 'Side' : '谱图'}</th>}<th>m/z</th><th>{isEnglish ? 'Relative intensity' : '相对强度'}</th>{comparison && <><th>{isEnglish ? 'Match' : '匹配'}</th><th>{isEnglish ? 'Partner m/z' : '对应 m/z'}</th><th>Δ Da</th><th>Δ ppm</th></>}</tr></thead>
        <tbody>{sortedRows.length ? sortedRows.map(row => <tr key={`${row.side}-${row.peak_index}`} className={row.matched ? 'matched' : ''}>{comparison && <td>{row.side}</td>}<td>{formatNumber(row.mz)}</td><td>{formatNumber(row.intensity, 2)}</td>{comparison && <><td>{row.matched ? (isEnglish ? 'Matched' : '匹配') : '—'}</td><td>{formatNumber(row.partner_mz)}</td><td>{formatNumber(row.delta_da, 6)}</td><td>{formatNumber(row.delta_ppm, 3)}</td></>}</tr>) : <tr><td colSpan={comparison ? 7 : 2}>{isEnglish ? 'No peaks available.' : '暂无峰数据。'}</td></tr>}</tbody>
      </table>
    </div>
  </div>;
}
