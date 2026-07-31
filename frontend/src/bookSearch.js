const CAS_PATTERN = /^\d{2,7}-\d{2}-\d$/;

export const normalizeBookTerm = (value) => (value || '')
  .toString()
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\u00ad]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

export const getBookThresholdQuality = (threshold = {}) => {
  const flagCount = threshold.review_flags?.length || 0;
  if (threshold.review_status === 'needs_review' || flagCount > 0) {
    return { level: 'review', reason: 'needsReview', flagCount };
  }
  if (threshold.association_confidence === 'high') {
    return { level: 'high', reason: 'exactAssociation', flagCount };
  }
  return { level: 'medium', reason: 'contextAssociation', flagCount };
};

export const getBookThresholdReviewDetails = (threshold = {}) => (
  [...new Set((threshold.review_flags || []).map(flag => flag.category).filter(Boolean))]
);

export const getBookSourceLocator = (item = {}) => {
  const corrections = item.source_corrections || [];
  const mediumResolution = item.medium_resolution || null;
  const sourceVerificationKind = corrections.length === 0
    ? null
    : corrections.every(correction => (
      correction.reason === 'source_verified_literal_unit'
      || (correction.source_text != null && correction.source_text === correction.corrected_text)
    ))
      ? 'literal'
      : 'corrected';
  return {
    page: item.page ?? null,
    block: Number(item.record_id?.match(/-b(\d+)$/)?.[1]) || null,
    recordId: item.record_id || null,
    sourceVerifiedCorrection: sourceVerificationKind === 'corrected',
    sourceVerificationKind,
    ...(mediumResolution ? {
      mediumResolutionKind: mediumResolution.resolution_type || null,
      mediumResolutionEvidence: mediumResolution.source_page_evidence || null,
    } : {}),
  };
};

export const getBookConflictQuality = (conflict = {}) => ({
  name_variant: { level: 'info', reason: 'nameVariant' },
  likely_ocr_error: { level: 'review', reason: 'likelyOcrError' },
  insufficient_extraction: { level: 'high', reason: 'insufficientExtraction' },
  identity_conflict: { level: 'high', reason: 'identityConflict' },
  source_identity_error: { level: 'verified', reason: 'verifiedSourceConflict' },
  verified_name_variant: { level: 'verified', reason: 'verifiedNameVariant' },
}[conflict.type] || { level: 'high', reason: 'identityConflict' });

export const getThresholdsForBookHit = (thresholds = [], hit = {}) => {
  const chunks = new Set(hit.chunks || (hit.chunk ? [hit.chunk] : []));
  const pages = new Set(hit.pages || (hit.page == null ? [] : [hit.page]));
  const matchedCas = hit.matched_entity_cas || hit.entity_cas;
  const matchedNames = new Set([
    hit.matched_subject_label,
    hit.entity?.chinese_name,
    ...(hit.entity?.english_names || []),
    ...(hit.entity?.aliases || []),
  ].map(normalizeBookTerm).filter(Boolean));
  return thresholds.filter(item => {
    if (pages.size > 0 && !pages.has(item.page)) return false;
    if (matchedCas && item.entity_cas === matchedCas) return true;
    const subject = normalizeBookTerm(item.subject_resolution?.subject_label || item.subject_label);
    const verifiedSubject = item.subject_resolution?.resolution_type?.startsWith('source_verified_');
    if (subject && matchedNames.has(subject) && (verifiedSubject || !matchedCas)) return true;
    if (matchedCas) return false;
    const block = Number(item.record_id?.match(/-b(\d+)$/)?.[1]);
    return chunks.size === 0 || chunks.has(block);
  });
};

const BOOK_MEDIUM_ORDER = ['air', 'water', 'ethanolWater', 'wine', 'beer', 'other'];

const getBookMediumGroup = (threshold = {}) => {
  const media = (threshold.media || []).map(normalizeBookTerm);
  if (media.some(value => value.includes('空气'))) return 'air';
  if (media.some(value => value.includes('乙醇-水') || value.includes('酒精-水'))) return 'ethanolWater';
  if (media.some(value => value.includes('葡萄酒'))) return 'wine';
  if (media.some(value => value.includes('啤酒'))) return 'beer';
  if (media.some(value => value === '水' || value.includes('水溶液'))) return 'water';
  return 'other';
};

