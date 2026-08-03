export default function CompoundIdentityHeader({
  identity,
  headingRef,
  coveredChapterCount = 0,
  totalChapterCount = 0,
  isEnglish = false,
}) {
  if (!identity) return null;

  const englishName = String(identity.englishName || '').trim();
  const chineseName = String(identity.chineseName || '').trim();
  const preferredName = isEnglish
    ? englishName || chineseName
    : chineseName || englishName;
  const normalizeName = value => value.trim().toLowerCase();
  const seenNames = new Set([normalizeName(preferredName)]);
  const aliases = [
    { label: isEnglish ? 'English' : '英文名', value: englishName },
    { label: isEnglish ? 'Chinese' : '中文名', value: chineseName },
  ].filter(({ value }) => {
    const normalized = normalizeName(value);
    if (!normalized || seenNames.has(normalized)) return false;
    seenNames.add(normalized);
    return true;
  });
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
        <h2 ref={headingRef} tabIndex={-1}>{preferredName || (isEnglish ? 'Unnamed compound' : '未命名化合物')}</h2>
        <div className="compound-identity-header__aliases">
          {aliases.map(({ label, value }) => (
            <span key={label}><strong>{label}</strong>{value}</span>
          ))}
        </div>
      </div>
      <dl className="compound-identity-header__facts">
        {facts.map(({ label, value, combined }) => (
          <div key={label}>
            {combined ? (
              <>
                <dt className="compound-identity-header__sr-only">{label}</dt>
                <dd>{label} {value}</dd>
              </>
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
          <dd>
            {isEnglish
              ? `${coveredChapterCount} of ${totalChapterCount}`
              : `${coveredChapterCount}/${totalChapterCount} 章`}
          </dd>
        </div>
      </dl>
    </header>
  );
}
