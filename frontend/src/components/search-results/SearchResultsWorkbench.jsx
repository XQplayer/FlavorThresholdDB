import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CHAPTERS,
  buildScientificComponentProps,
  createDefaultChapterFilters,
  summarizeChapterStatus,
} from '../../searchWorkbenchModel';
import ChapterNavigation from './ChapterNavigation';
import ChapterPanel from './ChapterPanel';
import CompoundIdentityHeader from './CompoundIdentityHeader';
import OverviewChapter from './chapters/OverviewChapter';
import SensorySourcesChapter from './chapters/SensorySourcesChapter';
import ThresholdEvidenceChapter from './chapters/ThresholdEvidenceChapter';
import SpectraChapter from './chapters/SpectraChapter';
import {
  BiochemistryChapter,
  BioactivityChapter,
  ProteinStructuresChapter,
} from './chapters/MechanismChapters';
import CitationExportChapter from './chapters/CitationExportChapter';
import BatchReviewTable from './BatchReviewTable';
import {
  createScientificPreloadState,
  markScientificChapterStarted,
  nextScientificChapterToPreload,
} from '../../scientificChapterPreload';
import './SearchResultsWorkbench.css';

const CHAPTER_SOURCE_KEYS = {
  overview: ['local_thresholds', 'fema', 'pubchem', 'flavordb', 'book'],
  sensory: ['fema', 'flavordb'],
  thresholds: ['local_thresholds', 'book'],
  spectra: [],
  biochemistry: [],
  bioactivity: [],
  structures: [],
  citation: ['book'],
};

const DELEGATED_CHAPTER_IDS = new Set(['spectra', 'biochemistry', 'bioactivity', 'structures']);

const createDefaultBatchState = () => ({
  status: 'all',
  coverageFilter: 'all',
  sortKey: 'inputOrder',
  sortDirection: 'asc',
  page: 1,
  selectedRowId: null,
  scrollY: 0,
});

