import { useEffect, useMemo, useState } from 'react';
import { normalizeStructureEvidence } from '../lib/structureEvidence';

export default function StructureEvidence({ apiUrl, cas, inchikey, compoundName, isEnglish, onStatusChange }) {
  const [payload, setPayload] = useState({ loading: true });
  useEffect(() => {
    if (!cas && !inchikey && !compoundName) return;
    const controller = new AbortController(); const query = new URLSearchParams();
    if (inchikey) query.set('inchikey', inchikey); if (cas) query.set('cas', cas); if (compoundName) query.append('name', compoundName);
    fetch(`${apiUrl}/structures/resolve?${query}`, { signal: controller.signal }).then(async response => ({ ok: response.ok, data: await response.json() })).then(({ ok, data }) => setPayload({ ...data, loading: false, requestFailed: !ok })).catch(error => { if (error.name !== 'AbortError') setPayload({ loading: false, requestFailed: true }); });
    return () => controller.abort();
  }, [apiUrl, cas, inchikey, compoundName]);
  const data = useMemo(() => normalizeStructureEvidence(payload), [payload]);
  useEffect(() => {
    onStatusChange?.(payload.loading ? 'loading' : payload.requestFailed ? 'failed' : 'available');
  }, [onStatusChange, payload.loading, payload.requestFailed]);
  if (!cas && !inchikey && !compoundName) return null;
  return <section className="structure-evidence" aria-label={isEnglish ? 'Protein structure evidence' : '蛋白结构证据'}>
    <header><div><span>RCSB PDB · AlphaFold DB · GPCRdb</span><h4>{isEnglish ? 'Protein structure evidence' : '实验与预测蛋白结构'}</h4></div>{!payload.loading && <b>{data.experimental.length} PDB · {data.predicted.length} AlphaFold · {data.gpcrs.length} GPCR</b>}</header>
    {payload.loading ? <p>{isEnglish ? 'Resolving structures from verified proteins…' : '正在从已核验蛋白解析结构…'}</p> : payload.requestFailed ? <p>{isEnglish ? 'Structure sources are temporarily unavailable.' : '结构来源暂时不可用。'}</p> : <div className="structure-evidence-grid">
      <article><h5>{isEnglish ? 'Experimental structures' : '实验结构'}</h5>{data.experimental.length ? data.experimental.map(row => <a key={row.pdb_id} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>PDB {row.pdb_id}</strong><span>UniProt {row.accession}</span><small>{isEnglish ? 'Experimental archive record' : '实验结构档案'}</small></a>) : <p>{isEnglish ? 'No PDB structure.' : '暂无 PDB 实验结构。'}</p>}</article>
      <article><h5>{isEnglish ? 'Predicted models' : '预测模型'}</h5>{data.predicted.length ? data.predicted.map(row => <a key={row.model_id} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>{row.model_id}</strong><span>UniProt {row.accession}</span><small>global pLDDT {row.global_plddt ?? '—'} · v{row.version ?? '—'}</small></a>) : <p>{isEnglish ? 'No AlphaFold model.' : '暂无 AlphaFold 模型。'}</p>}</article>
      <article><h5>GPCRdb</h5>{data.gpcrs.length ? data.gpcrs.map(row => <a key={row.accession} href={row.source_url} target="_blank" rel="noopener noreferrer"><strong>{(row.name || row.entry_name || '').replace(/<[^>]+>/g, '')}</strong><span>{row.species} · {row.accession}</span></a>) : <p>{isEnglish ? 'No exact GPCR accession.' : '暂无精确 GPCR accession。'}</p>}</article>
    </div>}
    <footer>{isEnglish ? 'PDB entries are experimental archive records. AlphaFold entries are predictions and are not experimental ligand–protein complexes.' : 'PDB 为实验结构档案；AlphaFold 为预测模型，不作为实验性配体—蛋白复合物证据。'}</footer>
  </section>;
}
