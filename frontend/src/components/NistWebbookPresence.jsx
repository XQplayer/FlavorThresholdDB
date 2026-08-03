import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeNistSections } from '../lib/nistWebbook';

const LABELS = {
  ei_ms: ['EI 质谱', 'EI mass spectrum'], ir: ['红外光谱', 'IR spectrum'], gc: ['气相色谱', 'Gas chromatography'],
  vapor_pressure: ['蒸气压', 'Vapor pressure'], henry_constant: ['Henry 常数', "Henry's law constant"], thermochemistry: ['热化学', 'Thermochemistry'],
};

export default function NistWebbookPresence({ apiUrl, cas, isEnglish, onStatusChange }) {
  const [state, setState] = useState({ loading: true, sections: [] });
  const [retryNonce, setRetryNonce] = useState(0);
  const generationRef = useRef(0);
  const requestKeyRef = useRef(null);
  useEffect(() => {
    if (!cas) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    // A changed CAS owns a new result set; old sections must never appear under it.
    const requestKey = String(cas); const sameIdentity = requestKeyRef.current === requestKey; requestKeyRef.current = requestKey;
    setState(previous => sameIdentity ? { ...previous, loading: true } : { loading: true, sections: [] });
    fetch(`${apiUrl}/nist-webbook?cas=${encodeURIComponent(cas)}`, { signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => { if (generationRef.current === generation) setState({ ...data, loading: false, requestFailed: !ok }); })
      .catch(error => { if (error.name !== 'AbortError' && generationRef.current === generation) setState(current => ({ ...current, loading: false, status: 'upstream_unavailable', requestFailed: true })); });
    return () => controller.abort();
  }, [apiUrl, cas, retryNonce]);
  const sections = useMemo(() => normalizeNistSections(state.sections), [state.sections]);
  useEffect(() => {
    const failed = state.status === 'upstream_unavailable' || state.requestFailed;
    onStatusChange?.(!cas ? 'no_data' : state.loading ? 'loading' : failed && sections.length ? 'partial' : failed ? 'failed' : sections.length ? 'available' : 'no_data');
  }, [cas, onStatusChange, sections.length, state.loading, state.requestFailed, state.status]);
  if (!cas) return null;
  return <section className="nist-webbook-presence" aria-label="NIST Chemistry WebBook">
    <header><div><span>NIST CHEMISTRY WEBBOOK</span><h4>{isEnglish ? 'Original-site availability' : '原始网站数据可用性'}</h4></div>{state.url && <a href={state.url} target="_blank" rel="noopener noreferrer">{isEnglish ? 'View at NIST' : '前往 NIST 查看'}</a>}</header>
    {state.loading && !sections.length ? <p>{isEnglish ? 'Checking available sections…' : '正在检查可用栏目…'}</p> : sections.length ? <div className="nist-section-links">{sections.map(section => <a key={section.type} href={section.url} target="_blank" rel="noopener noreferrer">{LABELS[section.type]?.[isEnglish ? 1 : 0] || section.label}</a>)}</div> : <p>{state.status === 'upstream_unavailable' || state.requestFailed ? (isEnglish ? 'NIST is temporarily unavailable; other records are unaffected.' : 'NIST 暂时不可用，其他档案不受影响。') : (isEnglish ? 'No supported section was detected on the checked page.' : '本次检查未检测到支持的数据栏目。')}</p>}
    {!state.loading && (state.status === 'upstream_unavailable' || state.requestFailed) && <button type="button" onClick={() => setRetryNonce(value => value + 1)}>{isEnglish ? 'Retry NIST' : '重试 NIST'}</button>}
    <footer>{isEnglish ? 'Links only. Spectra remain at NIST and are not copied or redistributed.' : '仅提供原始链接；光谱保留在 NIST，本站不复制或再分发。'}</footer>
  </section>;
}
