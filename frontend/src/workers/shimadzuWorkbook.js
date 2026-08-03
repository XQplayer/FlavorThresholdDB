import * as XLSX from 'xlsx'

const clean = value => String(value ?? '').trim()
const valueOf = (row, headers, ...names) => {
  for (const name of names) if (headers.has(name)) return row[headers.get(name)]
  return ''
}

export function safeSheetName(value) {
  const cleaned = clean(value).replace(/[\\/:*?\[\]]/g, '_').slice(0, 31)
  return cleaned || 'Sheet1'
}

export function readWorkbookSheets(bytes) {
  const workbook = XLSX.read(bytes, { type: 'array', raw: true, cellDates: false })
  return workbook.SheetNames.map(name => ({
    name,
    rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null })
      .map((cells, index) => ({ sourceRow: index + 1, cells })),
  }))
}

export function readSampleConfiguration(bytes) {
  const sheets = readWorkbookSheets(bytes)
  const sheet = sheets.find(entry => entry.rows.some(row => row.cells.includes('样品名称')))
  if (!sheet) throw Object.assign(new Error('SAMPLE_CONFIGURATION_SHEET_MISSING'), { code: 'SAMPLE_CONFIGURATION_SHEET_MISSING' })
  const headerIndex = sheet.rows.findIndex(row => row.cells.includes('样品名称'))
  const headers = new Map(sheet.rows[headerIndex].cells.map((value, index) => [clean(value), index]))
  const samples = []
  for (const source of sheet.rows.slice(headerIndex + 1)) {
    const row = source.cells
    const sampleName = clean(valueOf(row, headers, '样品名称'))
    if (!sampleName) continue
    const sampleForm = clean(valueOf(row, headers, '样品形态')) || '液体'
    const legacyAmount = valueOf(row, headers, '样品添加量')
    const liquidAmountMl = headers.has('液体样品添加量（mL）')
      ? valueOf(row, headers, '液体样品添加量（mL）')
      : sampleForm === '液体' ? legacyAmount : 'NA'
    const solidAmountG = headers.has('固体样品添加量（g）')
      ? valueOf(row, headers, '固体样品添加量（g）')
      : sampleForm === '固体' ? legacyAmount : 'NA'
    const rawStandard = clean(valueOf(row, headers, '内标', '内标 CAS', '内标CAS'))
    const internalStandardCas = rawStandard.match(/\d{1,7}-\d{2}-\d/)?.[0] ?? rawStandard
    const systemCell = valueOf(row, headers, '体系液相体积', '体系液相体积（mL）')
    samples.push({
      sampleName,
      sampleGroup: clean(valueOf(row, headers, '样品分组')),
      matrixName: clean(valueOf(row, headers, '矩阵名称')) || '浓度矩阵',
      sampleType: clean(valueOf(row, headers, '样品类型', '样品类别')),
      sampleForm,
      liquidAmountMl,
      solidAmountG,
      internalStandardCas,
      internalStandardName: clean(valueOf(row, headers, '内标名称')),
      stockUgMl: valueOf(row, headers, '内标添加浓度（μg/mL）', '内标储备液浓度'),
      spikeUl: valueOf(row, headers, '内标添加量（μL）', '内标添加量'),
      systemMl: clean(systemCell) ? systemCell : (sampleForm === '液体' ? liquidAmountMl : systemCell),
      volumeBasis: valueOf(row, headers, '体系体积口径') || '加内标前',
      headspaceSystem: valueOf(row, headers, '顶空体系', '顶空体系说明'),
      includeSpikeVolume: valueOf(row, headers, '是否纳入内标体积', '计算方法') || '是',
      userFinalUgMl: valueOf(row, headers, '用户提供的内标终浓度（μg/mL）', '用户提供的内标终浓度') || 'NA',
      includeInAnalysis: valueOf(row, headers, '是否纳入分析') || '是',
      notes: clean(valueOf(row, headers, '备注')),
      sourceRow: source.sourceRow,
    })
  }
  return { samples, sheetName: sheet.name }
}

const calculatedColumn = name => /（μg\/mL）|\b(?:Mean|SD|CV)\b/i.test(name)

export function writeTableWorkbook(sheets) {
  const workbook = XLSX.utils.book_new()
  const usedNames = new Set()
  for (const table of sheets) {
    const columns = [...table.columns]
    const rows = table.rows.map(row => columns.map(column => row?.[column] ?? 'NA'))
    const sheet = XLSX.utils.aoa_to_sheet([columns, ...rows])
    for (const [columnIndex, column] of columns.entries()) {
      if (!calculatedColumn(column)) continue
      for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })
        if (sheet[address]?.t === 'n') sheet[address].z = '0.0000'
      }
    }
    sheet['!cols'] = columns.map(column => ({ wch: Math.min(36, Math.max(12, clean(column).length + 4)) }))
    let name = safeSheetName(table.name)
    for (let suffix = 2; usedNames.has(name); suffix += 1) name = safeSheetName(`${table.name}-${suffix}`)
    usedNames.add(name)
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  return new Uint8Array(XLSX.write(workbook, { type: 'array', bookType: 'xlsx', cellStyles: true }))
}
