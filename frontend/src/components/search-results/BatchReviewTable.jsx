import { useEffect, useMemo, useRef, useState } from 'react';
import { sortBatchRows } from '../../searchWorkbenchModel';

const PAGE_SIZE = 25;

const STATUS_OPTIONS = [
  { value: 'all', zh: '全部', en: 'All' },
  { value: 'exact', zh: '精确', en: 'Exact' },
  { value: 'candidate', zh: '候选', en: 'Candidate' },
  { value: 'conflict', zh: '冲突', en: 'Conflict' },
  { value: 'unmatched', zh: '未匹配', en: 'Unmatched' },
];

const COVERAGE_OPTIONS = [
  { value: 'all', zh: '全部覆盖', en: 'All coverage' },
  { value: 'withData', zh: '有数据', en: 'With data' },
  { value: 'withoutData', zh: '无数据', en: 'Without data' },
];

const SORT_OPTIONS = [
  { value: 'inputOrder', zh: '输入顺序', en: 'Input order' },
  { value: 'reviewPriority', zh: '审查优先', en: 'Review priority' },
  { value: 'coverage', zh: '数据覆盖', en: 'Coverage' },
];

const STATUS_LABELS = {
  exact: { zh: '精确', en: 'Exact' },
  candidate: { zh: '候选', en: 'Candidate' },
  conflict: { zh: '冲突', en: 'Conflict' },
  unmatched: { zh: '未匹配', en: 'Unmatched' },
};

const ISSUE_LABELS = {
  no_match: { zh: '未找到匹配', en: 'No match found' },
  name_match_not_cas: { zh: '仅名称匹配', en: 'Name match only' },
  ambiguous_identity: { zh: '多个实体候选', en: 'Multiple entity candidates' },
};

const labelFor = (entry, isEnglish) => entry?.[isEnglish ? 'en' : 'zh'] ?? '';

function findUniqueCandidate(row, candidates) {
  if (!row?.candidateEntityKey) return null;
  const matches = candidates.filter(candidate => (
    candidate.entityKey === row.candidateEntityKey
    || (row.cas && candidate.cas === row.cas)
  ));
  return matches.length === 1 ? matches[0] : null;
}

const rowHasCoverage = row => (
  (row.chapterCoverageCount ?? 0) > 0
  || row.media.length > 0
  || row.thresholdRecordCount > 0
);

