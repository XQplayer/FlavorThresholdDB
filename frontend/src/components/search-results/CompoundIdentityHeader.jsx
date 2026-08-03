export default function CompoundIdentityHeader({ identity, coveredChapterCount = 0, isEnglish = false }) {
  if (!identity) return null;

  const preferredName = isEnglish
    ? identity.englishName || identity.chineseName
    : identity.chineseName || identity.englishName;
  const identityStatus = identity.cas && identity.cid
    ? (isEnglish ? 'CAS and CID linked' : 'CAS 与 CID 已关联')
    : identity.cas || identity.cid
      ? (isEnglish ? 'Identity matched' : '身份已匹配')
      : (isEnglish ? 'Identity pending' : '身份待补充');
  const facts = [
    identity.cas && { label: 'CAS', value: identity.cas, combined: true },
    identity.cid != null && { label: 'CID', value: identity.cid },
    identity.molecularFormula && { label: isEnglish ? 'Formula' : '分子式', value: identity.molecularFormula },
  ].filter(Boolean);

  return (
    <header className="compound-identity-header">
      <div className="compound-identity-header__title">
        <span className="compound-identity-header__eyebrow">
          {isEnglish ? 'Compound identity' : '化合物身份'}
        </span>
        <h2>{preferredName || (isEnglish ? 'Unnamed compound' : '未命名化合物')}</h2>
        <div className="compound-identity-header__aliases">
          {identity.englishName && (
            <span><strong>{isEnglish ? 'English' : '英文名'}</strong>{identity.englishName}</span>
          )}
          {identity.chineseName && (
            <span><strong>{isEnglish ? 'Chinese' : '中文名'}</strong>{identity.chineseName}</span>
          )}
        </div>
      </div>
      <dl className="compound-identity-header__facts">
        {facts.map(({ label, value, combined }) => (
          <div key={label}>
            {combined ? (
              <dd>{label} {value}</dd>
            ) : (
              <>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </>
            )}
          </div>
        ))}
        <div>
          <dt>{isEnglish ? 'Identity status' : '身份状态'}</dt>
          <dd>{identityStatus}</dd>
        </div>
        <div>
          <dt>{isEnglish ? 'Chapter coverage' : '章节覆盖'}</dt>
          <dd>{isEnglish ? `${coveredChapterCount} of 8` : `${coveredChapterCount}/8 章`}</dd>
        </div>
      </dl>
    </header>
  );
}
