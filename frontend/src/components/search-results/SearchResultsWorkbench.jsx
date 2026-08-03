import './SearchResultsWorkbench.css';

export default function SearchResultsWorkbench({ query, loading, matchCount = 0, isEnglish = false }) {
  const hasQuery = Boolean(query?.trim());
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