export default function SearchResultsWorkbench({
  query,
  mode = 'single',
  rawBatchInputs = [],
  batchRows = [],
  loading,
  matchCount = 0,
  candidates = [],
  candidateScopeKey,
  onCandidateSelect,
  onRetrySource,
  apiUrl,
  citationText = '',
  onExportCompact,
  onExportDetailed,
  includeFlavorDescriptions = true,
  exportEnabledSourceKeys = [],
  isEnglish = false,
}) {
  const queryKey = String(query || '').trim().toLowerCase();
  const selectionScopeKey = candidateScopeKey || `${mode}:${queryKey}`;
  const [candidateSelection, setCandidateSelection] = useState({ scopeKey: selectionScopeKey, entityKey: null });
  const [batchState, setBatchState] = useState(createDefaultBatchState);
  const batchBackButtonRef = useRef(null);
  const batchRowAnchorRef = useRef(null);
  const pendingBatchReturnRef = useRef(null);
  const pendingCandidateFocusRef = useRef(false);
  const dossierHeadingRef = useRef(null);
  const batchAnimationFrameIds = useRef(new Set());
  const scheduleBatchAnimationFrame = useCallback((callback) => {
    const id = requestAnimationFrame(() => {
      batchAnimationFrameIds.current.delete(id);
      callback();
    });
    batchAnimationFrameIds.current.add(id);
    return id;
  }, []);
  const selectedBatchRow = mode === 'bulk'
    ? batchRows.find(row => row.id === batchState.selectedRowId)
    : null;
  const linkedBatchCandidates = selectedBatchRow?.candidateEntityKey
    ? candidates.filter(candidate => (
      candidate.entityKey === selectedBatchRow.candidateEntityKey
      || (selectedBatchRow.cas && candidate.cas === selectedBatchRow.cas)
    ))
    : [];
  const selectedCandidate = mode === 'bulk'
    ? (!selectedBatchRow ? null : linkedBatchCandidates.length === 1
      ? linkedBatchCandidates[0]
      : candidateSelection.scopeKey === selectionScopeKey
        ? candidates.find(candidate => candidate.entityKey === candidateSelection.entityKey)
        : null)
    : candidates.length === 1
      ? candidates[0]
      : candidateSelection.scopeKey === selectionScopeKey
        ? candidates.find(candidate => candidate.entityKey === candidateSelection.entityKey)
        : null;
  const dossier = selectedCandidate?.dossier;
  const entityKey = selectedCandidate?.entityKey ?? null;
  const [chapterSelection, setChapterSelection] = useState({ entityKey, id: 'overview' });
  const [scientificStatuses, setScientificStatuses] = useState({ entityKey, values: {} });
  const [scientificPreload, setScientificPreload] = useState(() => createScientificPreloadState(entityKey));
  const scientificStatusHandlers = useMemo(() => Object.fromEntries(
    [...DELEGATED_CHAPTER_IDS].map(id => [id, status => setScientificStatuses(current => ({
      entityKey,
      values: { ...(current.entityKey === entityKey ? current.values : {}), [id]: status },
    }))]),
  ), [entityKey]);
  const [filterSelection, setFilterSelection] = useState({
    entityKey,
    values: createDefaultChapterFilters(),
  });
  const hasQuery = Boolean(query?.trim());
  const hasIdentity = Boolean(entityKey);
  const effectiveScientificPreload = scientificPreload.entityKey === entityKey
    ? scientificPreload
    : createScientificPreloadState(entityKey);
  const activeChapterId = chapterSelection.entityKey === entityKey ? chapterSelection.id : 'overview';
  const defaultChapterFilters = useMemo(() => createDefaultChapterFilters(), []);
  const chapterFilters = filterSelection.entityKey === entityKey
    ? filterSelection.values
    : defaultChapterFilters;
  const chapters = useMemo(() => CHAPTERS.map((chapter) => {
    if (DELEGATED_CHAPTER_IDS.has(chapter.id)) {
      return { ...chapter, count: null, status: scientificStatuses.entityKey === entityKey ? scientificStatuses.values[chapter.id] || 'idle' : 'idle', statusOwner: 'workbench' };
    }
    const count = dossier?.[chapter.id]?.records?.length || 0;
    const sourceStates = (CHAPTER_SOURCE_KEYS[chapter.id] || [])
      .map(key => dossier?.sourceStates?.[key])
      .filter(Boolean);
    return {
      ...chapter,
      count,
      status: summarizeChapterStatus({ recordCount: count, sourceStates }),
      statusOwner: 'workbench',
    };
  }), [dossier, entityKey, scientificStatuses]);

  useEffect(() => {
    // Query ownership is part of the selection; changing it must not revive a stale candidate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateSelection(current => current.scopeKey === selectionScopeKey
      ? current
      : { scopeKey: selectionScopeKey, entityKey: null });
  }, [selectionScopeKey]);

  useEffect(() => {
    if (!pendingCandidateFocusRef.current || mode !== 'single' || !entityKey) return;
    pendingCandidateFocusRef.current = false;
    scheduleBatchAnimationFrame(() => dossierHeadingRef.current?.focus({ preventScroll: true }));
  }, [entityKey, mode, scheduleBatchAnimationFrame]);

  useEffect(() => {
    // Entity-scoped navigation and filters reset together after identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChapterSelection(current => current.entityKey === entityKey
      ? current
      : { entityKey, id: 'overview' });
    setFilterSelection(current => current.entityKey === entityKey
      ? current
      : { entityKey, values: createDefaultChapterFilters() });
    setScientificStatuses(current => current.entityKey === entityKey ? current : { entityKey, values: {} });
    setScientificPreload(current => current.entityKey === entityKey
      ? current
      : createScientificPreloadState(entityKey));
  }, [entityKey]);

  useEffect(() => {
    if (!hasIdentity || loading) return undefined;
    const statuses = scientificStatuses.entityKey === entityKey ? scientificStatuses.values : {};
    const nextChapterId = nextScientificChapterToPreload(effectiveScientificPreload, statuses);
    if (!nextChapterId) return undefined;
    const startChapter = () => setScientificPreload(current => {
      const scoped = current.entityKey === entityKey ? current : createScientificPreloadState(entityKey);
      return markScientificChapterStarted(scoped, nextChapterId);
    });
    if (typeof window.requestIdleCallback === 'function') {
      const idleId = window.requestIdleCallback(startChapter, { timeout: 1200 });
      return () => window.cancelIdleCallback?.(idleId);
    }
    const timeoutId = window.setTimeout(startChapter, 600);
    return () => window.clearTimeout(timeoutId);
  }, [effectiveScientificPreload, entityKey, hasIdentity, loading, scientificStatuses]);

  useEffect(() => {
    if (mode !== 'bulk' || batchState.selectedRowId === null) return;
    scheduleBatchAnimationFrame(() => batchBackButtonRef.current?.focus({ preventScroll: true }));
  }, [batchState.selectedRowId, mode, scheduleBatchAnimationFrame]);

  useEffect(() => {
    if (mode !== 'bulk' || batchState.selectedRowId !== null || pendingBatchReturnRef.current === null) return;
    const pendingReturn = pendingBatchReturnRef.current;
    pendingBatchReturnRef.current = null;
    scheduleBatchAnimationFrame(() => {
      scheduleBatchAnimationFrame(() => {
        const row = [...document.querySelectorAll('[data-row-id]')]
          .find(element => element.dataset.rowId === pendingReturn.rowId);
        if (!row) {
          window.scrollTo(0, pendingReturn.scrollY);
          document.getElementById('batch-review-heading')?.focus({ preventScroll: true });
          return;
        }
        row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        const rowRect = row.getBoundingClientRect();
        const maximumTop = Math.max(16, window.innerHeight - Math.min(rowRect.height, 80) - 16);
        const targetTop = Number.isFinite(pendingReturn.anchorTop)
          ? Math.min(Math.max(pendingReturn.anchorTop, 16), maximumTop)
          : Math.min(rowRect.top, maximumTop);
        window.scrollTo({ top: window.scrollY + rowRect.top - targetTop, behavior: 'instant' });
        row.querySelector('[data-batch-action-row-id]')?.focus({ preventScroll: true });
      });
    });
  }, [batchState.selectedRowId, mode, scheduleBatchAnimationFrame]);

  useEffect(() => () => {
    batchAnimationFrameIds.current.forEach(id => cancelAnimationFrame(id));
    batchAnimationFrameIds.current.clear();
  }, [selectionScopeKey]);

  if (mode === 'bulk' && hasQuery && !loading && !selectedCandidate) {
    return (
      <section className="search-results-workbench search-results-workbench--batch" data-testid="search-results-workbench">
        <BatchReviewTable
          rawInputs={rawBatchInputs}
          rows={batchRows}
          candidates={candidates}
          state={batchState}
          onStateChange={setBatchState}
          onOpen={(rowId, actionElement, chosenCandidate) => {
            const row = batchRows.find(candidateRow => candidateRow.id === rowId);
            const rowCandidates = chosenCandidate ? [chosenCandidate] : row?.candidateEntityKey
              ? candidates.filter(candidate => candidate.entityKey === row.candidateEntityKey)
              : [];
            if (rowCandidates.length !== 1) return;
            const candidate = rowCandidates[0];
            setCandidateSelection({ scopeKey: selectionScopeKey, entityKey: candidate.entityKey });
            batchRowAnchorRef.current = {
              rowId,
              anchorTop: actionElement?.closest('[data-row-id]')?.getBoundingClientRect().top ?? null,
            };
            onCandidateSelect?.({ entityKey: candidate.entityKey, cas: candidate.cas });
            setBatchState(current => ({
              ...current,
              selectedRowId: rowId,
              scrollY: window.scrollY,
            }));
          }}
          isEnglish={isEnglish}
        />
      </section>
    );
  }

  if (mode !== 'bulk' && hasQuery && !loading && candidates.length > 1 && !selectedCandidate) {
    return (
      <section className="search-results-workbench search-results-workbench--candidates" data-testid="search-results-workbench">
        <span className="search-results-workbench__eyebrow">
          {isEnglish ? 'Compound dossier' : '化合物档案'}
        </span>
        <h2>{isEnglish ? 'Choose a matching entity' : '请选择匹配实体'}</h2>
        <p>
          {isEnglish
            ? 'Multiple chemical identities matched this query. Select one before reviewing evidence.'
            : '该查询命中多个化学身份，请先选择一个实体再查看证据。'}
        </p>
        <ul className="dossier-candidate-list">
          {candidates.map(candidate => {
            const preferredName = (isEnglish ? candidate.englishName : candidate.chineseName)
              || candidate.englishName
              || candidate.chineseName
              || (isEnglish ? 'Unnamed compound' : '未命名化合物');
            const reason = candidate.matchReason === 'cas'
              ? (isEnglish ? 'CAS match' : 'CAS 匹配')
              : (isEnglish ? 'Name match' : '名称匹配');
            return (
              <li key={candidate.entityKey}>
                <button
                  type="button"
                  onClick={() => {
                    pendingCandidateFocusRef.current = true;
                    setCandidateSelection({ scopeKey: selectionScopeKey, entityKey: candidate.entityKey });
                    onCandidateSelect?.({ entityKey: candidate.entityKey, cas: candidate.cas });
                  }}
                >
                  <strong>{preferredName}</strong>
                  {candidate.cas && <span>CAS {candidate.cas}</span>}
                  <span>{reason}</span>
                  <span>{isEnglish ? `${candidate.recordCount} records` : `${candidate.recordCount} 条记录`}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (hasQuery && !loading && hasIdentity) {
    const activeChapter = chapters.find(({ id }) => id === activeChapterId) || chapters[0];
    const records = dossier[activeChapter.id]?.records || [];
    const coveredChapterCount = chapters.filter(({ count }) => count > 0).length;
    const panelSourceStates = Object.fromEntries(
      (CHAPTER_SOURCE_KEYS[activeChapter.id] || [])
        .filter(key => dossier.sourceStates?.[key])
        .map(key => [key, dossier.sourceStates[key]]),
    );
    const updateChapterFilters = (chapterId, nextFilters) => {
      setFilterSelection(current => {
        const values = current.entityKey === entityKey ? current.values : createDefaultChapterFilters();
        return { entityKey, values: { ...values, [chapterId]: nextFilters } };
      });
    };
    const scientificProps = {
      apiUrl,
      ...buildScientificComponentProps({ dossier, includeFlavorDescriptions }),
      isEnglish,
    };
    const renderScientificContent = (chapterId) => {
      if (chapterId === 'spectra') return <SpectraChapter {...scientificProps} onStatusChange={scientificStatusHandlers.spectra} />;
      if (chapterId === 'biochemistry') return <BiochemistryChapter {...scientificProps} onStatusChange={scientificStatusHandlers.biochemistry} />;
      if (chapterId === 'bioactivity') return <BioactivityChapter {...scientificProps} onStatusChange={scientificStatusHandlers.bioactivity} />;
      return <ProteinStructuresChapter {...scientificProps} onStatusChange={scientificStatusHandlers.structures} />;
    };
    const renderStandardContent = () => {
      if (activeChapter.id === 'overview') {
        return <OverviewChapter identity={dossier.identity} chapters={chapters} sourceStates={dossier.sourceStates} isEnglish={isEnglish} />;
      }
      if (activeChapter.id === 'sensory') {
        return <SensorySourcesChapter records={records} filters={chapterFilters.sensory} onFiltersChange={next => updateChapterFilters('sensory', next)} isEnglish={isEnglish} />;
      }
      if (activeChapter.id === 'thresholds') {
        return <ThresholdEvidenceChapter records={records} filters={chapterFilters.thresholds} onFiltersChange={next => updateChapterFilters('thresholds', next)} isEnglish={isEnglish} />;
      }
      if (activeChapter.id === 'citation') {
        return (
          <CitationExportChapter
            citationExampleText={citationText}
            records={records}
            onExportCompact={onExportCompact}
            onExportDetailed={onExportDetailed}
            sourceStates={dossier.sourceStates}
            exportEnabledSourceKeys={exportEnabledSourceKeys}
            isEnglish={isEnglish}
          />
        );
      }
      return <p className="chapter-panel__empty">{isEnglish ? 'Chapter unavailable.' : '章节不可用。'}</p>;
    };

    return (
      <section className="search-results-workbench search-results-workbench--dossier" data-testid="search-results-workbench">
        {mode === 'bulk' && (
          <button
            ref={batchBackButtonRef}
            type="button"
            className="batch-review__back"
            onClick={() => {
              pendingBatchReturnRef.current = {
                rowId: batchRowAnchorRef.current?.rowId ?? batchState.selectedRowId,
                anchorTop: batchRowAnchorRef.current?.anchorTop ?? null,
                scrollY: batchState.scrollY,
              };
              setBatchState(current => ({ ...current, selectedRowId: null }));
            }}
          >
            {isEnglish ? 'Back to batch results' : '返回批量结果'}
          </button>
        )}
        <p className="search-results-workbench__match-summary" aria-live="polite">
          {isEnglish ? `${matchCount} matches` : `匹配 ${matchCount} 条`}
        </p>
        <CompoundIdentityHeader
          identity={dossier.identity}
          headingRef={dossierHeadingRef}
          coveredChapterCount={coveredChapterCount}
          totalChapterCount={CHAPTERS.length}
          isEnglish={isEnglish}
        />
        <div className="search-results-workbench__layout">
          <ChapterNavigation
            chapters={chapters}
            activeId={activeChapter.id}
            onChange={(id) => {
              setChapterSelection({ entityKey, id });
              if (DELEGATED_CHAPTER_IDS.has(id)) {
                setScientificPreload(current => markScientificChapterStarted(
                  current.entityKey === entityKey ? current : createScientificPreloadState(entityKey),
                  id,
                ));
                setScientificStatuses(current => {
                  const values = current.entityKey === entityKey ? current.values : {};
                  return values[id] && values[id] !== 'idle'
                    ? current
                    : { entityKey, values: { ...values, [id]: 'loading' } };
                });
              }
            }}
            isEnglish={isEnglish}
          />
          <div className="chapter-panel-stack">
            {[...DELEGATED_CHAPTER_IDS]
              .filter(id => effectiveScientificPreload.started.includes(id))
              .map(id => {
                const chapter = chapters.find(item => item.id === id);
                return (
                  <div key={id} hidden={activeChapter.id !== id}>
                    <ChapterPanel
                      id={id}
                      title={isEnglish ? chapter.en : chapter.zh}
                      count={chapter.count}
                      status={chapter.status}
                      statusOwner={chapter.statusOwner}
                      sourceStates={{}}
                      isEnglish={isEnglish}
                    >
                      {renderScientificContent(id)}
                    </ChapterPanel>
                  </div>
                );
              })}
            {!DELEGATED_CHAPTER_IDS.has(activeChapter.id) && (
              <ChapterPanel
                id={activeChapter.id}
                title={isEnglish ? activeChapter.en : activeChapter.zh}
                count={activeChapter.count}
                status={activeChapter.status}
                statusOwner={activeChapter.statusOwner}
                sourceStates={panelSourceStates}
                isEnglish={isEnglish}
                onRetry={(sourceId) => onRetrySource?.(sourceId, selectedCandidate)}
              >
                {renderStandardContent()}
              </ChapterPanel>
            )}
          </div>
        </div>
      </section>
    );
  }

  let title;
  let detail;

  if (!hasQuery) {
    title = isEnglish ? 'Enter a name or CAS number to begin searching' : '输入名称或 CAS 号开始检索';
    detail = isEnglish ? 'The dossier workspace will appear here.' : '化合物档案工作区将在这里显示。';
  } else if (loading) {
    title = isEnglish ? 'Building compound dossier' : '正在建立化合物档案';
    detail = isEnglish ? 'Loading local search data…' : '正在载入本地检索数据…';
  } else {
    title = isEnglish ? 'No confirmable compound identity found' : '未找到可确认的化合物身份';
    detail = isEnglish
      ? 'Check the CAS number or spelling, or switch to fuzzy matching to review candidates.'
      : '请检查 CAS 号或名称拼写，也可切换为模糊匹配查看候选项。';
  }

  return (
    <section className="search-results-workbench" data-testid="search-results-workbench" aria-live="polite">
      <span className="search-results-workbench__eyebrow">
        {isEnglish ? 'Compound dossier' : '化合物档案'}
      </span>
      <h2>{title}</h2>
      <p>{detail}</p>
    </section>
  );
}
