import { useId, useState } from 'react';

export default function EvidenceRecordDisclosure({
  record,
  renderRecord,
  summary,
  summaryMeta = [],
  isEnglish = false,
  panelId,
}) {
  const generatedId = useId();
  const [expanded, setExpanded] = useState(false);
  const contentId = panelId || `evidence-record-${generatedId.replace(/:/g, '')}`;

  return (
    <article className="evidence-record-disclosure">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="evidence-record-disclosure__summary">
          {summary && (
            <span className="evidence-record-disclosure__sr-only">
              {isEnglish ? 'Original record' : '原始记录'}
            </span>
          )}
          <strong>{summary || (isEnglish ? 'Original record' : '原始记录')}</strong>
          {summaryMeta.length > 0 && (
            <span>{summaryMeta.filter(Boolean).join(' · ')}</span>
          )}
        </span>
        <span aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      <div id={contentId} className="evidence-record-disclosure__panel" hidden={!expanded}>
        {renderRecord ? renderRecord(record) : (
          <dl>
            {record.originalText && (
              <div>
                <dt>{isEnglish ? 'Original text' : '原始文本'}</dt>
                <dd>{record.originalText}</dd>
              </div>
            )}
            {record.source && (
              <div>
                <dt>{isEnglish ? 'Source' : '来源'}</dt>
                <dd>{record.source}</dd>
              </div>
            )}
            {!record.originalText && !record.source && (
              <div>
                <dt>{isEnglish ? 'Record' : '记录'}</dt>
                <dd>{isEnglish ? 'No source text is available.' : '暂无来源文本。'}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
    </article>
  );
}