export const groupBookThresholds = (thresholds = []) => {
  const groups = new Map(BOOK_MEDIUM_ORDER.map(key => [key, []]));
  thresholds.forEach(threshold => groups.get(getBookMediumGroup(threshold)).push(threshold));
  return BOOK_MEDIUM_ORDER
    .map(key => ({ key, thresholds: groups.get(key) }))
    .filter(group => group.thresholds.length > 0);
};

export const summarizeBookSources = (thresholds = []) => {
  const pages = [...new Set(thresholds.map(item => item.page).filter(Number.isFinite))].sort((a, b) => a - b);
  const blockMap = new Map();
  thresholds.forEach(item => {
    const locator = getBookSourceLocator(item);
    if (!Number.isFinite(locator.page) || !locator.block) return;
    blockMap.set(`${locator.page}:${locator.block}`, { page: locator.page, block: locator.block });
  });
  return {
    pages,
    blocks: [...blockMap.values()].sort((a, b) => a.page - b.page || a.block - b.block),
    hasSourceCorrection: thresholds.some(item => (item.source_corrections || []).length > 0),
  };
};

export const getBookDisplayCas = (hit = {}, thresholds = []) => (
  hit.entity?.cas
  || thresholds.find(item => (
    item.subject_resolution?.resolution_type?.startsWith('source_verified_')
    && item.subject_resolution?.canonical_cas
  ))?.subject_resolution?.canonical_cas
  || null
);

export const getBookThresholdRowKey = (threshold = {}, groupKey = 'other', index = 0) => (
  `${threshold.page ?? 'unknown'}-${threshold.record_id || 'record'}-${groupKey}-${index}`
);

const isUsefulTerm = (term) => {
  if (!term) return false;
  if (CAS_PATTERN.test(term)) return true;
  if ([...term].every(char => char.codePointAt(0) <= 127)) return term.length >= 3;
  return term.length >= 2;
};

const countOccurrences = (text, term) => {
  if (!text || !term) return 0;
  let count = 0;
  let start = 0;
  while (count < 4) {
    const index = text.indexOf(term, start);
    if (index === -1) break;
    count += 1;
    start = index + Math.max(1, term.length);
  }
  return count;
};

export const resolveBookEntities = (rawQueries, bookEntities = []) => {
  const queries = new Set(rawQueries.map(normalizeBookTerm).filter(isUsefulTerm));
  const matchesEntityName = (name, query) => {
    if (name === query) return true;
    const asciiQuery = [...query].every(char => char.codePointAt(0) <= 127);
    if (asciiQuery) return name.startsWith(`${query} (`) || name.startsWith(`${query},`);
    return name.includes(query);
  };
  return bookEntities.filter(entity => {
    const names = [entity.cas, entity.chinese_name, ...(entity.english_names || []), ...(entity.aliases || [])]
      .map(normalizeBookTerm)
      .filter(Boolean);
    return names.some(name => [...queries].some(query => matchesEntityName(name, query)));
  });
};

const getEntityNames = (entity = {}) => new Set([
  entity.chinese_name,
  ...(entity.english_names || []),
  ...(entity.aliases || []),
].map(normalizeBookTerm).filter(Boolean));

const getRecordEntityMatch = (record, entities) => {
  const recordCases = new Set([record.entity_cas, ...(record.entity_cas_list || [])].filter(Boolean));
  const subject = normalizeBookTerm(record.subject_label);
  return entities.find(entity => (
    recordCases.has(entity.cas) || (subject && getEntityNames(entity).has(subject))
  )) || null;
};

