import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeBiologicalContext } from '../lib/biologicalContext';

const SOURCE_ORDER = ['NCBI Gene', 'NCBI Taxonomy', 'MetaboLights'];
const STATUS_TEXT = {
  ok: ['可用', 'Available'], no_data: ['无记录', 'No data'], partial_failure: ['部分可用', 'Partial'],
  upstream_unavailable: ['暂时不可用', 'Unavailable'], not_requested: ['未请求', 'Not requested'],
};

export default function BiologicalContext({ apiUrl, cas, inchikey, compoundName, isEnglish, onStatusChange }) {
  const [payload, setPayload] = useState({ loading: true });
  const [retryNonce, setRetryNonce] = useState(0);
  const generationRef = useRef(0);
  useEffect(() => {
    if (!cas && !inchikey && !compoundName) return;
    const generation = generationRef.current + 1; generationRef.current = generation;
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayload(previous => retryNonce ? { ...previous, loading: true } : { loading: true });
    const query = new URLSearchParams();
    if (inchikey) query.set('inchikey', inchikey);
    if (cas) query.set('cas', cas);
    if (compoundName) query.append('name', compoundName);
    fetch(`${apiUrl}/biological-context/resolve?${query}`, { signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => { if (generationRef.current === generation) setPayload(previous => ({ ...previous, ...data, loading: false, requestFailed: !ok })); })
      .catch(error => { if (error.name !== 'AbortError' && generationRef.current === generation) setPayload(previous => ({ ...previous, loading: false, requestFailed: true })); });
    return () => controller.abort();
  }, [apiUrl, cas, inchikey, compoundName, retryNonce]);
  const context = useMemo(() => normalizeBiologicalContext(payload), [payload]);
  const hasData = context.genes.length + context.taxa.length + context.studies.length > 0;
  useEffect(() => {
    const states = Object.values(context.sources || {}).map(source => source?.status);
    const hasFailure = payload.requestFailed || states.some(status => ['partial_failure', 'upstream_unavailable'].includes(status));
    const hasAvailable = states.includes('ok');
    onStatusChange?.(payload.loading ? 'loading' : hasFailure && (hasAvailable || hasData) ? 'partial' : hasFailure ? 'failed' : 'available');
  }, [context.sources, hasData, onStatusChange, payload.loading, payload.requestFailed]);
  if (!cas && !inchikey && !compoundName) return null;
  return <section className="biological-context" aria-label={isEnglish ? 'Biological context' : '生物学上下文'}>
    <header>
      <div><span>NCBI · MetaboLights · BRENDA · HMDB</span><h4>{isEnglish ? 'Biological and study context' : '基因、物种与代谢组研究'}</h4></div>
      {!payload.loading && <div className="biological-context-counts">
        <b>{context.genes.length}</b>{isEnglish ? ' genes' : ' 个基因'} · <b>{context.taxa.length}</b>{isEnglish ? ' taxa' : ' 个物种'} · <b>{context.studies.length}</b>{isEnglish ? ' studies shown' : ' 项研究'}
      </div>}
    </header>
    {payload.loading && !hasData ? <p>{isEnglish ? 'Following verified protein evidence…' : '正在沿已核验蛋白证据链查询…'}</p> : payload.requestFailed && !hasData ? <p>{isEnglish ? 'Biological context is temporarily unavailable.' : '生物学上下文暂时不可用。'} <button type="button" onClick={() => { setPayload(previous => ({ ...previous, loading: true })); setRetryNonce(value => value + 1); }}>{isEnglish ? 'Retry biological context' : '重试生物学上下文'}</button></p> : <>
      <div className="biological-context-sources">{SOURCE_ORDER.map(name => {
        const status = context.sources[name]?.status || 'not_requested';
        return <span key={name} data-status={status}><strong>{name}</strong>{STATUS_TEXT[status]?.[isEnglish ? 1 : 0] || status}</span>;
      })}</div>
      <div className="biological-context-grid">
        <article><h5>{isEnglish ? 'Evidence-linked genes' : '证据关联基因'}</h5>{context.genes.length ? context.genes.map(gene => <a key={gene.gene_id} href={gene.source_url} target="_blank" rel="noopener noreferrer"><strong>{gene.symbol || gene.gene_id}</strong><span>{gene.organism} · GeneID {gene.gene_id}</span><small>UniProt {gene.evidence?.uniprot_accession}</small></a>) : <p>{isEnglish ? 'No supported Gene record.' : '暂无蛋白证据支持的 Gene 记录。'}</p>}</article>
        <article><h5>{isEnglish ? 'Organisms' : '物种分类'}</h5>{context.taxa.length ? context.taxa.map(taxon => <a key={taxon.taxon_id} href={taxon.source_url} target="_blank" rel="noopener noreferrer"><strong>{taxon.scientific_name || `Taxon ${taxon.taxon_id}`}</strong><span>{taxon.rank} · TaxID {taxon.taxon_id}</span></a>) : <p>{isEnglish ? 'No Taxonomy record.' : '暂无 Taxonomy 记录。'}</p>}</article>
        <article><h5>MetaboLights <small>{context.studyHitCount ? `${context.studyHitCount} ${isEnglish ? 'hits' : '项命中'}` : ''}</small></h5>{context.studies.length ? context.studies.map(study => <a key={study.accession} href={study.source_url} target="_blank" rel="noopener noreferrer"><strong>{study.accession}</strong><span>{isEnglish ? 'View public study' : '查看公开研究'}</span></a>) : <p>{isEnglish ? 'No public study match.' : '暂无公开研究命中。'}</p>}</article>
      </div>
      <div className="biological-context-links">
        {context.brenda.map(item => <a key={item.ec_number} href={item.source_url} target="_blank" rel="noopener noreferrer">BRENDA · EC {item.ec_number}</a>)}
        {context.hmdb?.source_url && <a href={context.hmdb.source_url} target="_blank" rel="noopener noreferrer">HMDB · {isEnglish ? 'link-only search' : '仅链接检索'}</a>}
      </div>
    </>}
    {payload.requestFailed && hasData && <button type="button" onClick={() => setRetryNonce(value => value + 1)}>{isEnglish ? 'Retry failed biological sources' : '重试失败的生物学来源'}</button>}
    <footer>{isEnglish ? 'Gene and organism entries are shown only when supported by the ChEBI–Rhea–UniProt chain. HMDB remains link-only under its redistribution terms.' : '基因和物种仅沿 ChEBI–Rhea–UniProt 证据链展示；HMDB 按再分发限制仅提供原站链接。'}</footer>
  </section>;
}
