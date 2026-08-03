import { useEffect, useRef, useState } from 'react';
import EvidenceRecordDisclosure from '../EvidenceRecordDisclosure';

const asArray = value => Array.isArray(value) ? value : value == null ? [] : [value];

const locatorText = (raw, isEnglish) => {
  const pages = asArray(raw?.pages).length ? raw.pages : [raw?.page].filter(value => value != null);
  const chunks = asArray(raw?.chunks).length ? raw.chunks : [raw?.chunk].filter(value => value != null);
  const pageText = pages.length ? `${isEnglish ? 'Page' : '第'} ${pages.join(', ')}${isEnglish ? '' : ' 页'}` : null;
  const blockText = chunks.length ? `${isEnglish ? 'Block' : '区块'} ${chunks.join(', ')}` : null;
  return [raw?.book_title || (isEnglish ? 'Wine Flavor Chemistry' : '酒类风味化学'), pageText, blockText].filter(Boolean);
};

export default function CitationExportChapter({ citationExampleText, records = [], onExportCompact, onExportDetailed, sourceStates = {}, isEnglish = false }) {
  const [copyState, setCopyState] = useState('idle');
  const copyTimerRef = useRef(null);
  const copyRequestTokenRef = useRef(0);
  const mountedRef = useRef(false);
  const unavailableSources = Object.values(sourceStates).filter(source => ['failed', 'loading'].includes(source?.status));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      copyRequestTokenRef.current += 1;
      if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    };
  }, []);

  const copyCitation = async () => {
    const requestToken = copyRequestTokenRef.current + 1;
    copyRequestTokenRef.current = requestToken;
    if (copyTimerRef.current) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    try {
      await navigator.clipboard.writeText(citationExampleText || '');
      if (!mountedRef.current || copyRequestTokenRef.current !== requestToken) return;
      setCopyState('success');
    } catch {
      if (!mountedRef.current || copyRequestTokenRef.current !== requestToken) return;
      setCopyState('error');
    }
    if (!mountedRef.current || copyRequestTokenRef.current !== requestToken) return;
    copyTimerRef.current = window.setTimeout(() => {
      if (!mountedRef.current || copyRequestTokenRef.current !== requestToken) return;
      setCopyState('idle');
      copyTimerRef.current = null;
    }, 2000);
  };

  return (
    <div className="citation-export-chapter">
      <section className="citation-export-chapter__example" aria-labelledby="citation-example-heading">
        <div className="citation-export-chapter__heading">
          <h4 id="citation-example-heading">{isEnglish ? 'Citation and export' : '引用与导出'}</h4>
          <button type="button" onClick={copyCitation}>{copyState === 'success' ? (isEnglish ? 'Copied' : '已复制') : (isEnglish ? 'Copy citation' : '复制引用')}</button>
        </div>
        <span className="citation-export-chapter__copy-status" role="status" aria-live="polite">
          {copyState === 'success'
            ? (isEnglish ? 'Citation copied' : '引用已复制')
            : copyState === 'error'
              ? (isEnglish ? 'Copy failed' : '复制失败')
              : ''}
        </span>
        <pre>{citationExampleText || (isEnglish ? 'No citation example is available.' : '暂无引用示例。')}</pre>
        <div className="citation-export-chapter__actions" aria-label={isEnglish ? 'CSV exports' : 'CSV 导出'}>
          <button type="button" onClick={onExportCompact}>{isEnglish ? 'Export compact CSV' : '导出精简版 CSV'}</button>
          <button type="button" onClick={onExportDetailed}>{isEnglish ? 'Export detailed CSV' : '导出详细版 CSV'}</button>
        </div>
        {unavailableSources.length > 0 && (
          <p className="citation-export-chapter__source-warning" aria-live="polite">
            {isEnglish
              ? 'Exports keep currently available evidence. Failed or loading sources are not represented as zero.'
              : '导出会保留当前可用证据；失败或载入中的来源不会被表示为 0。'}
          </p>
        )}
      </section>

      <section aria-labelledby="citation-source-heading">
        <h4 id="citation-source-heading">{isEnglish ? 'Book source records' : '书籍来源记录'}</h4>
        {records.length ? (
          <div className="evidence-record-list">
            {records.map((record, index) => {
              const raw = record?.raw ?? record;
              const summary = raw?.text ?? raw?.raw_text ?? raw?.subject_label ?? raw?.id ?? (isEnglish ? 'Book evidence record' : '书籍证据记录');
              return (
                <EvidenceRecordDisclosure
                  key={raw?.id ?? raw?.record_id ?? `${raw?.page ?? 'page'}-${index}`}
                  record={raw}
                  summary={summary}
                  summaryMeta={locatorText(raw, isEnglish)}
                  isEnglish={isEnglish}
                  renderRecord={() => (
                    <dl>
                      <div><dt>{isEnglish ? 'Source locator' : '来源定位'}</dt><dd>{locatorText(raw, isEnglish).join(' · ')}</dd></div>
                      <div><dt>{isEnglish ? 'Raw record' : '原始记录'}</dt><dd><pre>{JSON.stringify(raw, null, 2)}</pre></dd></div>
                    </dl>
                  )}
                />
              );
            })}
          </div>
        ) : <p className="chapter-panel__empty">{isEnglish ? 'No associated book source record.' : '暂无关联书籍来源记录。'}</p>}
      </section>
    </div>
  );
}