export const buildBookSearchTerms = (rawQueries, matchedCompounds = [], bookEntities = []) => {
  const terms = new Map();
  const add = (value, kind, weight, label) => {
    const term = normalizeBookTerm(value).replace(/^['"“”]+|['"“”]+$/g, '');
    if (!isUsefulTerm(term)) return;
    const existing = terms.get(term);
    if (!existing || existing.weight < weight) {
      terms.set(term, { term, kind, weight, label });
    }
  };

  rawQueries.forEach(query => add(query, CAS_PATTERN.test(normalizeBookTerm(query)) ? 'cas' : 'query', 80, 'query'));
  matchedCompounds.forEach(item => {
    add(item.cas, 'cas', 120, 'cas');
    add(item.chinese_name, 'chinese_name', 75, 'chineseName');
    add(item.english_name, 'english_name', 70, 'englishName');
  });
  bookEntities.forEach(entity => {
    add(entity.cas, 'cas', 125, 'bookEntity');
    add(entity.chinese_name, 'chinese_name', 82, 'bookEntity');
    (entity.english_names || []).forEach(name => add(name, 'english_name', 78, 'bookEntity'));
    (entity.aliases || []).forEach(name => add(name, 'alias', 72, 'bookEntity'));
  });

  return [...terms.values()].sort((a, b) => b.weight - a.weight || b.term.length - a.term.length);
};

const scoreBookRecord = (record, terms, matchedEntityCas) => {
  const text = normalizeBookTerm(`${record.text || ''} ${record.structured_search_text || ''}`);
  const lead = text.slice(0, 180);
  let score = 0;
  const reasons = new Map();

  terms.forEach(entry => {
    const occurrences = countOccurrences(text, entry.term);
    if (!occurrences) return;
    let termScore = entry.weight + Math.min(occurrences - 1, 3) * 4;
    if (lead.includes(entry.term)) termScore += 18;
    if (entry.kind === 'cas') termScore += 20;
    score += termScore;
    reasons.set(entry.label, Math.max(reasons.get(entry.label) || 0, termScore));
  });

  const recordEntityCas = [record.entity_cas, ...(record.entity_cas_list || [])].filter(Boolean);
  const matchedRecordCas = recordEntityCas.find(cas => matchedEntityCas.has(cas)) || null;
  if (matchedRecordCas) {
    score += 145;
    reasons.set('bookEntity', 145);
  }

  if (!score) return null;
  if (/阈\s*值|嗅阈|觉察阈|识别阈|threshold|(?:m|n|μ|u)g\//i.test(record.text || '')) score += 6;
  if (/白酒|葡萄酒|啤酒|黄酒|果酒|酒精|乙醇/i.test(record.text || '')) score += 4;

  return {
    ...record,
    matched_entity_cas: matchedRecordCas,
    score,
    matchReasonCodes: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason]) => reason),
  };
};

const mergeText = (left, right) => {
  const a = (left || '').trim();
  const b = (right || '').trim();
  if (!a) return b;
  if (!b || a.includes(b)) return a;
  if (b.includes(a)) return b;

  const maxOverlap = Math.min(220, a.length, b.length);
  for (let size = maxOverlap; size >= 35; size -= 1) {
    if (a.slice(-size) === b.slice(0, size)) return `${a}${b.slice(size)}`;
  }
  return `${a}\n${b}`;
};

export const mergeBookHitsByEntity = (hits = []) => {
  const groups = new Map();
  hits.forEach(hit => {
    const key = hit.matched_entity_cas
      || hit.entity?.cas
      || `subject:${normalizeBookTerm(hit.matched_subject_label || hit.subject_label)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  });

  return [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => (a.page || 0) - (b.page || 0) || (a.chunk || 0) - (b.chunk || 0));
    const first = ordered[0];
    return {
      ...first,
      id: `${key}-merged`,
      page: first.page,
      pages: [...new Set(ordered.map(item => item.page).filter(Number.isFinite))],
      chapters: [...new Set(ordered.map(item => item.chapter).filter(Boolean))],
      sections: [...new Set(ordered.map(item => item.section).filter(Boolean))],
      chunks: [...new Set(ordered.flatMap(item => item.chunks || (item.chunk ? [item.chunk] : [])))],
      source_hits: ordered,
      text: ordered.reduce((text, item) => mergeText(text, item.text), ''),
      score: Math.max(...ordered.map(item => item.score || 0)),
      matchReasonCodes: [...new Set(ordered.flatMap(item => item.matchReasonCodes || []))],
    };
  }).sort((a, b) => b.score - a.score || a.page - b.page);
};

const collapseSamePageHits = (hits) => {
  const groups = new Map();
  hits.forEach(hit => {
    const key = `${hit.book_title || ''}:${hit.page}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(hit);
  });

  return [...groups.values()].map(group => {
    const ordered = [...group].sort((a, b) => a.chunk - b.chunk);
    const best = [...group].sort((a, b) => b.score - a.score || a.chunk - b.chunk)[0];
    const reasonCodes = [...new Set(group.flatMap(item => item.matchReasonCodes))];
    return {
      ...best,
      id: `${best.id}-page-merged`,
      text: ordered.reduce((text, item) => mergeText(text, item.text), ''),
      chunks: ordered.map(item => item.chunk),
      score: Math.max(...group.map(item => item.score)) + Math.min(group.length - 1, 3) * 3,
      matchReasonCodes: reasonCodes,
    };
  });
};

