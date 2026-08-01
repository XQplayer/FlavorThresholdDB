const VOLATILE_PROPERTIES = [
  ['boiling_point', '沸点', 'Boiling Point'],
  ['vapor_pressure', '蒸气压', 'Vapor Pressure'],
  ['henrys_law_constant', '亨利定律常数', "Henry's Law Constant"],
  ['water_solubility', '水溶解度', 'Water Solubility'],
  ['experimental_logp', '实验 LogP', 'Experimental LogP'],
  ['density', '密度', 'Density'],
  ['melting_point', '熔点', 'Melting Point'],
  ['physical_state', '物理状态', 'Physical State'],
]

function informationCount(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'string') return value.trim() ? 1 : 0
  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + informationCount(item), 0)
  }
  if (typeof value === 'object') {
    return Object.values(value).reduce(
      (total, item) => total + informationCount(item),
      0,
    )
  }
  return 1
}

export function rankVolatileRecords(records) {
  if (!Array.isArray(records)) return []

  return records
    .map((record, index) => ({ record, index, score: informationCount(record) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ record }) => record)
}

export function getVolatilePropertySections(properties, isEnglish) {
  if (!properties || typeof properties !== 'object') return []

  return VOLATILE_PROPERTIES.flatMap(([key, chineseLabel, englishLabel]) => {
    const records = properties[key]
    if (!Array.isArray(records) || records.length === 0) return []

    return [{
      key,
      label: isEnglish ? englishLabel : chineseLabel,
      records: rankVolatileRecords(records),
    }]
  })
}
