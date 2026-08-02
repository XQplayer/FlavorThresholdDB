import { useMemo, useState } from 'react';
import { ExternalLink, Leaf, LoaderCircle, Search, X } from 'lucide-react';
import { buildFlavorDB2Url, formatTaxonomy } from '../flavordb2';

export default function FlavorDB2Sources({ apiUrl, entities = [], isEnglish }) {
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const visibleEntities = useMemo(() => {
    const merged = [...searchResults, ...entities];
    const seen = new Set();
    return merged.filter(entity => entity?.id && !seen.has(entity.id) && seen.add(entity.id));
  }, [entities, searchResults]);

  const loadEntity = async entity => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(buildFlavorDB2Url(apiUrl, 'entity', { id: entity.id }));
      if (!response.ok) throw new Error(`FlavorDB2 entity lookup failed (${response.status})`);
      setSelectedEntity(await response.json());
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  const searchEntities = async event => {
    event.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(buildFlavorDB2Url(apiUrl, 'entities', { q: normalizedQuery }));
      if (!response.ok) throw new Error(`FlavorDB2 ingredient search failed (${response.status})`);
      const payload = await response.json();
      setSearchResults(payload.entities || []);
      if (payload.entities?.length === 1) await loadEntity(payload.entities[0]);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flavordb2-sources" aria-labelledby="flavordb2-sources-title">
      <div className="flavordb2-sources-heading">
        <div>
          <span className="flavordb2-kicker"><Leaf aria-hidden="true" /> FlavorDB2</span>
          <h4 id="flavordb2-sources-title">{isEnglish ? 'Natural food sources' : '天然食材来源'}</h4>
          <p>
            {isEnglish
              ? `${entities.length} food entities reported to contain this compound.`
              : `FlavorDB2 报告有 ${entities.length} 个食材实体包含该化合物。`}
          </p>
        </div>
        <a href="https://cosylab.iiitd.edu.in/flavordb2/" target="_blank" rel="noreferrer">
          {isEnglish ? 'Open source' : '访问原站'} <ExternalLink aria-hidden="true" />
        </a>
      </div>

      <form className="flavordb2-search" onSubmit={searchEntities}>
        <Search aria-hidden="true" />
        <input
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={isEnglish ? 'Search food entities, e.g. vanilla' : '检索食材实体，例如 vanilla'}
          aria-label={isEnglish ? 'Search FlavorDB2 food entities' : '检索 FlavorDB2 食材实体'}
        />
        <button type="submit" disabled={loading || !query.trim()}>{isEnglish ? 'Search' : '检索食材'}</button>
      </form>

      {visibleEntities.length > 0 && (
        <div className="flavordb2-entity-list" aria-label={isEnglish ? 'Food entities' : '食材实体'}>
          {visibleEntities.map(entity => (
            <button
              type="button"
              key={entity.id}
              className={selectedEntity?.id === entity.id ? 'active' : ''}
              onClick={() => loadEntity(entity)}
            >
              <strong>{entity.name}</strong>
              {entity.natural_source?.name && <small>{entity.natural_source.name}</small>}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="flavordb2-status"><LoaderCircle className="spin" /> {isEnglish ? 'Loading FlavorDB2…' : '正在读取 FlavorDB2…'}</p>}
      {error && <p className="flavordb2-status error">{error}</p>}

      {selectedEntity?.found && (
        <article className="flavordb2-entity-detail">
          <header>
            <div>
              <span>{selectedEntity.category || (isEnglish ? 'Food entity' : '食材实体')}</span>
              <h5>{selectedEntity.name}</h5>
            </div>
            <button type="button" onClick={() => setSelectedEntity(null)} aria-label={isEnglish ? 'Close entity details' : '关闭食材详情'}><X /></button>
          </header>
          <dl>
            <div><dt>{isEnglish ? 'Natural source' : '天然来源'}</dt><dd>{selectedEntity.natural_source?.name || '-'}</dd></div>
            <div><dt>{isEnglish ? 'Taxonomy' : '分类信息'}</dt><dd>{formatTaxonomy(selectedEntity.natural_source?.taxonomy) || '-'}</dd></div>
            {selectedEntity.synonyms?.length > 0 && <div><dt>{isEnglish ? 'Synonyms' : '别名'}</dt><dd>{selectedEntity.synonyms.join('、')}</dd></div>}
          </dl>
          <div className="flavordb2-compounds-heading">
            <strong>{isEnglish ? 'Food–compound relationships' : '食材—化合物关系'}</strong>
            <span>{selectedEntity.compounds?.length || 0} {isEnglish ? 'compounds' : '种化合物'}</span>
          </div>
          <div className="flavordb2-compound-list">
            {(selectedEntity.compounds || []).map(compound => (
              <a key={compound.cid} href={compound.url} target="_blank" rel="noreferrer">
                <span><strong>{compound.name}</strong><small>PubChem CID {compound.cid}</small></span>
                {compound.flavor_profile?.length > 0 && <em>{compound.flavor_profile.slice(0, 4).join(' · ')}</em>}
              </a>
            ))}
          </div>
          <footer>
            <a href={selectedEntity.url} target="_blank" rel="noreferrer">
              {isEnglish ? 'Verify on FlavorDB2' : '在 FlavorDB2 核验原始实体'} <ExternalLink aria-hidden="true" />
            </a>
          </footer>
        </article>
      )}
    </section>
  );
}
