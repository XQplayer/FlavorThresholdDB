import { useEffect, useMemo, useState } from 'react';
import { assignComparisonSlot, isSpectrumDownloadAllowed, spectrumDetailPath } from '../../spectra/spectrumContract';
import SpectrumComparison from './SpectrumComparison';
import SpectrumPeakTable from './SpectrumPeakTable';
import { buildSinglePeakRows } from '../../spectra/spectrumPresentation';

function SpectrumPlot({ record, mirror = false, matched = new Set() }) {
  const peaks = record?.peaks || [];
  const maxMz = Math.max(1, ...peaks.map(peak => Number(peak[0]) || 0));
  return (
    <svg className={`spectrum-stick-plot${mirror ? ' mirror' : ''}`} viewBox="0 0 720 190" role="img" aria-label={`${record?.spectrum_id || 'Spectrum'} peak plot`}>
      <line x1="38" y1={mirror ? 12 : 174} x2="710" y2={mirror ? 12 : 174} className="spectrum-axis" />
      {peaks.map(([mz, intensity], index) => {
        const x = 38 + (Number(mz) / maxMz) * 665;
        const height = Math.max(1, (Number(intensity) / 100) * 150);
        const y1 = mirror ? 12 : 174;
        const y2 = mirror ? 12 + height : 174 - height;
        return <line key={`${mz}-${index}`} x1={x} y1={y1} x2={x} y2={y2} className={matched.has(index) ? 'spectrum-peak matched' : 'spectrum-peak'} />;
      })}
      <text x="38" y={mirror ? 186 : 188}>0</text><text x="670" y={mirror ? 186 : 188}>m/z</text>
    </svg>
  );
}

