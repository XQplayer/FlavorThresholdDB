const STATUS_EXPLANATIONS = {
  ready: { zh: '已载入可核验记录', en: 'Verifiable records loaded' },
  partial: { zh: '部分记录可用，部分来源受限', en: 'Some records loaded; at least one source is limited' },
  no_data: { zh: '来源已查询，未返回记录', en: 'Source queried; no records returned' },
  loading: { zh: '来源仍在载入', en: 'Source is still loading' },
  failed: { zh: '来源请求失败', en: 'Source request failed' },
  not_requested: { zh: '本次未请求该来源', en: 'Source was not requested' },
};

export default function OverviewChapter({ identity, chapters = [], sourceStates = {}, isEnglish = false }) {
  const covered = chapters.filter(chapter => chapter.id !== 'overview' && chapter.count > 0);

  return (
    <div className="overview-chapter">
      <section className="overview-chapter__section" aria-labelledby="overview-identity-heading">
        <h4 id="overview-identity-heading">{isEnglish ? 'Identity summary' : '身份摘要'}</h4>
        <dl className="overview-chapter__facts">
          <div>
            <dt>{isEnglish ? 'Preferred name' : '首选名称'}</dt>
            <dd>{(isEnglish ? identity?.englishName : identity?.chineseName) || identity?.englishName || identity?.chineseName || '—'}</dd>
          </div>
          <div>
            <dt>{isEnglish ? 'Molecular formula' : '分子式'}</dt>
            <dd>{identity?.molecularFormula || '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="overview-chapter__section" aria-labelledby="overview-coverage-heading">
        <h4 id="overview-coverage-heading">{isEnglish ? 'Chapter coverage' : '章节覆盖'}</h4>
        {covered.length > 0 ? (
          <ul className="overview-chapter__coverage">
            {covered.map(chapter => (
              <li key={chapter.id}>
                <span>{isEnglish ? chapter.en : chapter.zh}</span>
                <strong>{isEnglish ? `${chapter.count} records` : `${chapter.count} 条记录`}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p>{isEnglish ? 'No evidence chapters currently contain records.' : '当前尚无章节包含证据记录。'}</p>
        )}
      </section>

      <section className="overview-chapter__section" aria-labelledby="overview-source-heading">
        <h4 id="overview-source-heading">{isEnglish ? 'How to read each source result' : '如何理解各来源结果'}</h4>
        <ul className="overview-chapter__sources">
          {Object.entries(sourceStates).map(([key, source]) => {
            const explanation = STATUS_EXPLANATIONS[source.status] || STATUS_EXPLANATIONS.not_requested;
            return (
              <li key={key} data-status={source.status}>
                <strong>{isEnglish ? source.labelEn : source.labelZh}</strong>
                <span>{isEnglish ? explanation.en : explanation.zh}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
