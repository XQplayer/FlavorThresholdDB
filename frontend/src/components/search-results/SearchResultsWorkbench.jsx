import { useEffect, useMemo, useState } from 'react';
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

export default function SearchResultsWorkbench({
  query,
  loading,
  matchCount = 0,
  candidates = [],
  onCandidateSelect,
  apiUrl,
  citationText = '',
  onExportCompact,
  onExportDetailed,
  includeFlavorDescriptions = true,
  isEnglish = false,
}) {
  const queryKey = String(query || '').trim().toLowerCase();
  const [candidateSelection, setCandidateSelection] = useState({ queryKey, entityKey: null });
  const selectedCandidate = candidates.length === 1
    ? candidates[0]
    : candidateSelection.queryKey === queryKey
      ? candidates.find(candidate => candidate.entityKey === candidateSelection.entityKey)
      : null;
  const dossier = selectedCandidate?.dossier;
  const entityKey = selectedCandidate?.entityKey ?? null;
  const [chapterSelection, setChapterSelection] = useState({ entityKey, id: 'overview' });
  const [filterSelection, setFilterSelection] = useState({
    entityKey,
    values: createDefaultChapterFilters(),
  });
  const hasQuery = Boolean(query?.trim());
  const hasIdentity = Boolean(entityKey);
  const activeChapterId = chapterSelection.entityKey === entityKey ? chapterSelection.id : 'overview';
  const defaultChapterFilters = useMemo(() => createDefaultChapterFilters(), []);
  const chapterFilters = filterSelection.entityKey === entityKey
    ? filterSelection.values
    : defaultChapterFilters;
  const chapters = useMemo(() => CHAPTERS.map((chapter) => {
    if (DELEGATED_CHAPTER_IDS.has(chapter.id)) {
      return { ...chapter, count: null, status: null, statusOwner: 'child' };
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
  }), [dossier]);

  useEffect(() => {
    // Query ownership is part of the selection; changing it must not revive a stale candidate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidateSelection(current => current.queryKey === queryKey
      ? current
      : { queryKey, entityKey: null });
  }, [queryKey]);

  useEffect(() => {
    // Entity-scoped navigation and filters reset together after identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChapterSelection(current => current.entityKey === entityKey
      ? current
      : { entityKey, id: 'overview' });
    setFilterSelection(current => current.entityKey === entityKey
      ? current
      : { entityKey, values: createDefaultChapterFilters() });
  }, [entityKey]);

  if (hasQuery && !loading && candidates.length > 1 && !selectedCandidate) {
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
                    setCandidateSelection({ queryKey, entityKey: candidate.entityKey });
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

    return (
      <section className="search-results-workbench search-results-workbench--dossier" data-testid="search-results-workbench">
        <p className="search-results-workbench__match-summary" aria-live="polite">
          {isEnglish ? `${matchCount} matches` : `匹配 ${matchCount} 条`}
        </p>
        <CompoundIdentityHeader
          identity={dossier.identity}
          coveredChapterCount={coveredChapterCount}
          totalChapterCount={CHAPTERS.length}
          isEnglish={isEnglish}
        />
        <div className="search-results-workbench__layout">
          <ChapterNavigation
            chapters={chapters}
            activeId={activeChapter.id}
            onChange={(id) => setChapterSelection({ entityKey, id })}
            isEnglish={isEnglish}
          />
          <ChapterPanel
            id={activeChapter.id}
            title={isEnglish ? activeChapter.en : activeChapter.zh}
            count={activeChapter.count}
            status={activeChapter.status}
            statusOwner={activeChapter.statusOwner}
            sourceStates={panelSourceStates}
            isEnglish={isEnglish}
          >
            {activeChapter.id === 'overview' ? (
              <OverviewChapter
                identity={dossier.identity}
                chapters={chapters}
                sourceStates={dossier.sourceStates}
                isEnglish={isEnglish}
              />
            ) : activeChapter.id === 'sensory' ? (
              <SensorySourcesChapter
                records={records}
                filters={chapterFilters.sensory}
                onFiltersChange={next => updateChapterFilters('sensory', next)}
                isEnglish={isEnglish}
              />
            ) : activeChapter.id === 'thresholds' ? (
              <ThresholdEvidenceChapter
                records={records}
                filters={chapterFilters.thresholds}
                onFiltersChange={next => updateChapterFilters('thresholds', next)}
                isEnglish={isEnglish}
              />
            ) : activeChapter.id === 'spectra' ? (
              <SpectraChapter {...scientificProps} />
            ) : activeChapter.id === 'biochemistry' ? (
              <BiochemistryChapter {...scientificProps} />
            ) : activeChapter.id === 'bioactivity' ? (
              <BioactivityChapter {...scientificProps} />
            ) : activeChapter.id === 'structures' ? (
              <ProteinStructuresChapter {...scientificProps} />
            ) : activeChapter.id === 'citation' ? (
              <CitationExportChapter
                citationExampleText={citationText}
                records={records}
                onExportCompact={onExportCompact}
                onExportDetailed={onExportDetailed}
                isEnglish={isEnglish}
              />
            ) : (
              <p className="chapter-panel__empty">{isEnglish ? 'Chapter unavailable.' : '章节不可用。'}</p>
            )}
          </ChapterPanel>
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
    title = isEnglish ? `${matchCount} matches` : `匹配 ${matchCount} 条`;
    detail = isEnglish ? 'Chapter content will be connected in the next phase.' : '章节内容将在下一阶段接入';
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