export default function OpenSpectraWorkbench({ apiUrl, cas, inchikey, smiles, compoundName, isEnglish }) {
  const [search, setSearch] = useState({ loading: true, records: [], summary: {}, sources: {} });
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState({});
  const [filter, setFilter] = useState('all');
  const [slots, setSlots] = useState({ a: null, b: null });
  const [comparison, setComparison] = useState(null);
  const [tolerance, setTolerance] = useState(0.1);
  const [toleranceMode, setToleranceMode] = useState('da');

  useEffect(() => {
    if (!inchikey && !cas && !compoundName) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (inchikey) query.set('inchikey', inchikey);
    if (cas) query.set('cas', cas);
    if (smiles) query.set('smiles', smiles);
    if (compoundName) query.append('name', compoundName);
    fetch(`${apiUrl}/spectra/search?${query}`, { signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
      .then(data => setSearch({ ...data, loading: false }))
      .catch(error => {
        if (error.name !== 'AbortError') setSearch({ loading: false, records: [], summary: {}, sources: {}, error: error.message });
      });
    return () => controller.abort();
  }, [apiUrl, cas, compoundName, inchikey, smiles]);

  const visibleRecords = useMemo(() => (search.records || []).filter(record => {
    if (filter === 'all') return true;
    if (filter === 'ei' || filter === 'ms2') return String(record.spectrum_type).toLowerCase() === filter;
    return String(record.source).toLowerCase() === filter;
  }), [filter, search.records]);

  async function loadDetail(record) {
    const key = `${record.source}:${record.spectrum_id}`;
    if (details[key]) return details[key];
    const response = await fetch(`${apiUrl}${spectrumDetailPath(record.source, record.spectrum_id)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const detail = await response.json();
    setDetails(previous => ({ ...previous, [key]: detail }));
    return detail;
  }

  async function openRecord(record) {
    setSelected({ ...record, loading: true });
    try { setSelected(await loadDetail(record)); }
    catch (error) { setSelected({ ...record, loading: false, error: error.message }); }
  }

  async function addToComparison(record) {
    const detail = await loadDetail(record);
    setComparison(null);
    setSlots(current => assignComparisonSlot(current, detail));
  }

  useEffect(() => {
    if (!slots.a || !slots.b) return;
    fetch(`${apiUrl}/spectra/compare`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a_source: slots.a.source, a_id: slots.a.spectrum_id, b_source: slots.b.source, b_id: slots.b.spectrum_id, tolerance: Number(tolerance), tolerance_mode: toleranceMode }),
    }).then(response => response.json()).then(setComparison).catch(error => setComparison({ error: error.message }));
  }, [apiUrl, slots, tolerance, toleranceMode]);

  if (!inchikey && !cas) return null;
  return (
    <section className="open-spectra-workbench" aria-label={isEnglish ? 'Open spectra' : '开放光谱'}>
      <header className="open-spectra-header">
        <div><span>{isEnglish ? 'PUBLIC SPECTRAL LAYER' : '公共谱库层'}</span><h4>{isEnglish ? 'Open spectra' : '开放光谱'}</h4></div>
        <p>{search.loading ? (isEnglish ? 'Searching…' : '检索中…') : `${search.summary?.total || 0} ${isEnglish ? 'spectra' : '条谱图'}`}</p>
      </header>
      <div className="spectra-source-summary">
        <strong>MassBank {search.summary?.massbank || 0}</strong><strong>GNPS {search.summary?.gnps || 0}</strong>
        <span>EI {search.summary?.ei || 0}</span><span>MS/MS {search.summary?.ms2 || 0}</span>
      </div>
      <div className="spectra-filter-row" role="group" aria-label={isEnglish ? 'Spectrum filters' : '谱图筛选'}>
        {[['all', isEnglish ? 'All' : '全部'], ['ei', 'EI'], ['ms2', 'MS/MS'], ['massbank', 'MassBank'], ['gnps', 'GNPS']].map(([key, label]) => (
          <button type="button" key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>
      {search.error && <p className="spectra-message error">{search.error}</p>}
      {!search.loading && !search.error && visibleRecords.length === 0 && <p className="spectra-message">{isEnglish ? 'No exact public spectrum found.' : '当前公共谱库暂无精确匹配谱图。'}</p>}
      {visibleRecords.length > 0 && <div className="spectra-workspace-grid">
        <div className="spectrum-record-list">
          {visibleRecords.map(record => <article key={`${record.source}-${record.spectrum_id}`}>
            <button type="button" className="spectrum-record-main" onClick={() => openRecord(record)}>
              <strong>{record.source} · {record.spectrum_id}</strong>
              <span>{record.spectrum_type} · {record.ion_mode} {record.adduct || ''}</span>
              <small>{record.instrument || (isEnglish ? 'Instrument not reported' : '仪器未报告')}</small>
            </button>
            <button type="button" className="spectrum-compare-add" onClick={() => addToComparison(record)}>{isEnglish ? 'Compare' : '加入比较'}</button>
          </article>)}
        </div>
        <div className="spectrum-detail-panel">
          {selected ? <>
            <div className="spectrum-detail-title"><strong>{selected.source} · {selected.spectrum_id}</strong><span>{selected.peaks?.length || 0} peaks</span></div>
            {selected.loading ? <p>{isEnglish ? 'Loading peaks…' : '正在加载峰表…'}</p> : <SpectrumPlot record={selected} />}
            {!selected.loading && <SpectrumPeakTable rows={buildSinglePeakRows(selected)} isEnglish={isEnglish} />}
            <dl className="spectrum-meta-grid"><div><dt>{isEnglish ? 'Mode' : '模式'}</dt><dd>{selected.spectrum_type} · {selected.ion_mode}</dd></div><div><dt>{isEnglish ? 'Instrument' : '仪器'}</dt><dd>{selected.instrument || '-'}</dd></div><div><dt>{isEnglish ? 'Adduct' : '加合离子'}</dt><dd>{selected.adduct || '-'}</dd></div><div><dt>{isEnglish ? 'License' : '许可'}</dt><dd>{selected.license || '-'}</dd></div></dl>
            <div className="spectrum-actions"><a href={selected.source_url} target="_blank" rel="noreferrer">{isEnglish ? 'Original record' : '原始记录'}</a>{isSpectrumDownloadAllowed(selected) ? ['json', 'csv', 'msp', 'mgf'].map(format => <a key={format} href={`${apiUrl}${spectrumDetailPath(selected.source, selected.spectrum_id)}/download?format=${format}`}>{format.toUpperCase()}</a>) : <span>{isEnglish ? 'Download disabled pending license review' : '许可待核对，暂不提供代理下载'}</span>}</div>
          </> : <p>{isEnglish ? 'Select a spectrum to inspect its peaks.' : '选择谱图查看峰表与实验条件。'}</p>}
        </div>
      </div>}
      {(slots.a || slots.b) && <SpectrumComparison slots={slots} comparison={comparison} tolerance={tolerance} toleranceMode={toleranceMode} onToleranceChange={value => setTolerance(Math.max(0, Number(value) || 0))} onToleranceModeChange={setToleranceMode} onClear={() => { setSlots({ a: null, b: null }); setComparison(null); }} isEnglish={isEnglish} />}
    </section>
  );
}