export default function BatchReviewTable({
  rawInputs = [],
  rows = [],
  candidates = [],
  state,
  onStateChange,
  onOpen,
  isEnglish = false,
}) {
  const [conflictSelections, setConflictSelections] = useState({});
  const pendingConflictFocusRef = useRef(null);
  useEffect(() => {
    const rowId = pendingConflictFocusRef.current;
    if (!rowId) return;
    pendingConflictFocusRef.current = null;
    requestAnimationFrame(() => document.querySelector(`[data-row-id="${CSS.escape(rowId)}"] .batch-review__open`)?.focus());
  }, [conflictSelections]);
  const updateState = partial => onStateChange({ ...state, ...partial });
  const filteredRows = useMemo(() => rows.filter((row) => {
    if (state.status !== 'all' && row.status !== state.status) return false;
    if (state.coverageFilter === 'withData') return rowHasCoverage(row);
    if (state.coverageFilter === 'withoutData') return !rowHasCoverage(row);
    return true;
  }), [rows, state.status, state.coverageFilter]);
  const sortedRows = useMemo(() => sortBatchRows(filteredRows, {
    key: state.sortKey,
    direction: state.sortDirection,
  }), [filteredRows, state.sortKey, state.sortDirection]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(state.page, 1), pageCount);
  const visibleRows = sortedRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section className="batch-review" role="region" aria-label={isEnglish ? 'Batch review results' : '批量审查结果'}>
      <header className="batch-review__header">
        <div>
          <span className="search-results-workbench__eyebrow">{isEnglish ? 'Batch review' : '批量审查'}</span>
          <h2 id="batch-review-heading" tabIndex="-1">{isEnglish ? 'Review compounds one row at a time' : '逐行审查化合物匹配'}</h2>
          <p>
            {isEnglish
              ? `${rawInputs.length} non-empty input rows. Blank lines are ignored.`
              : `共 ${rawInputs.length} 条非空输入；空行已忽略。`}
          </p>
        </div>
      </header>

      <div className="batch-review__toolbar">
        <div className="batch-review__status-filters" role="group" aria-label={isEnglish ? 'Match status filter' : '匹配状态筛选'}>
          {STATUS_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={state.status === option.value}
              onClick={() => updateState({ status: option.value, page: 1 })}
            >
              {labelFor(option, isEnglish)}
            </button>
          ))}
        </div>
        <div className="batch-review__coverage-filters" role="group" aria-label={isEnglish ? 'Coverage filter' : '覆盖程度'}>
          {COVERAGE_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={state.coverageFilter === option.value}
              onClick={() => updateState({ coverageFilter: option.value, page: 1 })}
            >
              {labelFor(option, isEnglish)}
            </button>
          ))}
        </div>
        <div className="batch-review__sort-controls">
          <label>
            <span>{isEnglish ? 'Sort' : '排序方式'}</span>
            <select
              aria-label={isEnglish ? 'Sort order' : '排序方式'}
              value={state.sortKey}
              onChange={event => updateState({ sortKey: event.target.value, page: 1 })}
            >
              {SORT_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{labelFor(option, isEnglish)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="batch-review__direction"
            aria-label={isEnglish
              ? `Sort direction: ${state.sortDirection === 'asc' ? 'ascending' : 'descending'}`
              : `排序方向：${state.sortDirection === 'asc' ? '升序' : '降序'}`}
            aria-pressed={state.sortDirection === 'desc'}
            onClick={() => updateState({
              sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
              page: 1,
            })}
          >
            {state.sortDirection === 'asc'
              ? (isEnglish ? 'Ascending' : '升序')
              : (isEnglish ? 'Descending' : '降序')}
          </button>
        </div>
      </div>

      {visibleRows.length > 0 ? (
        <div className="batch-review__table-scroll" role="group" aria-label={isEnglish ? 'Scrollable batch results table' : '可横向滚动的批量结果表'} tabIndex="0">
          <table className="batch-review__table">
            <caption className="compound-identity-header__sr-only">
              {isEnglish ? 'Batch compound matching review' : '批量化合物匹配审查'}
            </caption>
            <thead>
              <tr>
                <th scope="col">{isEnglish ? 'Original input' : '原始输入'}</th>
                <th scope="col">{isEnglish ? 'Standard name' : '标准名称'}</th>
                <th scope="col">CAS</th>
                <th scope="col">{isEnglish ? 'Match status' : '匹配状态'}</th>
                <th scope="col">{isEnglish ? 'Data coverage' : '数据覆盖'}</th>
                <th scope="col">{isEnglish ? 'Issues' : '问题'}</th>
                <th scope="col">{isEnglish ? 'Action' : '操作'}</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const conflictCandidates = row.status === 'conflict'
                  ? candidates.filter(candidate => row.candidateEntityKeys?.includes(candidate.entityKey))
                  : [];
                const selectedConflictCandidate = conflictCandidates.find(candidate => (
                  candidate.entityKey === conflictSelections[row.id]
                ));
                const candidate = selectedConflictCandidate || findUniqueCandidate(row, candidates);
                return (
                  <tr key={row.id} data-row-id={row.id} data-status={row.status}>
                    <th scope="row">{row.originalInput}</th>
                    <td>{row.standardName || '—'}</td>
                    <td>{row.cas || '—'}</td>
                    <td><span className="batch-review__status" data-status={row.status}>{labelFor(STATUS_LABELS[row.status], isEnglish)}</span></td>
                    <td>
                      <span>{isEnglish ? `${row.thresholdRecordCount} threshold records` : `${row.thresholdRecordCount} 条阈值记录`}</span>
                      {row.media.length > 0 && <span>{isEnglish ? `${row.media.length} media` : `${row.media.length} 种介质`}：{row.media.join('、')}</span>}
                      {row.chapterCoverageCount > 0 && <span>{isEnglish ? `${row.chapterCoverageCount} covered chapters` : `${row.chapterCoverageCount} 个章节有数据`}</span>}
                    </td>
                    <td>{row.issues.length > 0 ? row.issues.map(issue => labelFor(ISSUE_LABELS[issue], isEnglish)).join(isEnglish ? '; ' : '；') : '—'}</td>
                    <td>
                      {candidate ? (
                        <button
                          type="button"
                          className="batch-review__open"
                          data-batch-action-row-id={row.id}
                          onClick={event => onOpen(row.id, event.currentTarget, candidate)}
                        >
                          {isEnglish ? 'View dossier' : '查看档案'}
                        </button>
                      ) : row.status === 'conflict' ? (
                        <div className="batch-review__candidate-actions" role="group" aria-label={isEnglish ? 'Choose candidate' : '选择候选实体'}>
                          {conflictCandidates.map(option => (
                            <button
                              key={option.entityKey}
                              type="button"
                              className="batch-review__candidate-choice"
                              aria-pressed={conflictSelections[row.id] === option.entityKey}
                              onClick={() => {
                                pendingConflictFocusRef.current = row.id;
                                setConflictSelections(current => ({ ...current, [row.id]: option.entityKey }));
                              }}
                            >
                              {option.englishName || option.chineseName || option.cas} {option.cas ? `(${option.cas})` : ''}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <span className="batch-review__pending-text">{isEnglish ? 'Pending' : '待处理'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="batch-review__empty">
          {isEnglish ? 'No rows match the current filters.' : '当前筛选条件下没有结果。'}
        </p>
      )}

      <nav className="batch-review__pagination" aria-label={isEnglish ? 'Batch result pages' : '批量结果分页'}>
        <button type="button" disabled={currentPage <= 1} onClick={() => updateState({ page: currentPage - 1 })}>
          {isEnglish ? 'Previous' : '上一页'}
        </button>
        <span data-testid="batch-page-label">
          {isEnglish ? `Page ${currentPage} of ${pageCount}` : `第 ${currentPage} 页，共 ${pageCount} 页`}
        </span>
        <button type="button" disabled={currentPage >= pageCount} onClick={() => updateState({ page: currentPage + 1 })}>
          {isEnglish ? 'Next' : '下一页'}
        </button>
      </nav>
    </section>
  );
}
