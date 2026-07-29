import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { Search, FileSpreadsheet, List, FileText, Download, AlertCircle, Loader2, Info, Upload, ExternalLink, X, Copy, Check } from 'lucide-react';
import * as XLSX from 'xlsx';

const FEMA_API_URL = (import.meta.env.VITE_FEMA_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');

const parseThresholdStr = (str) => {
  const match = str.match(/^(.+?\(\d{4}.*?\))\s*(?:([dr])\s+)?(.*)$/);
  if (match) {
    let typeStr = '-';
    if (match[2] === 'd') typeStr = '觉察阈 (d)';
    else if (match[2] === 'r') typeStr = '识别阈 (r)';
    return {
      author: match[1].trim(),
      type: typeStr,
      value: match[3].trim()
    };
  }
  return { author: str, type: '-', value: '-' };
};

export default function App() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [searchMode, setSearchMode] = useState('single'); // 'single' or 'bulk'
  const [singleQuery, setSingleQuery] = useState('');
  const [bulkQuery, setBulkQuery] = useState('');
  const [selectedMedia, setSelectedMedia] = useState(['空气', '水', '其他介质']);
  const [includeBookResults, setIncludeBookResults] = useState(true);
  const [includeFlavorDescriptions, setIncludeFlavorDescriptions] = useState(true);
  const [selectedThresholdTypes, setSelectedThresholdTypes] = useState(['d', 'r']);
  const [filterOrder, setFilterOrder] = useState(['medium:空气', 'medium:水', 'medium:其他介质', 'book', 'flavor', 'threshold:d', 'threshold:r']);
  const [draggedFilterKey, setDraggedFilterKey] = useState(null);
  const [exactMatch, setExactMatch] = useState(true); // Default to exact match
  const fileInputRef = useRef(null);

  // Use deferred values for smooth typing
  const deferredSingleQuery = useDeferredValue(singleQuery);
  const deferredBulkQuery = useDeferredValue(bulkQuery);
  
  const [references, setReferences] = useState({});
  const [normRefsKeys, setNormRefsKeys] = useState([]);
  const [selectedRef, setSelectedRef] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showCitationExample, setShowCitationExample] = useState(false);
  const [citationCopied, setCitationCopied] = useState(false);
  const [interfaceLanguage, setInterfaceLanguage] = useState('zh');
  const [refsLookup, setRefsLookup] = useState({});
  const [bookIndex, setBookIndex] = useState([]);
  const [femaProfiles, setFemaProfiles] = useState({});

  const isEnglish = interfaceLanguage === 'en';
  const ui = {
    loading: isEnglish ? 'Loading the local odor-threshold database...' : '正在解析本地阈值大数据库...',
    singleMode: isEnglish ? 'Single search' : '搜索框模式',
    bulkMode: isEnglish ? 'Batch matching' : '批量匹配模式',
    exact: isEnglish ? 'Exact search' : '精确检索',
    fuzzy: isEnglish ? 'Fuzzy search' : '模糊检索',
    bulkLabel: isEnglish ? 'Enter one substance per line' : '请输入需要匹配的物质名单（每行一个记录）',
    importFile: isEnglish ? 'Import CSV / Excel' : '导入 CSV / Excel 表格',
    bulkPlaceholder: isEnglish ? 'Enter one substance name or CAS number per line, or import a spreadsheet above...' : '每一行填写一个物质名称或 CAS 号，或者点击上方按钮导入表格...',
    bulkHelp: isEnglish ? 'Supports Chinese and English names, CAS numbers, and fuzzy matching.' : '支持中英文混排、支持 CAS 号与模糊匹配。直接提取出相关阈值记录结果。',
    filters: isEnglish ? 'Result filters:' : '检测介质过滤:',
    dragTitle: isEnglish ? 'Drag to reorder the result sections below' : '拖动可调整下方结果卡片顺序',
    results: isEnglish ? 'Matched results' : '匹配结果',
    found: isEnglish ? 'records found' : '条记录',
    exportCsv: isEnglish ? 'Export CSV' : '导出为 CSV',
    noResults: isEnglish ? 'No matching compound records found' : '未找到匹配的化合物记录',
    noResultsHelp: isEnglish ? 'Check the spelling or use a CAS number for an exact search.' : '请尝试检查拼写，或使用 CAS 号进行精确定位寻找。',
    medium: isEnglish ? 'Medium' : '检测介质',
    thresholdRecords: isEnglish ? 'Literature and odor-threshold records' : '研究文献与阈值数据记录',
    source: isEnglish ? 'Source' : '文献来源',
    thresholdType: isEnglish ? 'Threshold type' : '阈值类型',
    threshold: isEnglish ? 'Threshold' : '阈值',
    noThresholds: isEnglish ? 'No detailed threshold records available' : '暂无阈值详细记录',
    flavorClassification: isEnglish ? 'Flavor descriptions and categories' : '风味描述与分类',
    flavorSource: isEnglish ? 'Source: FlavorNet' : '来源: FlavorNet',
    externalLinks: isEnglish ? 'External flavor-description sources:' : '香气描述外链查询:',
    flavorDescriptions: isEnglish ? 'Flavor descriptions' : '风味描述',
    openFema: isEnglish ? 'Open FEMA page' : '打开 FEMA 页面',
    bookResults: isEnglish ? 'Book search results' : '书籍检索结果',
    pageChunk: (page, chunk) => isEnglish ? `Page ${page} / excerpt ${chunk}` : `第 ${page} 页 / 片段 ${chunk}`,
    showOriginal: isEnglish ? 'View full original excerpt' : '查看原始片段全文',
    referenceDetails: isEnglish ? 'Reference details' : '文献来源详情',
    citationIndex: isEnglish ? 'Citation index' : '引文索引',
    copied: isEnglish ? 'Copied' : '复制成功',
    copyReference: isEnglish ? 'Copy reference' : '一键复制文献内容'
  };
  const displayMedium = (medium) => isEnglish
    ? ({ '空气': 'Air', '水': 'Water', '其他介质': 'Other media' }[medium] || medium)
    : medium;
  const displayThresholdType = (value) => {
    if (!isEnglish) return value;
    return (value || '')
      .replace('觉察阈', 'Detection threshold')
      .replace('识别阈', 'Recognition threshold');
  };

  const accessDate = new Date();
  const accessYear = accessDate.getFullYear();
  const accessDateText = accessDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const citationExampleText = `1. Odor thresholds were queried from FlavorThresholdDB v1.0. For each compound, the original source, measurement medium, and threshold unit were retained to ensure data traceability. Thresholds in water were primarily obtained from Van Gemert (2011), while aroma descriptors were cross-referenced against Fan and Xu (2020) and the FEMA Flavor Ingredient Library.

2. The odor thresholds and flavor profiles of these compounds were determined based on previous reports (Van Gemert, 2011; Fan and Xu, 2020; FEMA, ${accessYear}).

References:
Van Gemert, L. J. (2011). Flavour Thresholds (2nd ed.). Flavour or taste threshold values in water (Chapter 1).
Fan, W. L., & Xu, Y. (2020). Wine flavor chemistry. China Light Industry Press.
FEMA's Flavor Library. (${accessYear}). Flavor profile analysis. Retrieved from https://www.femaflavor.org/flavor-library. Accessed ${accessDateText}.`;

  useEffect(() => {
    const normalize = (str) => {
      return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    };

    Promise.all([
      fetch(`${import.meta.env.BASE_URL}aroma_data_merged.json`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}references.json`).then(res => res.json()),
      fetch(`${import.meta.env.BASE_URL}references_lookup.json`).then(res => res.json()).catch(() => ({})),
      fetch(`${import.meta.env.BASE_URL}book_flavor_chemistry_index.json`).then(res => res.json()).catch(() => ({ records: [] }))
    ])
      .then(([dataJson, refsJson, lookupJson, bookJson]) => {
        setData(dataJson);
        setReferences(refsJson);
        setRefsLookup(lookupJson);
        setBookIndex(bookJson.records || []);
        
        const normKeys = Object.keys(refsJson).map(k => ({
          original: k,
          normalized: normalize(k),
          fullText: refsJson[k]
        }));
        setNormRefsKeys(normKeys);
        
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to load data", err);
        setLoading(false);
      });
  }, []);

  const matchReference = (shortCitation) => {
    if (!shortCitation) return null;
    
    // Clean citation (remove 'et al.' etc)
    const cleanCitation = shortCitation.replace(/et\s+al\.?/gi, '').trim();
    const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    
    // Strategy 1: O(1) pre-computed lookup (highest precision)
    if (refsLookup && Object.keys(refsLookup).length > 0) {
      const normCite = normalize(shortCitation);
      if (refsLookup[normCite]) return refsLookup[normCite];
    }
    
    if (!normRefsKeys.length) return null;
    
    // Strategy 2: Scoring-based fuzzy match
    const yearMatches = [...cleanCitation.matchAll(/(18|19|20)\d{2}/g)];
    const years = yearMatches.map(m => m[0]);
    
    let mainAuthor = "";
    const vanDeMatch = cleanCitation.match(/^(Van|De|Von|Le|La|Du|Di)\s+([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\-]+)/i);
    const hyphenMatch = cleanCitation.match(/^([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+\-[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+)/);
    const simpleMatch = cleanCitation.match(/^([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\-]+)/);
    
    if (vanDeMatch) {
      // e.g. "Van Anrooij" wants "van anrooij" but our keys often have "ANROOIJ, A. VAN"
      mainAuthor = normalize(vanDeMatch[2]); 
    } else if (hyphenMatch) {
      mainAuthor = normalize(hyphenMatch[1]);
    } else if (simpleMatch) {
      mainAuthor = normalize(simpleMatch[1]);
    }
    if (!mainAuthor) return null;
    
    let secondAuthor = "";
    const ampMatch = cleanCitation.match(/[&\&]\s*([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\-]+)/);
    if (ampMatch) secondAuthor = normalize(ampMatch[1]);
    
    let bestMatch = null;
    let bestScore = 0;
    
    // Keep track of authors matched without year for fallback
    const authorOnlyMatches = [];
    
    for (const refItem of normRefsKeys) {
      let score = 0;
      const normKey = refItem.normalized;
      
      let authorFound = false;
      if (vanDeMatch) {
        const prefix = normalize(vanDeMatch[1]);
        const surname = normalize(vanDeMatch[2]);
        if (normKey.includes(surname) && normKey.includes(prefix)) {
          authorFound = true;
          score += 6;
        }
      } else if (normKey.startsWith(mainAuthor)) {
        authorFound = true;
        score += 10;
      } else if (normKey.includes(mainAuthor)) {
        authorFound = true;
        score += 5;
      }
      
      if (!authorFound) continue;
      
      authorOnlyMatches.push(refItem.fullText);
      
      if (years.length > 0) {
        const yearFound = years.some(y => normKey.includes(y));
        if (!yearFound) continue;
        score += 10;
      }
      
      if (secondAuthor && normKey.includes(secondAuthor)) {
        score += 5;
      }
      
      const yearSuffix = cleanCitation.match(/\((\d{4}[a-z]?)\)/);
      if (yearSuffix && normKey.includes(yearSuffix[1])) {
        score += 3;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = refItem.fullText;
      }
    }
    
    if (bestMatch && bestScore >= 15) return bestMatch; 
    
    // Strict fallback: If we couldn't match the year (or none provided), 
    // but the author is so unique they only appear in EXACTLY ONE reference in the entire PDF!
    if (authorOnlyMatches.length === 1) return authorOnlyMatches[0];
    
    return null;
  };

  const results = useMemo(() => {
    if (!data.length) return [];
    
    const mediaFilteredData = data.filter(item => selectedMedia.includes(item.medium));
    
    if (searchMode === 'single') {
      if (!deferredSingleQuery.trim()) return [];
      const q = deferredSingleQuery.toLowerCase().trim();
      return mediaFilteredData.filter(item => {
        const cas = (item.cas || "").toLowerCase();
        const en = (item.english_name || "").toLowerCase();
        const cn = (item.chinese_name || "").toLowerCase();
        if (exactMatch) {
          return cas === q || en === q || cn === q;
        } else {
          return cas.includes(q) || en.includes(q) || cn.includes(q);
        }
      });
    } else {
      if (!deferredBulkQuery.trim()) return [];
      const lines = deferredBulkQuery.split('\n').map(l => l.toLowerCase().trim()).filter(Boolean);
      if (!lines.length) return [];
      
      const matched = [];
      const addedKeys = new Set();
      
      lines.forEach(line => {
        // Find all records that match
        const matches = mediaFilteredData.filter(item => {
          const cas = (item.cas || "").toLowerCase();
          const en = (item.english_name || "").toLowerCase();
          const cn = (item.chinese_name || "").toLowerCase();
          if (exactMatch) {
            return cas === line || en === line || cn === line;
          } else {
            return cas === line || en === line || cn === line || cas.includes(line) || en.includes(line) || cn.includes(line);
          }
        });
        matches.forEach(m => {
          // Since a compound might have multiple records (Air, Water, etc.), we key by CAS + Medium
          const key = (m.cas || "") + (m.medium || "");
          if (!addedKeys.has(key)) {
            addedKeys.add(key);
            matched.push(m);
          }
        });
      });
      return matched;
    }
  }, [data, deferredSingleQuery, deferredBulkQuery, searchMode, selectedMedia, exactMatch]);

  useEffect(() => {
    if (!results.length) return;

    const uniqueCas = [...new Set(results.map(item => item.cas).filter(Boolean))].slice(0, 50);
    const missingCas = uniqueCas.filter(cas => !femaProfiles[cas]);
    if (!missingCas.length) return;

    let cancelled = false;
    missingCas.forEach(cas => {
      fetch(`${FEMA_API_URL}/fema?cas=${encodeURIComponent(cas)}`)
        .then(res => res.json())
        .then(profile => {
          if (cancelled) return;
          setFemaProfiles(prev => ({ ...prev, [cas]: profile }));
        })
        .catch(() => {
          if (cancelled) return;
          setFemaProfiles(prev => ({ ...prev, [cas]: { found: false, error: 'FEMA proxy unavailable' } }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [results, femaProfiles]);

  const bookResults = useMemo(() => {
    if (!includeBookResults) return [];
    if (!bookIndex.length) return [];

    const normalize = (value) => (value || "").toString().toLowerCase().trim();
    const queries = searchMode === 'single'
      ? [normalize(deferredSingleQuery)].filter(Boolean)
      : deferredBulkQuery.split('\n').map(normalize).filter(Boolean);

    if (!queries.length) return [];

    return bookIndex
      .map(item => {
        const text = normalize(item.text);
        const title = normalize(item.book_title);
        let score = 0;
        for (const q of queries) {
          if (!q) continue;
          if (title.includes(q)) score += 1;
          if (text.includes(q)) score += 5;
        }
        return { ...item, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.page - b.page || a.chunk - b.chunk)
      .slice(0, 20);
  }, [bookIndex, deferredSingleQuery, deferredBulkQuery, searchMode, includeBookResults]);

  const getFilterOrderIndex = (key) => {
    const index = filterOrder.indexOf(key);
    return index === -1 ? filterOrder.length : index;
  };

  const orderedResults = useMemo(() => {
    const mediumOrder = Object.fromEntries(
      filterOrder
        .filter(key => key.startsWith('medium:'))
        .map((key, index) => [key.replace('medium:', ''), index])
    );

    return results
      .map((item, index) => ({ item, index }))
      .sort((a, b) => {
        const mediumDelta = (mediumOrder[a.item.medium] ?? 99) - (mediumOrder[b.item.medium] ?? 99);
        return mediumDelta || a.index - b.index;
      })
      .map(({ item }) => item);
  }, [results, filterOrder]);

  const femaResults = useMemo(() => {
    if (!includeFlavorDescriptions) return [];
    const seenCas = new Set();
    return orderedResults
      .map(item => ({ item, profile: femaProfiles[item.cas] }))
      .filter(({ item, profile }) => {
        if (!profile || !profile.found || !item.cas || seenCas.has(item.cas)) return false;
        seenCas.add(item.cas);
        return true;
      });
  }, [orderedResults, femaProfiles, includeFlavorDescriptions]);

  const toggleMedium = (medium) => {
    setSelectedMedia(prev => 
      prev.includes(medium) 
        ? prev.filter(m => m !== medium)
        : [...prev, medium]
    );
  };

  const toggleThresholdType = (type) => {
    setSelectedThresholdTypes(prev =>
      prev.includes(type)
        ? prev.filter(t => t !== type)
        : [...prev, type]
    );
  };

  const moveFilterOption = (sourceKey, targetKey) => {
    if (!sourceKey || !targetKey || sourceKey === targetKey) return;
    setFilterOrder(prev => {
      const next = prev.filter(key => key !== sourceKey);
      const targetIndex = next.indexOf(targetKey);
      if (targetIndex === -1) return prev;
      next.splice(targetIndex, 0, sourceKey);
      return next;
    });
  };

  const handleFilterDragStart = (event, key) => {
    setDraggedFilterKey(key);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', key);
  };

  const handleFilterDrop = (event, targetKey) => {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData('text/plain') || draggedFilterKey;
    moveFilterOption(sourceKey, targetKey);
    setDraggedFilterKey(null);
  };

  const filterOptions = [
    ...['空气', '水', '其他介质'].map(medium => ({
      key: `medium:${medium}`,
      label: displayMedium(medium),
      active: selectedMedia.includes(medium),
      onClick: () => toggleMedium(medium),
      activeClass: 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-indigo-100/50',
      dotClass: medium === '空气' ? 'bg-sky-400' : medium === '水' ? 'bg-blue-400' : 'bg-emerald-400'
    })),
    {
      key: 'book',
      label: ui.bookResults,
      active: includeBookResults,
      onClick: () => setIncludeBookResults(prev => !prev),
      activeClass: 'bg-amber-50 border-amber-200 text-amber-700 shadow-amber-100/50',
      dotClass: 'bg-amber-400'
    },
    {
      key: 'flavor',
      label: ui.flavorDescriptions,
      active: includeFlavorDescriptions,
      onClick: () => setIncludeFlavorDescriptions(prev => !prev),
      activeClass: 'bg-blue-50 border-blue-200 text-blue-700 shadow-blue-100/50',
      dotClass: 'bg-blue-400'
    },
    ...[
      { code: 'd', label: isEnglish ? 'Detection threshold (d)' : '觉察阈 (d)' },
      { code: 'r', label: isEnglish ? 'Recognition threshold (r)' : '识别阈 (r)' }
    ].map(type => ({
      key: `threshold:${type.code}`,
      label: type.label,
      active: selectedThresholdTypes.includes(type.code),
      onClick: () => toggleThresholdType(type.code),
      activeClass: 'bg-rose-50 border-rose-200 text-rose-700 shadow-rose-100/50',
      dotClass: 'bg-rose-400'
    }))
  ].sort((a, b) => getFilterOrderIndex(a.key) - getFilterOrderIndex(b.key));

  const getThresholdTypeCode = (str) => {
    const match = (str || '').match(/^.+?\(\d{4}.*?\)\s*(?:([dr])\s+)?/);
    return match?.[1] || '';
  };

  const getFilteredThresholds = (item) => {
    const thresholds = item.threshold_data || [];
    if (selectedThresholdTypes.length === 0) return [];
    return thresholds
      .filter(th => {
        const code = getThresholdTypeCode(th);
        if (code) return selectedThresholdTypes.includes(code);
        return selectedThresholdTypes.length === 2;
      })
      .map((threshold, index) => ({ threshold, index }))
      .sort((a, b) => {
        const aCode = getThresholdTypeCode(a.threshold);
        const bCode = getThresholdTypeCode(b.threshold);
        const aOrder = aCode ? getFilterOrderIndex(`threshold:${aCode}`) : filterOrder.length;
        const bOrder = bCode ? getFilterOrderIndex(`threshold:${bCode}`) : filterOrder.length;
        return aOrder - bOrder || a.index - b.index;
      })
      .map(({ threshold }) => threshold);
  };

  const getActiveBookQueries = () => {
    const rawQueries = searchMode === 'single'
      ? [singleQuery]
      : bulkQuery.split('\n');
    return rawQueries
      .map(value => (value || '').toString().toLowerCase().replace(/\([^)]*\)/g, '').trim())
      .filter(value => value.length >= 2);
  };

  const getBookHitTags = (text) => {
    const source = (text || '').toString();
    const tags = [];
    if (/阈值|嗅阈|觉察阈|识别阈|threshold|mg\/|ng\/|μg\/|ug\//i.test(source)) tags.push(isEnglish ? 'Threshold' : '阈值');
    if (/酒|啤酒|白酒|葡萄酒|黄酒|果酒|酒精|乙醇/i.test(source)) tags.push(isEnglish ? 'Alcoholic beverages' : '酒类');
    return tags.length ? [...new Set(tags)] : [isEnglish ? 'Excerpt' : '片段'];
  };

  const sentenceIncludes = (sentence, patterns) => patterns.some(pattern => pattern.test(sentence));

  const splitBookSentences = (text) => {
    return (text || '')
      .toString()
      .replace(/\s+/g, ' ')
      .split(/(?<=[。；;！？?])\s*/)
      .map(s => s.trim())
      .filter(Boolean);
  };

  const getRelevantBookSentences = (sentences, queries) => {
    const normalizedQueries = (queries || []).filter(Boolean);
    if (!normalizedQueries.length) return sentences;

    const anchorIndexes = [];
    sentences.forEach((sentence, index) => {
      const lower = sentence.toLowerCase();
      if (normalizedQueries.some(query => lower.includes(query))) {
        anchorIndexes.push(index);
      }
    });

    if (!anchorIndexes.length) return sentences.slice(0, 4);

    const selected = new Set();
    anchorIndexes.forEach(index => {
      selected.add(index);
      for (let next = index + 1; next < Math.min(sentences.length, index + 4); next += 1) {
        if (/^\s*\d+\s*[\.、-]/.test(sentences[next]) && next !== index + 1) break;
        selected.add(next);
      }
      if (index > 0) selected.add(index - 1);
    });

    return [...selected].sort((a, b) => a - b).map(index => sentences[index]);
  };

  const getThresholdCategory = (line) => {
    if (/空气/i.test(line)) return isEnglish ? 'Thresholds - Air' : '阈值信息 - 空气';
    if (/酒精-水|乙醇|酒精|vol/i.test(line)) return isEnglish ? 'Thresholds - Ethanol/water' : '阈值信息 - 酒精/水体系';
    if (/啤酒/i.test(line)) return isEnglish ? 'Thresholds - Beer' : '阈值信息 - 啤酒';
    if (/葡萄酒|白葡萄酒|红葡萄酒/i.test(line)) return isEnglish ? 'Thresholds - Wine' : '阈值信息 - 葡萄酒';
    if (/水中|水溶液|水/i.test(line)) return isEnglish ? 'Thresholds - Water' : '阈值信息 - 水';
    return null;
  };

  const hasThresholdSignal = (line) =>
    /阈\s*值|嗅阈|觉察阈|识别阈|threshold|mg\/|ng\/|μg\/|ug\/|Rg\/L|g\/L/i.test(line);

  const splitThresholdEntries = (line) => {
    const clean = (line || '').toString().replace(/\s+/g, ' ').trim();
    if (!clean) return [];

    const markerRegex = /(空气中|水中|水溶液中?|[0-9.]+\s*%\s*vol\s*酒精-水溶液中?|[0-9.]+\s*%\s*酒精-水溶液中?|酒精-水溶液中?|啤酒中|白葡萄酒|红葡萄酒|葡萄酒中?|醋酸水溶液中?)/g;
    const matches = [...clean.matchAll(markerRegex)];
    if (!matches.length) {
      const title = getThresholdCategory(clean);
      return title && hasThresholdSignal(clean) ? [{ title, line: clean }] : [];
    }

    return matches
      .map((match, index) => {
        const start = match.index;
        const end = index + 1 < matches.length ? matches[index + 1].index : clean.length;
        const part = clean.slice(start, end).replace(/[；;，,\s]+$/, '').trim();
        const title = getThresholdCategory(part);
        return title && hasThresholdSignal(part) ? { title, line: part } : null;
      })
      .filter(Boolean);
  };

  const cleanBookLine = (line) => (line || '')
    .toString()
    .replace(/\s+/g, ' ')
    .replace(/阈\s+值/g, '阈值')
    .replace(/([0-9])\s*\.\s*([0-9])/g, '$1.$2')
    .trim();

  const shortenBookLine = (line, limit = 260) => {
    const clean = cleanBookLine(line);
    return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
  };

  const summarizeBookHit = (text, queries = []) => {
    const raw = (text || '').toString().replace(/\s+/g, ' ').trim();
    const sentences = splitBookSentences(raw);
    const relevant = getRelevantBookSentences(sentences, queries);

    const thresholdLines = relevant.filter(sentence =>
      /阈\s*值|嗅阈|觉察阈|识别阈|threshold|mg\/|ng\/|μg\/|ug\/|Rg\/L|g\/L/i.test(sentence)
    );
    const alcoholLines = relevant.filter(sentence =>
      /酒|啤酒|白酒|葡萄酒|黄酒|果酒/i.test(sentence) &&
      !/阈值|嗅阈|觉察阈|识别阈|threshold/i.test(sentence)
    );

    const thresholdGroups = new Map();
    thresholdLines.flatMap(line => splitThresholdEntries(line)).forEach(({ title, line }) => {
      if (!thresholdGroups.has(title)) thresholdGroups.set(title, []);
      thresholdGroups.get(title).push(cleanBookLine(line));
    });

    const groups = [
      ...[...thresholdGroups.entries()].map(([title, lines]) => ({ title, lines })),
    ];

    if (alcoholLines.length) {
      groups.push({
        title: isEnglish ? 'Applications in alcoholic beverages' : '酒类应用',
        lines: alcoholLines.map(line => cleanBookLine(line))
      });
    }

    return {
      excerpt: relevant.length ? shortenBookLine(relevant.join(' '), 260) : shortenBookLine(raw, 260),
      groups
    };
  };

  const formatDisplayCommonEnglishName = (value) => {
    const raw = (value || '').toString().replace(/\([^)]*\)/g, '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase().replace(/\s+/g, ' ');
    return lower.replace(/[A-Za-z]/, match => match.toUpperCase());
  };

  const exportCSV = () => {
    if (!results.length) return;
    
    const baseHeaders = ['序号', 'CAS号', '化合物中文名', '化合物英文名', '常用英文名', '检索介质', '文献来源', '阈值类型(d/r)', '阈值数值', '阈值单位', '风味分类', '风味描述'];
    const femaHeaders = ['FEMA名称', 'FEMA编号', 'FEMA风味描述', 'FEMA链接'];
    const bookHeaders = ['书籍来源', '书籍页码片段', '书籍分类', '书籍命中文本'];
    const headers = [
      ...baseHeaders,
      ...(includeFlavorDescriptions ? femaHeaders : []),
      ...(includeBookResults ? bookHeaders : [])
    ];
    const rows = [headers.join(',')];
    const formatCommonEnglishName = (value) => {
      const raw = (value || '').toString().replace(/\([^)]*\)/g, '').trim();
      if (!raw) return '';
      const lower = raw.toLowerCase().replace(/\s+/g, ' ');
      return lower.replace(/[A-Za-z]/, match => match.toUpperCase());
    };

    const csvCell = (value) => `"${(value || '').toString().replace(/"/g, '""')}"`;

    const classifyBookHit = (text) => {
      const source = (text || '').toString();
      const categories = [];
      if (/阈值|嗅阈|觉察阈|识别阈|threshold/i.test(source)) categories.push('阈值信息');
      if (/FEMA|CAS|RIp|RInp|RI\s|保留指数/i.test(source)) categories.push('定性信息');
      if (/香|气味|风味|呈|味|aroma|odor|flavo[u]?r/i.test(source)) categories.push('风味描述');
      if (/酒|啤酒|白酒|葡萄酒|黄酒|果酒/i.test(source)) categories.push('酒类应用');
      return categories.length ? [...new Set(categories)].join('; ') : '书籍片段';
    };

    const getBookMatchesForItem = (item, fema, commonName) => {
      if (!includeBookResults || !bookIndex.length) return [];
      const queries = [
        item.cas,
        item.chinese_name,
        item.english_name,
        commonName,
        fema?.name
      ]
        .map(value => (value || '').toString().toLowerCase().replace(/\([^)]*\)/g, '').trim())
        .filter(value => value.length >= 3);

      if (!queries.length) return [];

      return bookIndex
        .map(hit => {
          const text = (hit.text || '').toString().toLowerCase();
          let score = 0;
          queries.forEach(query => {
            if (!query) return;
            if (text.includes(query)) score += query === (item.cas || '').toLowerCase() ? 10 : 4;
          });
          return { ...hit, score };
        })
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score || a.page - b.page || a.chunk - b.chunk)
        .slice(0, 3);
    };
    
    orderedResults.forEach((item, index) => {
      const cas = `"${item.cas || ''}"`;
      const cn = `"${(item.chinese_name || '').replace(/"/g, '""')}"`;
      const en = `"${(item.english_name || '').replace(/"/g, '""')}"`;
      const medium = `"${item.medium || ''}"`;
      const unit = item.medium === '空气' ? '"mg/m³"' : '"mg/kg"';
      const flavorCats = `"${(item.flavor_categories || []).join('; ')}"` ;
      const flavorDesc = `"${(item.flavor_desc_cn || []).join('; ')}"` ;
      const fema = femaProfiles[item.cas] || {};
      const femaName = `"${(fema.name || '').replace(/"/g, '""')}"`;
      const femaNumber = `"${(fema.fema_number || '').replace(/"/g, '""')}"`;
      const femaFlavor = `"${(fema.flavor_profile || '').replace(/"/g, '""')}"`;
      const femaUrl = `"${(fema.url || '').replace(/"/g, '""')}"`;
      const commonEnglishNameText = formatCommonEnglishName(fema.name || item.english_name);
      const commonEnglishName = csvCell(commonEnglishNameText);
      const bookMatches = getBookMatchesForItem(item, fema, commonEnglishNameText);
      const bookSource = csvCell(bookMatches.length ? '酒类风味化学' : '');
      const bookPageChunks = csvCell(bookMatches.map(hit => `第 ${hit.page} 页 / 片段 ${hit.chunk}`).join('\n'));
      const bookCategories = csvCell([...new Set(bookMatches.map(hit => classifyBookHit(hit.text)))].join('; '));
      const bookTexts = csvCell(bookMatches.map(hit => `[第 ${hit.page} 页 / 片段 ${hit.chunk}] ${hit.text}`).join('\n\n'));

      const thresholds = getFilteredThresholds(item);
      if (thresholds.length === 0) {
        const baseRow = [index + 1, cas, cn, en, commonEnglishName, medium, '""', '""', '""', unit, flavorCats, flavorDesc];
        rows.push([
          ...baseRow,
          ...(includeFlavorDescriptions ? [femaName, femaNumber, femaFlavor, femaUrl] : []),
          ...(includeBookResults ? [bookSource, bookPageChunks, bookCategories, bookTexts] : [])
        ].join(','));
      } else {
        thresholds.forEach((thStr, tIdx) => {
          const parsed = parseThresholdStr(thStr);
          // Only show index on the first row of the compound
          rows.push([
            tIdx === 0 ? index + 1 : "",
            tIdx === 0 ? cas : '""',
            tIdx === 0 ? cn : '""',
            tIdx === 0 ? en : '""',
            tIdx === 0 ? commonEnglishName : '""',
            tIdx === 0 ? medium : '""',
            `"${parsed.author.replace(/"/g, '""')}"`,
            `"${parsed.type.replace(/"/g, '""')}"`,
            `"${parsed.value.replace(/"/g, '""')}"`,
            unit,
            tIdx === 0 ? flavorCats : '""',
            tIdx === 0 ? flavorDesc : '""',
            ...(includeFlavorDescriptions ? [
              tIdx === 0 ? femaName : '""',
              tIdx === 0 ? femaNumber : '""',
              tIdx === 0 ? femaFlavor : '""',
              tIdx === 0 ? femaUrl : '""'
            ] : []),
            ...(includeBookResults ? [
              tIdx === 0 ? bookSource : '""',
              tIdx === 0 ? bookPageChunks : '""',
              tIdx === 0 ? bookCategories : '""',
              tIdx === 0 ? bookTexts : '""'
            ] : [])
          ].join(','));
        });
      }
    });

    const csvContent = "\uFEFF" + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${isEnglish ? 'odor_threshold_export' : '香气阈值查询导出'}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        const extractedValues = [];
        jsonData.forEach(row => {
          if (Array.isArray(row)) {
            row.forEach(cell => {
              if (cell !== undefined && cell !== null && cell.toString().trim() !== '') {
                extractedValues.push(cell.toString().trim());
              }
            });
          }
        });
        
        if (extractedValues.length > 0) {
          const newLines = extractedValues.join('\n');
          setBulkQuery(prev => prev ? prev + '\n' + newLines : newLines);
        }
      } catch (err) {
        console.error("Error reading file:", err);
        alert(isEnglish
          ? 'The file could not be parsed. Please provide a valid CSV or Excel file.'
          : '无法解析该文件，请确保它是有效的 CSV 或 Excel 格式。');
      }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = null;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 text-slate-800 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto flex flex-col">
        
        {/* Header Section */}
        <header className="relative mb-10 text-center">
          <div className="relative z-30 flex justify-center md:absolute md:right-0 md:top-0 mb-5 md:mb-0 pointer-events-auto">
            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white/90 p-1 shadow-sm" aria-label={isEnglish ? 'Interface language' : '界面语言'}>
              <button
                type="button"
                onClick={() => setInterfaceLanguage('zh')}
                className={`relative z-40 min-h-9 px-4 py-2 rounded-md text-sm font-semibold cursor-pointer select-none transition-colors ${
                  interfaceLanguage === 'zh'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-blue-700'
                }`}
              >
                中文
              </button>
              <button
                type="button"
                onClick={() => setInterfaceLanguage('en')}
                className={`relative z-40 min-h-9 px-4 py-2 rounded-md text-sm font-semibold cursor-pointer select-none transition-colors ${
                  interfaceLanguage === 'en'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:text-blue-700'
                }`}
              >
                English
              </button>
            </div>
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 mb-4 tracking-tight drop-shadow-sm">
            {interfaceLanguage === 'zh' ? '香气阈值与风味描述检索库' : 'FlavorThresholdDB'}
          </h1>
          <p className="text-slate-500 text-base lg:text-lg max-w-4xl mx-auto mb-5 leading-relaxed text-balance">
            {interfaceLanguage === 'zh'
              ? '整合权威文献与专业数据库中的香气阈值及风味描述信息，支持 CAS 号、中文名和英文名单物质检索及批量清单匹配。'
              : 'Integrates aroma threshold and flavor profile data from authoritative literature and specialized databases, supporting substance searches—and batch list matching—via CAS numbers, Chinese names, and English names.'}
          </p>
          <div className="mx-auto max-w-5xl text-left">
            <div className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 bg-amber-50/80 rounded-xl border border-amber-200/60 text-amber-700 text-sm font-medium shadow-sm">
              <div className="flex items-start flex-1 min-w-0">
                <Info className="w-4 h-4 mr-2 flex-shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  {interfaceLanguage === 'zh' ? (
                    <>
                      FlavorThresholdDB 整合 Van Gemert（2011）、范文来与徐岩（2020）以及 FEMA Flavor Ingredient Library 中的香气阈值与风味描述信息。仅供个人学习与交流使用，不得用于商业用途；转载或分享时请注明来源。
                    </>
                  ) : (
                    <>
                      FlavorThresholdDB integrates odor threshold and flavor descriptor information from Van Gemert (2011), Fan and Xu (2020), and the FEMA Flavor Ingredient Library. For personal study and exchange only; not for commercial use. Please cite the source if reposting or sharing.
                    </>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowCitationExample(prev => !prev)}
                className="self-end md:self-center inline-flex flex-shrink-0 items-center justify-center px-3 py-2 rounded-lg bg-white/75 hover:bg-white text-amber-700 border border-amber-200 shadow-sm transition-colors text-sm font-semibold"
              >
                <FileText className="w-4 h-4 mr-2" />
                {interfaceLanguage === 'zh' ? '引用示例' : 'Citation example'}
                <span className="ml-2 text-xs text-amber-500">
                  {showCitationExample
                    ? (interfaceLanguage === 'zh' ? '收起' : 'Hide')
                    : (interfaceLanguage === 'zh' ? '展开' : 'Show')}
                </span>
              </button>
            </div>
            {showCitationExample && (
              <div className="mt-3 rounded-2xl border border-blue-100 bg-white/85 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-4 py-3 bg-blue-50/70 border-b border-blue-100">
                  <div className="text-sm font-bold text-slate-700">
                    {interfaceLanguage === 'zh' ? '论文写作引用示例' : 'Citation examples for academic writing'}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(citationExampleText);
                      setCitationCopied(true);
                      setTimeout(() => setCitationCopied(false), 2000);
                    }}
                    className={`inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-bold transition-all ${
                      citationCopied
                        ? 'bg-emerald-500 text-white'
                        : 'bg-blue-600 hover:bg-blue-700 text-white'
                    }`}
                  >
                    {citationCopied ? (
                      <>
                        <Check className="w-4 h-4 mr-1.5" />
                        {interfaceLanguage === 'zh' ? '已复制' : 'Copied'}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1.5" />
                        {interfaceLanguage === 'zh' ? '复制' : 'Copy'}
                      </>
                    )}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap px-4 py-4 text-sm leading-7 text-slate-700 font-serif bg-white">
                  {citationExampleText}
                </pre>
              </div>
            )}
          </div>
          {loading && (
            <div className="flex items-center justify-center mt-6 text-blue-500 bg-blue-50 py-2 px-4 rounded-full inline-flex mx-auto shadow-sm border border-blue-100">
              <Loader2 className="animate-spin mr-2 h-5 w-5" />
              <span className="font-medium">{ui.loading}</span>
            </div>
          )}
        </header>

        {/* Search Controls */}
        <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/40 p-6 md:p-8 mb-8 transition-all">
          
          <div className="flex flex-wrap items-center justify-between gap-4 mb-8 border-b border-slate-200 pb-4">
            <div className="flex flex-wrap gap-4">
              <button 
                onClick={() => setSearchMode('single')}
                className={`flex items-center px-6 py-3 rounded-full font-semibold transition-all duration-300 ${searchMode === 'single' ? 'bg-blue-600 text-white shadow-md shadow-blue-200 translate-y-[-2px]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                <Search className="w-5 h-5 mr-2" />
                {ui.singleMode}
              </button>
              <button 
                onClick={() => setSearchMode('bulk')}
                className={`flex items-center px-6 py-3 rounded-full font-semibold transition-all duration-300 ${searchMode === 'bulk' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200 translate-y-[-2px]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
              >
                <List className="w-5 h-5 mr-2" />
                {ui.bulkMode}
              </button>
            </div>

            <div className="flex bg-slate-100 p-1.5 rounded-full shadow-inner border border-slate-200">
              <button 
                onClick={() => setExactMatch(true)}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm ${
                  exactMatch ? 'bg-white text-indigo-700 border border-slate-200/50' : 'text-slate-500 hover:text-slate-700 bg-transparent shadow-none border border-transparent'
                }`}
              >
                {ui.exact}
              </button>
              <button 
                onClick={() => setExactMatch(false)}
                className={`px-5 py-2 rounded-full text-sm font-bold transition-all shadow-sm ${
                  !exactMatch ? 'bg-white text-indigo-700 border border-slate-200/50' : 'text-slate-500 hover:text-slate-700 bg-transparent shadow-none border border-transparent'
                }`}
              >
                {ui.fuzzy}
              </button>
            </div>
          </div>

          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            {searchMode === 'single' ? (
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-5 flex items-center pointer-events-none">
                  <Search className="h-6 w-6 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-14 pr-4 py-4 md:text-lg bg-white border-2 border-slate-200 rounded-2xl focus:ring-0 focus:border-blue-500 transition-all shadow-inner placeholder:text-slate-400"
                  placeholder={isEnglish
                    ? `Enter a Chinese name, English name, or CAS number for an ${exactMatch ? 'exact' : 'fuzzy'} search (e.g., 64-19-7, acetic acid)`
                    : `输入化合物中文名、英文名或 CAS 号进行【${exactMatch ? '精确' : '模糊'}】检索 (例如: 64-19-7, 乙酸)`}
                  value={singleQuery}
                  onChange={(e) => setSingleQuery(e.target.value)}
                />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-slate-700 flex items-center">
                    <FileText className="w-4 h-4 mr-1 text-indigo-500" />
                    {ui.bulkLabel}
                  </label>
                  <div>
                    <input
                      type="file"
                      accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      id="file-upload"
                    />
                    <label 
                      htmlFor="file-upload" 
                      className="cursor-pointer text-xs flex items-center bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-200 transition-colors font-semibold"
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      {ui.importFile}
                    </label>
                  </div>
                </div>
                <textarea
                  className="block w-full p-5 md:text-lg bg-white border-2 border-slate-200 rounded-2xl focus:ring-0 focus:border-indigo-500 transition-all shadow-inner placeholder:text-slate-300 resize-y min-h-[160px] leading-relaxed"
                  placeholder={ui.bulkPlaceholder}
                  value={bulkQuery}
                  onChange={(e) => setBulkQuery(e.target.value)}
                ></textarea>
                <p className="mt-3 text-sm text-slate-500 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-1 opacity-70" />
                  {ui.bulkHelp}
                </p>
              </div>
            )}
          </div>

          {/* Medium Filter Controls */}
          <div className="mt-6 pt-6 border-t border-slate-100 animate-in fade-in duration-700">
            <span className="block text-sm font-semibold text-slate-600 mb-3">{ui.filters}</span>
            <div className="space-y-3">
              {[
                filterOptions.filter(option => !option.key.startsWith('threshold:')),
                filterOptions.filter(option => option.key.startsWith('threshold:'))
              ].map((optionGroup, groupIndex) => (
                <div key={groupIndex} className="flex flex-wrap gap-3">
                  {optionGroup.map(option => (
                    <button
                      key={option.key}
                      draggable
                      onDragStart={(event) => handleFilterDragStart(event, option.key)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => handleFilterDrop(event, option.key)}
                      onDragEnd={() => setDraggedFilterKey(null)}
                      onClick={option.onClick}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm border ${
                        option.active
                          ? option.activeClass
                          : 'bg-white border-slate-200 text-slate-400 hover:bg-slate-50'
                      } ${draggedFilterKey === option.key ? 'opacity-50 ring-2 ring-slate-300' : ''}`}
                      title={ui.dragTitle}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${option.active ? option.dotClass : 'bg-slate-200'}`} />
                        {option.label}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results Section */}
        {!loading && (singleQuery.trim() || bulkQuery.trim()) && (
          <div
            className="space-y-6 animate-in fade-in duration-500"
            style={{ order: 20 + Math.min(...['medium:空气', 'medium:水', 'medium:其他介质'].map(getFilterOrderIndex)) }}
          >
            <div className="flex items-center justify-between mb-4 px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.results}
                <span className="ml-3 text-sm font-medium bg-blue-100 text-blue-700 py-1 px-3 rounded-full">
                  {isEnglish ? `${results.length} ${ui.found}` : `共找到 ${results.length} ${ui.found}`}
                </span>
              </h2>
              
              {results.length > 0 && (
                <button 
                  onClick={exportCSV}
                  className="flex items-center px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-xl transition-all shadow-lg hover:shadow-green-500/30 transform hover:-translate-y-1"
                >
                  <FileSpreadsheet className="w-4 h-4 mr-2" />
                  {ui.exportCsv}
                </button>
              )}
            </div>

            {results.length === 0 ? (
              <div className="bg-white rounded-3xl p-12 text-center shadow-sm border border-slate-100">
                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-xl font-semibold text-slate-600 mb-2">{ui.noResults}</h3>
                <p className="text-slate-400">{ui.noResultsHelp}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {orderedResults.map((item, idx) => (
                  <div key={`${item.cas}-${item.medium}-${idx}`} className="bg-white rounded-2xl shadow-sm hover:shadow-xl border border-slate-100 p-6 md:p-8 transition-all duration-300 group">
                    <div className="flex flex-col md:flex-row md:items-start justify-between mb-6 border-b border-slate-100 pb-6">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-2xl font-bold text-slate-800">{item.chinese_name || item.english_name}</h3>
                          <span className="bg-slate-100 text-slate-600 text-sm font-mono px-3 py-1.5 rounded-md border border-slate-200">
                            CAS: {item.cas}
                          </span>
                        </div>
                        {formatDisplayCommonEnglishName((femaProfiles[item.cas] || {}).name || item.english_name) && (
                          <p className="text-slate-700 font-semibold">
                            {formatDisplayCommonEnglishName((femaProfiles[item.cas] || {}).name || item.english_name)}
                          </p>
                        )}
                        {item.chinese_name && (
                          <p className="text-slate-500 font-medium mt-1">{item.english_name}</p>
                        )}
                      </div>
                      
                      <div className="mt-4 md:mt-0 flex shrink-0">
                        <span className={`inline-flex items-center px-4 py-1.5 rounded-full text-sm font-bold shadow-sm ${item.medium === '空气' ? 'bg-sky-100 text-sky-700 border border-sky-200' : item.medium === '水' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-emerald-100 text-emerald-700 border border-emerald-200'}`}>
                          {ui.medium}: {displayMedium(item.medium)}
                        </span>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 group-hover:bg-blue-50/30 transition-colors">
                      <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center">
                        <Info className="w-4 h-4 mr-2" />
                        {ui.thresholdRecords}
                      </h4>
                      {getFilteredThresholds(item).length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse min-w-max">
                            <thead>
                              <tr className="bg-slate-200/50 text-slate-500 text-xs uppercase tracking-wider">
                                <th className="px-3 py-2 rounded-l-lg font-medium">{ui.source}</th>
                                <th className="px-3 py-2 font-medium">{ui.thresholdType}</th>
                                <th className="px-3 py-2 rounded-r-lg font-medium">{ui.threshold} ({item.medium === '空气' ? 'mg/m³' : 'mg/kg'})</th>
                              </tr>
                            </thead>
                            <tbody className="text-sm">
                              {getFilteredThresholds(item).map((th, idx) => {
                                const parsed = parseThresholdStr(th);
                                return (
                                  <tr key={idx} className="border-b border-slate-200/60 last:border-0 hover:bg-slate-100 transition-colors">
                                    <td className="px-3 py-2.5 text-slate-700 font-medium">
                                      {(() => {
                                        const fullRef = matchReference(parsed.author);
                                        if (fullRef) {
                                          return (
                                            <button 
                                              onClick={() => setSelectedRef({ author: parsed.author, text: fullRef })}
                                              className="group inline-flex items-center text-left"
                                              aria-label={isEnglish ? 'View full reference' : '查看完整文献'}
                                            >
                                              <span className="border-b border-dashed border-blue-400 text-blue-600 group-hover:text-blue-800 transition-colors">
                                                {parsed.author}
                                              </span>
                                              <Info className="w-3.5 h-3.5 ml-1.5 text-blue-400 group-hover:text-blue-600 opacity-70" />
                                            </button>
                                          );
                                        }
                                        return parsed.author;
                                      })()}
                                    </td>
                                    <td className="px-3 py-2.5 text-slate-500">{displayThresholdType(parsed.type)}</td>
                                    <td className="px-3 py-2.5 text-blue-600 font-mono tracking-tight">{parsed.value}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400 py-2">{ui.noThresholds}</div>
                      )}
                    </div>

                    {/* Flavor Profile Section */}
                    {item.flavor_categories && item.flavor_categories.length > 0 && (
                      <div className="mt-5 p-4 bg-gradient-to-r from-amber-50/80 to-orange-50/50 rounded-xl border border-amber-100/60">
                        <h4 className="text-sm font-semibold text-amber-700 uppercase tracking-wider mb-3 flex items-center">
                          {ui.flavorClassification}
                        </h4>
                        <div className="flex flex-wrap gap-2 mb-3">
                          {item.flavor_categories.map((cat, ci) => (
                            <span key={ci} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-white shadow-sm border border-amber-200 text-amber-800">
                              {cat}
                            </span>
                          ))}
                        </div>
                        {item.flavor_desc_cn && item.flavor_desc_cn.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.flavor_desc_cn.map((desc, di) => (
                              <span key={di} className="text-xs px-2 py-0.5 bg-amber-100/60 text-amber-600 rounded-md">
                                {desc}
                              </span>
                            ))}
                            <span className="text-xs text-slate-400 ml-1 self-center">({ui.flavorSource})</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* External Database Search Links */}
                    <div className="mt-5 pt-5 border-t border-slate-100 flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest mr-2 flex items-center">
                        <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                        {ui.externalLinks}
                      </span>
                      <a
                        href={`https://www.google.com/search?q=site:thegoodscentscompany.com+"${item.cas}"`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center px-3 py-1.5 bg-slate-50 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-lg text-xs font-medium border border-slate-200 hover:border-rose-200 transition-colors"
                      >
                        The Good Scents Company
                      </a>
                      <a
                        href={`https://www.femaflavor.org/flavor-library?cas=${item.cas}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center px-3 py-1.5 bg-slate-50 hover:bg-amber-50 text-slate-600 hover:text-amber-600 rounded-lg text-xs font-medium border border-slate-200 hover:border-amber-200 transition-colors"
                      >
                        FEMA Flavor
                      </a>
                      <a
                        href={`https://www.google.com/search?q=site:perflavory.com+"${item.cas}"`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center px-3 py-1.5 bg-slate-50 hover:bg-purple-50 text-slate-600 hover:text-purple-600 rounded-lg text-xs font-medium border border-slate-200 hover:border-purple-200 transition-colors"
                      >
                        Perflavory
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && (singleQuery.trim() || bulkQuery.trim()) && femaResults.length > 0 && (
          <div
            className="mt-8 space-y-4 animate-in fade-in duration-500"
            style={{ order: 20 + getFilterOrderIndex('flavor') }}
          >
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.flavorDescriptions}
                <span className="ml-3 text-sm font-medium bg-blue-100 text-blue-700 py-1 px-3 rounded-full">
                  FEMA Flavor Library {femaResults.length} {isEnglish ? 'records' : '条'}
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {femaResults.map(({ item, profile }) => (
                <div key={`fema-${item.cas}`} className="bg-white rounded-2xl shadow-sm border border-blue-100 overflow-hidden">
                  <div className="px-5 md:px-6 py-4 bg-blue-50/70 border-b border-blue-100 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-bold text-slate-800">{item.chinese_name || item.english_name}</h3>
                        <span className="inline-flex items-center px-3 py-1 rounded-lg text-sm font-semibold bg-white text-slate-600 border border-blue-100">
                          CAS: {item.cas}
                        </span>
                      </div>
                      {formatDisplayCommonEnglishName(profile.name || item.english_name) && (
                        <p className="mt-1 text-slate-700 font-semibold">
                          {formatDisplayCommonEnglishName(profile.name || item.english_name)}
                        </p>
                      )}
                    </div>
                    <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-bold bg-white text-blue-700 border border-blue-100">
                      FEMA No. {profile.fema_number || '-'}
                    </span>
                  </div>

                  <div className="p-5 md:p-6">
                    <div className="border border-blue-100 rounded-xl p-4 bg-blue-50/40">
                      <h4 className="text-sm font-semibold text-blue-700 uppercase tracking-wider mb-2 flex items-center">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        FEMA Flavor Library
                      </h4>
                      <div className="text-[15px] leading-7 text-slate-700">
                        <span className="font-semibold text-slate-600">Flavor Profile: </span>
                        <span>{profile.flavor_profile || 'No flavor profile returned'}</span>
                      </div>
                      {profile.url && (
                        <a
                          href={profile.url}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center text-sm font-semibold text-blue-700 hover:text-blue-800"
                        >
                          {ui.openFema}
                          <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && (singleQuery.trim() || bulkQuery.trim()) && bookResults.length > 0 && (
          <div
            className="mt-8 space-y-4 animate-in fade-in duration-500"
            style={{ order: 20 + getFilterOrderIndex('book') }}
          >
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.bookResults}
                <span className="ml-3 text-sm font-medium bg-amber-100 text-amber-700 py-1 px-3 rounded-full">
                  {isEnglish ? 'Wine Flavor Chemistry' : '酒类风味化学'} {bookResults.length} {isEnglish ? 'records' : '条'}
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {bookResults.map((item) => {
                const summary = summarizeBookHit(item.text, getActiveBookQueries());
                const tags = getBookHitTags(item.text);
                return (
                  <div key={item.id} className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden">
                    <div className="px-5 md:px-6 py-4 bg-amber-50/60 border-b border-amber-100 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-white text-amber-700 border border-amber-200">
                          {isEnglish ? 'Wine Flavor Chemistry' : item.book_title}
                        </span>
                        <span className="text-sm font-semibold text-slate-600">
                          {ui.pageChunk(item.page, item.chunk)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tags.map(tag => (
                          <span key={tag} className="px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-100 text-amber-700">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-5 md:p-6 space-y-4">
                      {summary.groups.length === 0 && (
                        <div className="text-[15px] leading-7 text-slate-700 bg-slate-50 border border-slate-100 rounded-xl p-4">
                          {summary.excerpt}
                        </div>
                      )}

                      {summary.groups.length > 0 && (
                        <div className="grid grid-cols-1 gap-3">
                          {summary.groups.map(group => (
                            <div key={group.title} className="border border-slate-100 rounded-xl p-4 bg-white">
                              <div className="text-sm font-bold text-slate-700 mb-2">{group.title}</div>
                              <ul className="space-y-2 text-sm leading-6 text-slate-600">
                                {group.lines.map((line, lineIdx) => (
                                  <li key={lineIdx} className="pl-3 border-l-2 border-amber-200">
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}

                      <details className="group">
                        <summary className="cursor-pointer text-sm font-semibold text-amber-700 hover:text-amber-800">
                          {ui.showOriginal}
                        </summary>
                        <div className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-slate-600 bg-slate-50 border border-slate-100 rounded-xl p-4">
                          {item.text}
                        </div>
                      </details>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* Reference Modal */}
      {selectedRef && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity" onClick={() => setSelectedRef(null)}></div>
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
              <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-500" />
                {ui.referenceDetails}
              </h3>
              <button 
                onClick={() => setSelectedRef(null)}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6">
              <div className="mb-4 inline-block px-3 py-1 bg-blue-50 text-blue-700 text-sm font-semibold rounded-lg border border-blue-100">
                {ui.citationIndex}: {selectedRef.author}
              </div>
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-slate-700 text-[15px] leading-relaxed font-serif whitespace-pre-wrap selection:bg-blue-200 max-h-[50vh] overflow-y-auto">
                {selectedRef.text}
              </div>
            </div>
            
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
              <button 
                onClick={() => {
                  navigator.clipboard.writeText(selectedRef.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className={`flex items-center px-6 py-2.5 rounded-xl font-bold transition-all duration-300 shadow-sm ${
                  copied 
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-200 scale-[1.02]' 
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-200 hover:-translate-y-0.5'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {ui.copied}
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-2" />
                    {ui.copyReference}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
