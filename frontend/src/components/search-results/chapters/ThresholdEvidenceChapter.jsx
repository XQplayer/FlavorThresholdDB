import { filterThresholdRecords } from '../../../searchWorkbenchModel';
import EvidenceRecordDisclosure from '../EvidenceRecordDisclosure';

const MEDIA_OPTIONS = [
  { value: null, zh: '全部介质', en: 'All media' },
  { value: 'water', zh: '水', en: 'Water' },
  { value: 'air', zh: '空气', en: 'Air' },
  { value: 'alcohol', zh: '酒类', en: 'Alcoholic media' },
  { value: 'other', zh: '其他', en: 'Other' },
];

const TYPE_OPTIONS = [
  { value: 'all', zh: '全部类型', en: 'All types' },
  { value: 'd', zh: '觉察阈', en: 'Detection threshold' },
  { value: 'r', zh: '识别阈', en: 'Recognition threshold' },
  { value: 'book', zh: '书籍记录', en: 'Book records' },
];

const typeLabel = (record, isEnglish) => {
  const type = record.thresholdType ?? record.type;
  if (type === 'd') return isEnglish ? 'Detection threshold' : '觉察阈';
  if (type === 'r') return isEnglish ? 'Recognition threshold' : '识别阈';
  return type || (isEnglish ? 'Type not stated' : '类型未说明');
};

const recordSummary = (record, isEnglish) => (
  record.originalText
  || [record.value, record.unit].filter(value => value != null).join(' ')
  || (isEnglish ? 'Threshold source record' : '阈值来源记录')
);

const recordSourceSummary = (record, isEnglish) => {
  const source = record.source || (isEnglish ? 'Source not stated' : '来源未说明');
  if (record.sourceKind !== 'book' || record.page == null) return source;
  return isEnglish ? `${source}, page ${record.page}` : `${source} · 第 ${record.page} 页`;
};

export default function ThresholdEvidenceChapter({ records = [], filters, onFiltersChange, isEnglish = false }) {
  const currentFilters = filters || { media: null, types: null, includeBooks: true, bookOnly: false };
  const visibleRecords = filterThresholdRecords(records, currentFilters);
  const activeType = currentFilters.bookOnly ? 'book' : currentFilters.types?.[0] ?? 'all';

  const selectType = (value) => {
    if (value === 'book') {
      onFiltersChange?.({ ...currentFilters, types: null, includeBooks: true, bookOnly: true });
      return;
    }
    onFiltersChange?.({
      ...currentFilters,
      types: value === 'all' ? null : [value],
      includeBooks: true,
      bookOnly: false,
    });
  };

  return (
    <div className="threshold-evidence-chapter">
      <div className="threshold-filter-rows">
        <div className="chapter-filter-group" role="group" aria-label={isEnglish ? 'Threshold media' : '阈值介质筛选'}>
          <span className="chapter-filter-group__label">{isEnglish ? 'Medium' : '介质'}</span>
          <div className="chapter-filter-group__buttons">
            {MEDIA_OPTIONS.map(option => (
              <button
                key={option.value ?? 'all'}
                type="button"
                aria-pressed={currentFilters.media === option.value}
                onClick={() => onFiltersChange?.({ ...currentFilters, media: option.value })}
              >
                {isEnglish ? option.en : option.zh}
              </button>
            ))}
          </div>
        </div>
        <div className="chapter-filter-group" role="group" aria-label={isEnglish ? 'Threshold types' : '阈值类型筛选'}>
          <span className="chapter-filter-group__label">{isEnglish ? 'Type' : '类型'}</span>
          <div className="chapter-filter-group__buttons">
            {TYPE_OPTIONS.map(option => (
              <button
                key={option.value}
                type="button"
                aria-pressed={activeType === option.value}
                onClick={() => selectType(option.value)}
              >
                {isEnglish ? option.en : option.zh}
              </button>
            ))}
          </div>
        </div>
      </div>

      {visibleRecords.length > 0 ? (
        <div className="evidence-record-list">
          {visibleRecords.map(record => (
            <EvidenceRecordDisclosure
              key={record.id}
              record={record}
              isEnglish={isEnglish}
              summary={recordSummary(record, isEnglish)}
              summaryMeta={[
                recordSourceSummary(record, isEnglish),
                record.sourceKind === 'book' ? (isEnglish ? 'Book' : '书籍') : (isEnglish ? 'Local' : '本地'),
                record.medium || (isEnglish ? 'Medium not stated' : '介质未说明'),
                typeLabel(record, isEnglish),
              ]}
              renderRecord={() => (
                <dl>
                  {record.originalText && <div><dt>{isEnglish ? 'Original text' : '原始文本'}</dt><dd>{record.originalText}</dd></div>}
                  <div><dt>{isEnglish ? 'Source' : '来源'}</dt><dd>{record.source || (isEnglish ? 'Not stated' : '未说明')}</dd></div>
                  <div><dt>{isEnglish ? 'Medium' : '介质'}</dt><dd>{record.medium || (isEnglish ? 'Not stated' : '未说明')}</dd></div>
                  <div><dt>{isEnglish ? 'Type' : '类型'}</dt><dd>{typeLabel(record, isEnglish)}</dd></div>
                  {record.value != null && <div><dt>{isEnglish ? 'Structured value' : '结构化数值'}</dt><dd>{record.value}</dd></div>}
                  {record.unit && <div><dt>{isEnglish ? 'Unit' : '单位'}</dt><dd>{record.unit}</dd></div>}
                  {record.page != null && <div><dt>{isEnglish ? 'Book page' : '书籍页码'}</dt><dd>{record.page}</dd></div>}
                  {record.block != null && <div><dt>{isEnglish ? 'Source block' : '来源块'}</dt><dd>{record.block}</dd></div>}
                  {record.sourceRecordKey && <div><dt>{isEnglish ? 'Source key' : '来源键'}</dt><dd>{record.sourceRecordKey}</dd></div>}
                  {record.quality?.associationMethod && <div><dt>{isEnglish ? 'Association method' : '关联方法'}</dt><dd>{record.quality.associationMethod}</dd></div>}
                  {record.quality?.associationConfidence && <div><dt>{isEnglish ? 'Association confidence' : '关联置信度'}</dt><dd>{record.quality.associationConfidence}</dd></div>}
                  {record.quality?.reviewStatus && <div><dt>{isEnglish ? 'Review status' : '审核状态'}</dt><dd>{record.quality.reviewStatus}</dd></div>}
                  {record.quality?.reviewFlags?.length > 0 && <div><dt>{isEnglish ? 'Review flags' : '审核标记'}</dt><dd>{record.quality.reviewFlags.join('、')}</dd></div>}
                </dl>
              )}
            />
          ))}
        </div>
      ) : (
        <p className="chapter-panel__empty">
          {records.length > 0
            ? (isEnglish ? 'No records match the current filters.' : '当前筛选下无记录')
            : (isEnglish ? 'No threshold evidence is available for this match.' : '当前匹配项暂无阈值证据。')}
        </p>
      )}
    </div>
  );
}
