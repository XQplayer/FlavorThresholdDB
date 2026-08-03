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
  sourceStates,
  filters,
  children,
  isEnglish = false,
  onRetry,
}) {
  const headingId = `${id}-chapter-heading`;
  const statusLabel = STATUS_LABELS[status] || STATUS_LABELS.not_requested;

  return (
    <section className="chapter-panel" aria-labelledby={headingId}>
      <header className="chapter-panel__header">
        <div>
          <span className="chapter-panel__status" data-status={status}>
            {isEnglish ? statusLabel.en : statusLabel.zh}
          </span>
          <h3 id={headingId}>{title}</h3>
        </div>
        <span className="chapter-panel__count">
          {isEnglish ? `${count} records` : `${count} 条记录`}
        </span>
      </header>
      <SourceStatusSummary sources={sourceStates} isEnglish={isEnglish} onRetry={onRetry} />
      {filters && <div className="chapter-panel__filters">{filters}</div>}
      <div className="chapter-panel__content">{children}</div>
    </section>
  );
}
