import { useEffect, useMemo, useState } from 'react';
import { normalizeBiochemicalGraph } from '../lib/biochemicalRelationships';

export default function BiochemicalRelationships({ apiUrl, cas, inchikey, compoundName, isEnglish }) {
  const [payload, setPayload] = useState({ loading: true });
  useEffect(() => {
    if (!cas && !inchikey && !compoundName) return;
    const controller = new AbortController();
    const query = new URLSearchParams();
    if (inchikey) query.set('inchikey', inchikey);
    if (cas) query.set('cas', cas);
    if (compoundName) query.append('name', compoundName);
    fetch(`${apiUrl}/biochemistry/resolve?${query}`, { signal: controller.signal })
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => setPayload({ ...data, loading: false, requestFailed: !ok }))
      .catch(error => { if (error.name !== 'AbortError') setPayload({ loading: false, requestFailed: true }); });
    return () => controller.abort();
  }, [apiUrl, cas, inchikey, compoundName]);
  const graph = useMemo(() => normalizeBiochemicalGraph(payload), [payload]);
  if (!cas && !inchikey && !compoundName) return null;
  const unavailable = payload.requestFailed || !graph.chebi;
  return <section className="biochemical-relationships" aria-label={isEnglish ? 'Biochemical relationships' : '生化关系证据'}>
    <header>
      <div><span>ChEBI · Rhea · UniProt</span><h4>{isEnglish ? 'Biochemical relationship evidence' : '生化关系证据'}</h4></div>
      {graph.chebi?.source_url && <a href={graph.chebi.source_url} target="_blank" rel="noopener noreferrer">{graph.chebi.chebi_id}</a>}
    </header>
    {payload.loading ? <p>{isEnglish ? 'Resolving stable identifiers…' : '正在解析稳定标识符…'}</p> : unavailable ? <p>{isEnglish ? 'Biochemical sources are temporarily unavailable or returned no matched entity.' : '生化来源暂时不可用，或未返回匹配实体。'}</p> : !graph.verified ? <p>{isEnglish ? 'A name-only ChEBI candidate was found. Automatic reaction expansion is blocked until identity is verified.' : '仅找到名称候选；在化合物身份核验前，不自动扩展反应关系。'}</p> : <div className="biochemical-graph">
      <div className="biochemical-entity"><strong>{graph.chebi.name || graph.chebi.chebi_id}</strong><span>{graph.chebi.formula || ''}</span><small>{isEnglish ? 'Identity evidence' : '身份依据'}：{graph.chebi.identity_match?.type}</small></div>
      <div className="biochemical-reaction-list">
        {graph.reactions.length ? graph.reactions.map(reaction => <details key={reaction.rhea_id}>
          <summary><span>{reaction.rhea_id}</span><strong>{reaction.equation || (isEnglish ? 'Reaction record' : '反应记录')}</strong></summary>
          <div className="biochemical-equation">{reaction.equation}</div>
          <div className="biochemical-proteins">{graph.proteins.filter(protein => protein.rhea_id === reaction.rhea_id).map(protein => <a key={protein.accession} href={protein.source_url} target="_blank" rel="noopener noreferrer"><strong>{protein.protein_name || protein.accession}</strong><span>{protein.organism?.scientific_name || ''} · {protein.accession}</span></a>)}</div>
          {reaction.source_url && <a href={reaction.source_url} target="_blank" rel="noopener noreferrer">{isEnglish ? 'View Rhea record' : '查看 Rhea 原始记录'}</a>}
        </details>) : <p>{isEnglish ? 'No Rhea reaction was returned for this verified ChEBI entity.' : '该已核验 ChEBI 实体暂无 Rhea 反应记录。'}</p>}
      </div>
    </div>}
    <footer>{isEnglish ? 'Identifier-linked evidence only; it does not establish occurrence or causality in food, microbes, or aroma formation.' : '这里只展示标识符关联证据，不据此推断其存在于特定食材、微生物中，也不推断风味形成因果。'}</footer>
  </section>;
}
