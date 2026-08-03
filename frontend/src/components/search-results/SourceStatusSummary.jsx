const STATUS_LABELS = {
  not_requested: { zh: '未请求', en: 'Not requested' },
  loading: { zh: '载入中', en: 'Loading' },
  ready: { zh: '可用', en: 'Ready' },
  no_data: { zh: '无数据', en: 'No data' },
  partial: { zh: '部分可用', en: 'Partial' },
  failed: { zh: '失败', en: 'Failed' },
};

const toEntries = (sources) => Array.isArray(sources)
  ? sources.map((source) => [source.name ?? source.source, source])
  : Object.entries(sources || {});

export default function SourceStatusSummary({ sources, isEnglish = false, onRetry }) {
  const entries = toEntries(sources).filter(([name]) => name);
  if (!entries.length) return null;

  return (
    <div className="source-status-summary" aria-label={isEnglish ? 'Source status' : '来源状态'} aria-live="polite">
      <span className="source-status-summary__label">{isEnglish ? 'Sources' : '来源'}</span>
      <ul>
        {entries.map(([name, source]) => {
          const status = source?.status ?? source?.state ?? 'not_requested';
          const label = STATUS_LABELS[status] || STATUS_LABELS.not_requested;
          const sourceLabel = (isEnglish ? source?.labelEn : source?.labelZh) || name;
          const failedChildren = status === 'partial' && Array.isArray(source?.failedChildren)
            ? source.failedChildren
            : [];
          return (
            <li key={name} data-status={STATUS_LABELS[status] ? status : 'not_requested'}>
              <span>{sourceLabel}</span>
              <strong>{isEnglish ? label.en : label.zh}</strong>
              {status === 'failed' && onRetry && (
                <button type="button" onClick={() => onRetry(name)} disabled={source?.retrying}>
                  {source?.retrying
                    ? (isEnglish ? 'Retrying…' : '重试中…')
                    : (isEnglish ? 'Retry' : '重试')}
                </button>
              )}
              {onRetry && failedChildren.map(child => (
                <button
                  key={child.sourceId || child.id}
                  type="button"
                  onClick={() => onRetry?.(child.sourceId || child.id)}
                  disabled={child.retrying}
                >
                  {child.retrying
                    ? (isEnglish ? 'Retrying…' : '重试中…')
                    : `${isEnglish ? 'Retry' : '重试'} ${(isEnglish ? child.labelEn : child.labelZh) || child.sourceId || child.id}`}
                </button>
              ))}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
