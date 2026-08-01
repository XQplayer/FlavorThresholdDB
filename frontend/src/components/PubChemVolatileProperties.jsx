import { getVolatilePropertySections } from '../pubchemVolatile'

const STATE_COPY = {
  no_data: {
    zh: 'PubChem 暂未收录这些实验性质。',
    en: 'PubChem does not currently list these experimental properties.',
  },
  upstream_unavailable: {
    zh: 'PubChem 实验性质服务暂时不可用，其他档案数据不受影响。',
    en: 'PubChem experimental properties are temporarily unavailable. Other profile data is unaffected.',
  },
  invalid_response: {
    zh: 'PubChem 返回了无法解析的实验性质数据，其他档案数据仍可使用。',
    en: 'PubChem returned an unreadable experimental-property response. Other profile data remains available.',
  },
  invalid_cid: {
    zh: '当前 PubChem CID 无法用于查询实验性质。',
    en: 'The current PubChem CID cannot be used to retrieve experimental properties.',
  },
}

const hasValue = value => value !== null && value !== undefined && value !== ''

function getConditionChips(record, isEnglish) {
  const chips = []
  const raw = hasValue(record.raw_value) ? String(record.raw_value) : ''
  const addChip = (label, value) => {
    if (!hasValue(value)) return
    const text = String(value).trim()
    if (!text || (raw && raw.trim() === text)) return
    chips.push({ label, value: text })
  }

  addChip(isEnglish ? 'Temperature' : '温度', record.temperature)
  addChip(isEnglish ? 'Pressure' : '压力', record.pressure)
  addChip(isEnglish ? 'Medium' : '介质', record.medium)

  if (hasValue(record.normalized_value)) {
    const normalized = `${record.normalized_value}${record.unit ? ` ${record.unit}` : ''}`
    if (!raw || raw.trim() !== normalized) {
      chips.push({ label: isEnglish ? 'Normalized' : '标准化值', value: normalized })
    }
  }

  return chips
}

function PropertyRecord({ record, isEnglish }) {
  const chips = getConditionChips(record, isEnglish)
  const rawValue = hasValue(record.raw_value)
    ? String(record.raw_value)
    : (hasValue(record.normalized_value)
        ? `${record.normalized_value}${record.unit ? ` ${record.unit}` : ''}`
        : (isEnglish ? 'Value not reported' : '未报告数值'))
  const reference = hasValue(record.reference_number)
    ? `${isEnglish ? 'Reference' : '参考编号'} ${record.reference_number}`
    : ''

  return (
    <article className="pubchem-volatile-record">
      <p className="pubchem-volatile-raw">{rawValue}</p>
      {chips.length > 0 && (
        <dl className="pubchem-volatile-conditions">
          {chips.map(chip => (
            <div key={`${chip.label}-${chip.value}`}>
              <dt>{chip.label}</dt>
              <dd>{chip.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {(record.source || reference) && (
        <p className="pubchem-volatile-reference">
          {record.source && record.source_url ? (
            <a href={record.source_url} target="_blank" rel="noopener noreferrer">{record.source}</a>
          ) : (
            record.source && <span>{record.source}</span>
          )}
          {record.source && reference && <span aria-hidden="true"> · </span>}
          {reference && <span>{reference}</span>}
        </p>
      )}
    </article>
  )
}

export default function PubChemVolatileProperties({ data, isEnglish }) {
  const isLoading = data === undefined || data?.loading || data?.status === 'loading'
  const status = data?.status
  const sections = isLoading
    ? []
    : getVolatilePropertySections(data?.properties, isEnglish)
        .map(section => ({
          ...section,
          records: section.records.filter(record => record && typeof record === 'object' && !Array.isArray(record)),
        }))
        .filter(section => section.records.length > 0)
  const resolvedStatus = isLoading
    ? 'loading'
    : (STATE_COPY[status] ? status : (sections.length > 0 ? 'ok' : 'no_data'))
  const titleId = `pubchem-volatile-title-${data?.cid || 'record'}`

  return (
    <section className="pubchem-volatile" aria-labelledby={titleId} aria-busy={isLoading}>
      <header className="pubchem-volatile-heading">
        <div>
          <h4 id={titleId}>{isEnglish ? 'Volatility and partition properties' : '挥发与分配性质'}</h4>
          <p>
            {isEnglish
              ? 'Experimental LogP is reported separately from the computed XLogP shown above.'
              : '实验 LogP 与上方计算所得的 XLogP 分开呈现。'}
          </p>
        </div>
        {data?.url ? (
          <a href={data.url} target="_blank" rel="noopener noreferrer">PubChem PUG View</a>
        ) : (
          <span className="pubchem-volatile-source">PubChem PUG View</span>
        )}
      </header>

      {resolvedStatus === 'loading' && (
        <div className="pubchem-volatile-loading" role="status">
          <span />
          <span>{isEnglish ? 'Loading experimental properties…' : '正在载入实验性质…'}</span>
        </div>
      )}

      {STATE_COPY[resolvedStatus] && (
        <p className={`pubchem-volatile-state ${resolvedStatus}`} role={resolvedStatus === 'no_data' ? 'status' : 'note'}>
          {isEnglish ? STATE_COPY[resolvedStatus].en : STATE_COPY[resolvedStatus].zh}
        </p>
      )}

      {resolvedStatus === 'ok' && (
        <div className="pubchem-volatile-grid">
          {sections.map(section => {
            const [primary, ...additional] = section.records
            return (
              <section key={section.key} className="pubchem-volatile-property">
                <h5>{section.label}</h5>
                <PropertyRecord record={primary} isEnglish={isEnglish} />
                {additional.length > 0 && (
                  <details>
                    <summary>
                      {isEnglish
                        ? `${additional.length} additional ${additional.length === 1 ? 'record' : 'records'}`
                        : `另有 ${additional.length} 条记录`}
                    </summary>
                    <div className="pubchem-volatile-additional">
                      {additional.map((record, index) => (
                        <PropertyRecord
                          key={`${record.reference_number ?? 'reference'}-${record.raw_value ?? 'value'}-${index}`}
                          record={record}
                          isEnglish={isEnglish}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </section>
            )
          })}
        </div>
      )}
    </section>
  )
}
