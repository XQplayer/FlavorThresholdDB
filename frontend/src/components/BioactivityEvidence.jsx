import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBioactivity } from '../lib/bioactivity';

const SOURCE_META = [
  ['pubchem', 'PubChem BioAssay'], ['chembl', 'ChEMBL'], ['gtopdb', 'GtoPdb'], ['bindingdb', 'BindingDB'],
];

export default function BioactivityEvidence({ apiUrl, cid, inchikey, smiles, isEnglish, onStatusChange }) {
  const [payload, setPayload] = useState({ loading: true });
  const [retryNonce, setRetryNonce] = useState(0);
  const generationRef = useRef(0);
  const requestKeyRef = useRef(null);
  const requestKey = JSON.stringify([cid || null, inchikey || null, smiles || null]);
  const canRequest = Boolean(cid || inchikey || smiles);
  const [active, setActive] = useState('pubchem');
  useEffect(() => {
    if (!canRequest) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const controller = new AbortController();
    const sameIdentity = requestKeyRef.current === requestKey;
    requestKeyRef.current = requestKey;
    setPayload(previous => sameIdentity ? { ...previous, loading: true } : { loading: true });
    const query = new URLSearchParams();
    if (cid) query.set('cid', cid);
    if (inchikey) query.set('inchikey', inchikey);
    if (smiles) query.set('smiles', smiles);
    fetch(`${apiUrl}/bioactivity/resolve?${query}`, { signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => { if (generationRef.current === generation) setPayload(previous => ({ ...previous, ...data, loading: false, requestFailed: !ok })); })
      .catch(error => { if (error.name !== 'AbortError' && generationRef.current === generation) setPayload(previous => ({ ...previous, loading: false, requestFailed: true })); });
    return () => controller.abort();
  }, [apiUrl, canRequest, cid, inchikey, requestKey, retryNonce, smiles]);
  const data = useMemo(() => normalizeBioactivity(payload), [payload]);
  const hasData = Object.values(data).some(value => Array.isArray(value) && value.length > 0);
  const sourceStatuses = useMemo(() => Object.values(payload.sources || {}).map(source => typeof source === 'string' ? source : source?.status).filter(Boolean), [payload.sources]);
  const hasSourceFailure = payload.requestFailed || sourceStatuses.some(status => ['failed', 'partial_failure', 'upstream_unavailable', 'error'].includes(status));
  const allNoData = sourceStatuses.length > 0 && sourceStatuses.every(status => ['no_data', 'not_requested'].includes(status));
  useEffect(() => {
    const available = hasData || sourceStatuses.some(status => ['ok', 'ready', 'available'].includes(status));
    onStatusChange?.(!canRequest ? 'no_data' : payload.loading ? 'loading' : hasSourceFailure && available ? 'partial' : hasSourceFailure ? 'failed' : allNoData || !available ? 'no_data' : 'available');
  }, [allNoData, canRequest, hasData, hasSourceFailure, onStatusChange, payload.loading, sourceStatuses]);
  const rows = data[active] || [];
  if (!cid && !inchikey && !smiles) return null;
  return <section className="bioactivity-evidence" aria-label={isEnglish ? 'Bioactivity evidence' : '生物活性证据'}>
    <header><div><span>PubChem · ChEMBL · GtoPdb · BindingDB</span><h4>{isEnglish ? 'Bioactivity and target evidence' : '生物活性与靶点证据'}</h4></div></header>
    {payload.loading && !hasData ? <p>{isEnglish ? 'Loading exact-identity activity records…' : '正在查询精确身份活性记录…'}</p> : payload.requestFailed && !hasData ? <p>{isEnglish ? 'Activity sources are temporarily unavailable.' : '活性来源暂时不可用。'} <button type="button" onClick={() => { setPayload(previous => ({ ...previous, loading: true })); setRetryNonce(value => value + 1); }}>{isEnglish ? 'Retry activity sources' : '重试活性来源'}</button></p> : <>
      <div className="bioactivity-tabs" role="tablist">{SOURCE_META.map(([key, label]) => {
        const total = data.sources[label]?.total ?? data[key].length;
        return <button key={key} type="button" role="tab" aria-selected={active === key} onClick={() => setActive(key)}><strong>{label}</strong><span>{total}</span></button>;
      })}</div>
      <div className="bioactivity-records" role="tabpanel">
        {!rows.length ? <p>{isEnglish ? 'No exact-identity record from this source.' : '该来源暂无精确身份记录。'}</p> : rows.map((row, index) => {
          const id = row.aid || row.activity_id || row.interaction_id || index;
          const target = row.target_name || row.target_accession || row.target_id || row.assay_name || (isEnglish ? 'Assay record' : '实验记录');
          const measure = [row.type || row.activity_name || row.outcome || row.action, row.relation, row.value || row.activity_value_um || row.affinity, row.units || (row.activity_value_um ? 'µM' : ''), row.affinity_parameter].filter(Boolean).join(' ');
          return <a key={`${active}-${id}-${index}`} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>{target}</strong><span>{measure || (isEnglish ? 'View source evidence' : '查看来源证据')}</span><small>{row.aid ? `AID ${row.aid}` : row.activity_id ? `Activity ${row.activity_id}` : row.interaction_id ? `Interaction ${row.interaction_id}` : ''}{row.organism || row.species ? ` · ${row.organism || row.species}` : ''}</small></a>;
        })}
      </div>
      <div className="bioactivity-source-note">
        {active === 'bindingdb' && (isEnglish ? 'BindingDB is queried at structure similarity 1.0 only.' : 'BindingDB 仅采用结构相似度 1.0 的精确检索。')}
        {active === 'gtopdb' && (isEnglish ? 'GtoPdb uses an exact ligand identifier before requesting interactions.' : 'GtoPdb 先核验精确配体标识，再查询相互作用。')}
      </div>
    </>}
    {hasSourceFailure && (!payload.requestFailed || hasData) && <button type="button" onClick={() => setRetryNonce(value => value + 1)}>{isEnglish ? 'Retry the bioactivity endpoint for failed sources' : '重试活性聚合端点中失败的来源'}</button>}
    <footer>{isEnglish ? 'Database activity is assay-specific evidence, not proof of physiological effect, aroma perception, or causality.' : '数据库活性是特定实验条件下的证据，不等同于生理效应、香气感知或因果关系。'}</footer>
  </section>;
}