export const searchBookIndex = ({
  records,
  rawQueries,
  matchedCompounds = [],
  bookEntities = [],
  exactMatch = false,
  limit = 20,
}) => {
  const normalizedQueries = new Set(rawQueries.map(normalizeBookTerm).filter(Boolean));
  const resolvedBookEntities = resolveBookEntities(rawQueries, bookEntities);
  const matchedBookEntities = exactMatch
    ? resolvedBookEntities.filter(entity => [
      entity.cas,
      entity.chinese_name,
      ...(entity.english_names || []),
      ...(entity.aliases || []),
    ].map(normalizeBookTerm).some(name => normalizedQueries.has(name)))
    : resolvedBookEntities;
  const scopedMatchedCompounds = exactMatch
    ? matchedCompounds.filter(entity => [
      entity.cas,
      entity.chinese_name,
      entity.english_name,
      ...(entity.english_names || []),
      ...(entity.aliases || []),
    ].map(normalizeBookTerm).some(name => normalizedQueries.has(name)))
    : matchedCompounds;
  const matchedEntityCas = new Set([
    ...matchedBookEntities.map(entity => entity.cas),
    ...scopedMatchedCompounds.map(entity => entity.cas),
  ].filter(Boolean));
  const exactSubjects = new Set(rawQueries.map(normalizeBookTerm).filter(term => term && !CAS_PATTERN.test(term)));
  const terms = buildBookSearchTerms(rawQueries, scopedMatchedCompounds, matchedBookEntities);
  if (!terms.length) return [];

  const seenTexts = new Set();
  const hits = records
    .map(record => {
      const entityMatch = getRecordEntityMatch(record, matchedBookEntities);
      const subject = normalizeBookTerm(record.subject_label);
      const subjectMatch = subject && exactSubjects.has(subject) ? subject : null;
      const recordCases = new Set([record.entity_cas, ...(record.entity_cas_list || [])].filter(Boolean));
      const exactCasMatch = [...recordCases].some(cas => matchedEntityCas.has(cas));
      if (exactMatch && matchedEntityCas.size > 0 && !exactCasMatch && !subjectMatch) return null;
      if (exactMatch && matchedEntityCas.size === 0 && exactSubjects.size > 0 && !subjectMatch) return null;
      const scored = scoreBookRecord(record, terms, matchedEntityCas);
      if (!scored) return null;
      return {
        ...scored,
        matched_entity_cas: scored.matched_entity_cas || entityMatch?.cas || null,
        matched_subject_label: entityMatch ? null : subjectMatch,
      };
    })
    .filter(Boolean)
    .filter(record => {
      const fingerprint = normalizeBookTerm(record.text);
      if (seenTexts.has(fingerprint)) return false;
      seenTexts.add(fingerprint);
      return true;
    });

  const entityLookup = new Map(bookEntities.map(entity => [entity.cas, entity]));
  return collapseSamePageHits(hits)
    .map(hit => ({ ...hit, entity: entityLookup.get(hit.matched_entity_cas || hit.entity_cas) || null }))
    .sort((a, b) => b.score - a.score || a.page - b.page || a.chunk - b.chunk)
    .slice(0, limit);
};
