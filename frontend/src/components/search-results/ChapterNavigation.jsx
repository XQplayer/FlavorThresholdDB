const STATUS_LABELS = {
  ready: { zh: '有数据', en: 'Ready' },
  no_data: { zh: '暂无数据', en: 'No data' },
  loading: { zh: '载入中', en: 'Loading' },
  partial: { zh: '部分可用', en: 'Partial' },
  failed: { zh: '载入失败', en: 'Failed' },
  not_requested: { zh: '未请求', en: 'Not requested' },
};

export default function ChapterNavigation({ chapters, activeId, onChange, isEnglish = false }) {
  return (
    <nav className="chapter-navigation" aria-label={isEnglish ? 'Dossier chapters' : '档案章节'}>
      <div className="chapter-navigation__list">
        {chapters.map((chapter) => {
          const label = isEnglish ? chapter.en : chapter.zh;
          const status = chapter.statusOwner === 'child'
            ? null
            : STATUS_LABELS[chapter.status] || STATUS_LABELS.not_requested;
          return (
            <button
              type="button"
              key={chapter.id}
              className="chapter-navigation__button"
              aria-current={chapter.id === activeId ? 'page' : undefined}
              onClick={() => onChange(chapter.id)}
            >
              <span>{label}</span>
              {chapter.statusOwner !== 'child' && (
                <span className="chapter-navigation__meta">
                  <span>{chapter.count}</span>
                  <span>{isEnglish ? status.en : status.zh}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
