import { filterSensoryRecords } from '../../../searchWorkbenchModel';
import EvidenceRecordDisclosure from '../EvidenceRecordDisclosure';

const SOURCE_OPTIONS = [
  { value: null, zh: '全部来源', en: 'All sources' },
  { value: 'FEMA', label: 'FEMA' },
  { value: 'FlavorDB', label: 'FlavorDB2' },
];

const KIND_OPTIONS = [
  { value: null, zh: '全部信息类型', en: 'All information types' },
  { value: 'odor', zh: '气味', en: 'Odor' },
  { value: 'taste', zh: '味觉', en: 'Taste' },
  { value: 'natural_source', zh: '天然来源', en: 'Natural source' },
  { value: 'food_entity', zh: '食材实体', en: 'Food entity' },
  { value: 'flavor', zh: '风味描述', en: 'Flavor profile' },
];

const TYPE_LABELS = {
  flavor: { zh: '风味描述', en: 'Flavor profile' },
  odor: { zh: '气味', en: 'Odor' },
  taste: { zh: '味觉', en: 'Taste' },
  natural_source: { zh: '天然来源', en: 'Natural source' },
  food_entity: { zh: '食材实体', en: 'Food entity' },
};

const sourceLabel = source => source === 'FlavorDB' ? 'FlavorDB2' : source;

export default function SensorySourcesChapter({ records = [], filters, onFiltersChange, isEnglish = false }) {
  const currentFilters = filters || { sources: null, kinds: null };
  const activeSource = currentFilters.sources?.[0] ?? null;
  const activeKind = currentFilters.kinds?.[0] ?? null;
  const visibleRecords = filterSensoryRecords(records, currentFilters);
  const grouped = SOURCE_OPTIONS.filter(option => option.value).map(option => ({
    ...option,
    records: visibleRecords.filter(record => record.source === option.value),
  })).filter(group => group.records.length > 0);

  return (
    <div className="sensory-sources-chapter">
      <div className="sensory-filter-rows">
        <div className="chapter-filter-group" role="group" aria-label={isEnglish ? 'Sensory sources' : '感官来源筛选'}>
          <span className="chapter-filter-group__label">{isEnglish ? 'Source' : '来源'}</span>
          <div className="chapter-filter-group__buttons">
            {SOURCE_OPTIONS.map(option => (
              <button
                key={option.value ?? 'all'}
                type="button"
                aria-pressed={activeSource === option.value}
                onClick={() => onFiltersChange?.({ ...currentFilters, sources: option.value == null ? null : [option.value] })}
              >
                {option.label || (isEnglish ? option.en : option.zh)}
              </button>
            ))}
          </div>
        </div>
        <div className="chapter-filter-group" role="group" aria-label={isEnglish ? 'Sensory information types' : '感官信息类型筛选'}>
          <span className="chapter-filter-group__label">{isEnglish ? 'Information' : '信息类型'}</span>
          <div className="chapter-filter-group__buttons">
            {KIND_OPTIONS.map(option => (
              <button
                key={option.value ?? 'all'}
                type="button"
                aria-pressed={activeKind === option.value}
                onClick={() => onFiltersChange?.({ ...currentFilters, kinds: option.value == null ? null : [option.value] })}
              >
                {isEnglish ? option.en : option.zh}
              </button>
            ))}
          </div>
        </div>
      </div>

      {grouped.length > 0 ? (
        <div className="sensory-source-groups">
          {grouped.map(group => (
            <section key={group.value} className="sensory-source-group" data-source={group.value.toLowerCase()}>
              <header>
                <h4>{group.label}</h4>
                <span>{isEnglish ? `${group.records.length} records` : `${group.records.length} 条记录`}</span>
              </header>
              <div className="sensory-record-list">
                {group.records.map((record, index) => {
                  const typeLabel = TYPE_LABELS[record.kind] || TYPE_LABELS.flavor;
                  return (
                    <article className="sensory-record" key={`${record.source}-${record.kind}-${index}`}>
                      <div className="sensory-record__meta">
                        <span>{sourceLabel(record.source)}</span>
                        <span>{isEnglish ? typeLabel.en : typeLabel.zh}</span>
                      </div>
                      <div className="sensory-record__descriptors">
                        {record.descriptors.map((descriptor, descriptorIndex) => (
                          <span key={`${descriptor}-${descriptorIndex}`}>{descriptor}</span>
                        ))}
                      </div>
                      {record.naturalSource && (
                        <p><strong>{isEnglish ? 'Natural source: ' : '天然来源：'}</strong>{record.naturalSource}</p>
                      )}
                      {record.relatedFoodEntity && (
                        <p><strong>{isEnglish ? 'Related food entity: ' : '关联食材实体：'}</strong>{record.relatedFoodEntity}</p>
                      )}
                      <EvidenceRecordDisclosure
                        record={record}
                        isEnglish={isEnglish}
                        summary={isEnglish ? `Raw ${group.label} record` : `${group.label} 原始记录`}
                        renderRecord={() => (
                          <dl>
                            <div><dt>{isEnglish ? 'Source label' : '原始来源标签'}</dt><dd>{record.sourceLabel || sourceLabel(record.source)}</dd></div>
                            <div><dt>{isEnglish ? 'Raw record' : '原始记录'}</dt><dd><pre>{JSON.stringify(record.raw, null, 2)}</pre></dd></div>
                          </dl>
                        )}
                      />
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="chapter-panel__empty">
          {records.length > 0
            ? (isEnglish ? 'No records match the current filters.' : '当前筛选下无记录')
            : (isEnglish ? 'No sensory evidence is available for this match.' : '当前匹配项暂无感官证据。')}
        </p>
      )}
    </div>
  );
}
