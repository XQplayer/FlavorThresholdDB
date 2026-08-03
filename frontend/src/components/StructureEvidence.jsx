import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeStructureEvidence } from '../lib/structureEvidence';

export default function StructureEvidence({ apiUrl, cas, inchikey, compoundName, isEnglish, onStatusChange }) {
  const [payload, setPayload] = useState({ loading: true });
  const [retryNonce, setRetryNonce] = useState(0);
  const generationRef = useRef(0);
  useEffect(() => {
    if (!cas && !inchikey && !compoundName) return;
    const generation = generationRef.current + 1; generationRef.current = generation;
    const controller = new AbortController(); const query = new URLSearchParams();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayload(previous => retryNonce ? { ...previous, loading: true } : { loading: true });
    if (inchikey) query.set('inchikey', inchikey); if (cas) query.set('cas', cas); if (compoundName) query.append('name', compoundName);
    fetch(`${apiUrl}/structures/resolve?${query}`, { signal: controller.signal }).then(async response => ({ ok: response.ok, data: await response.json() })).then(({ ok, data }) => { if (generationRef.current === generation) setPayload(previous => ({ ...previous, ...data, loading: false, requestFailed: !ok })); }).catch(error => { if (error.name !== 'AbortError' && generationRef.current === generation) setPayload(previous => ({ ...previous, loading: false, requestFailed: true })); });
    return () => controller.abort();
  }, [apiUrl, cas, inchikey, compoundName, retryNonce]);
  const data = useMemo(() => normalizeStructureEvidence(payload), [payload]);
  const hasData = data.experimental.length + data.predicted.length + data.gpcrs.length > 0;
  useEffect(() => {
    const statuses = Object.values(payload.sources || {}).map(source => typeof source === 'string' ? source : source?.status);
    const failed = payload.requestFailed || statuses.some(status => ['failed', 'partial_failure', 'upstream_unavailable', 'error'].includes(status));
    onStatusChange?.(payload.loading ? 'loading' : failed && hasData ? 'partial' : failed ? 'failed' : 'available');
  }, [hasData, onStatusChange, payload.loading, payload.requestFailed, payload.sources]);
  if (!cas && !inchikey && !compoundName) return null;
  return <section className="structure-evidence" aria-label={isEnglish ? 'Protein structure evidence' : '蛋白结构证据'}>
    <header><div><span>RCSB PDB · AlphaFold DB · GPCRdb</span><h4>{isEnglish ? 'Protein structure evidence' : '实验与预测蛋白结构'}</h4></div>{!payload.loading && <b>{data.experimental.length} PDB · {data.predicted.length} AlphaFold · {data.gpcrs.length} GPCR</b>}</header>
    {payload.loading && !hasData ? <p>{isEnglish ? 'Resolving structures from verified proteins…' : '正在从已核验蛋白解析结构…'}</p> : payload.requestFailed && !hasData ? <p>{isEnglish ? 'Structure sources are temporarily unavailable.' : '结构来源暂时不可用。'} <button type="button" onClick={() => { setPayload(previous => ({ ...previous, loading: true })); setRetryNonce(value => value + 1); }}>{isEnglish ? 'Retry structure sources' : '重试结构来源'}</button></p> : <div className="structure-evidence-grid">
      <article><h5>{isEnglish ? 'Experimental structures' : '实验结构'}</h5>{data.experimental.length ? data.experimental.map(row => <a key={row.pdb_id} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>PDB {row.pdb_id}</strong><span>UniProt {row.accession}</span><small>{isEnglish ? 'Experimental archive record' : '实验结构档案'}</small></a>) : <p>{isEnglish ? 'No PDB structure.' : '暂无 PDB 实验结构。'}</p>}</article>
      <article><h5>{isEnglish ? 'Predicted models' : '预测模型'}</h5>{data.predicted.length ? data.predicted.map(row => <a key={row.model_id} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>{row.model_id}</strong><span>UniProt {row.accession}</span><small>global pLDDT {row.global_plddt ?? '—'} · v{row.version ?? '—'}</small></a>) : <p>{isEnglish ? 'No AlphaFold model.' : '暂无 AlphaFold 模型。'}</p>}</article>
      <article><h5>GPCRdb</h5>{data.gpcrs.length ? data.gpcrs.map(row => <a key={row.accession} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>{(row.name || row.entry_name || '').replace(/<[^>]+>/g, '')}</strong><span>{row.species} · {row.accession}</span></a>) : <p>{isEnglish ? 'No exact GPCR accession.' : '暂无精确 GPCR accession。'}</p>}</article>
    </div>}
    {payload.requestFailed && hasData && <button type="button" onClick={() => setRetryNonce(value => value + 1)}>{isEnglish ? 'Retry failed structure sources' : '重试失败的结构来源'}</button>}
    <footer>{isEnglish ? 'PDB entries are experimental archive records. AlphaFold entries are predictions and are not experimental ligand–protein complexes.' : 'PDB 为实验结构档案；AlphaFold 为预测模型，不作为实验性配体—蛋白复合物证据。'}</footer>
  </section>;
}
