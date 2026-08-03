import SourceStatusSummary from './SourceStatusSummary';

const STATUS_LABELS = {
  ready: { zh: '有数据', en: 'Ready' },
  no_data: { zh: '暂无数据', en: 'No data' },
  loading: { zh: '载入中', en: 'Loading' },
  partial: { zh: '部分可用', en: 'Partial' },
  failed: { zh: '载入失败', en: 'Failed' },
  not_requested: { zh: '未请求', en: 'Not requested' },
};

export default function ChapterPanel({
  id,
  title,
  count = 0,
  status = 'not_requested',
  statusOwner = 'workbench',
  sourceStates,
  filters,
  children,
  isEnglish = false,
  onRetry,
}) {
  const headingId = `${id}-chapter-heading`;
  const statusLabel = STATUS_LABELS[status] || STATUS_LABELS.not_requested;
  const hasExternalState = statusOwner !== 'child';
  const failedSources = Object.values(sourceStates || {}).filter(source => source?.status === 'failed');
  const statusMessage = status === 'partial'
    ? (isEnglish ? 'Some sources are temporarily unavailable; available records remain visible.' : '部分来源暂不可用；已获得的记录继续保留。')
    : status === 'failed'
      ? (isEnglish ? 'The sources for this chapter are temporarily unavailable.' : '本章相关来源暂不可用。')
      : status === 'loading'
        ? (isEnglish ? 'This chapter is still loading; available records remain visible.' : '本章来源仍在载入；已获得的记录继续显示。')
        : status === 'no_data'
          ? (isEnglish ? 'The relevant sources were queried but returned no records.' : '已查询本章相关来源，但未返回记录。')
          : null;

  return (
    <section className="chapter-panel" aria-labelledby={headingId}>
      <header className="chapter-panel__header">
        <div>
          {hasExternalState && status != null && (
            <span className="chapter-panel__status" data-status={status}>
              {isEnglish ? statusLabel.en : statusLabel.zh}
            </span>
          )}
          <h3 id={headingId}>{title}</h3>
        </div>
        {hasExternalState && count != null && (
          <span className="chapter-panel__count">
            {isEnglish ? `${count} records` : `${count} 条记录`}
          </span>
        )}
      </header>
      {hasExternalState && statusMessage && (
        <p className="chapter-panel__state-callout" data-status={status} aria-live="polite">
          {statusMessage}
          {failedSources.length > 0 && (
            <span>
              {isEnglish ? ' Failed: ' : ' 失败来源：'}
              {failedSources.map(source => (isEnglish ? source.labelEn : source.labelZh)).filter(Boolean).join(', ')}
            </span>
          )}
        </p>
      )}
      <SourceStatusSummary sources={sourceStates} isEnglish={isEnglish} onRetry={onRetry} />
      {filters && <div className="chapter-panel__filters">{filters}</div>}
      <div className="chapter-panel__content">{children}</div>
    </section>
  );
}
