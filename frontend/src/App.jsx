import { useState, useEffect, useMemo, useRef, useDeferredValue } from 'react';
import { Search, FileSpreadsheet, List, FileText, Download, AlertCircle, Loader2, Info, Upload, ExternalLink, X, Copy, Check, ChevronDown, ChevronUp, FlaskConical, Mail, MessageCircle, Network, Database, ShieldCheck } from 'lucide-react';
import * as XLSX from 'xlsx';
import './App.css';
import SearchInsights from './components/SearchInsights';
import PubChemStructureViewer from './components/PubChemStructureViewer';
import { recordCompoundSearch } from './lib/supabase';
import { classifyCompoundBySmarts } from './lib/compoundClassification';

const FEMA_API_URL = (import.meta.env.VITE_FEMA_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const APP_BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');
const SEARCH_PATH = `${APP_BASE_PATH}/aroma-threshold/`;

const getViewFromLocation = () => (
  window.location.pathname.replace(/\/+$/, '').endsWith('/aroma-threshold') || window.location.hash === '#search'
    ? 'search'
    : 'home'
);

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

const getThresholdYear = (threshold) => {
  const years = (threshold || '').match(/\b(?:18|19|20)\d{2}[a-z]?\b/gi) || [];
  return years.reduce((latest, value) => Math.max(latest, Number.parseInt(value, 10) || 0), 0);
};

const getThresholdNumericValue = (threshold) => {
  const value = parseThresholdStr(threshold).value.replace(/,/g, '');
  const match = value.match(/(?:\d+(?:\.\d+)?|\.\d+)(?:\s*[eE][+-]?\d+)?/);
  return match ? Number.parseFloat(match[0].replace(/\s+/g, '')) : Number.POSITIVE_INFINITY;
};

const splitDescriptorValues = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap(item => (item || '').toString().split(/[,;|]/))
    .map(item => item.trim())
    .filter(Boolean);
};

const groupFlavorDescriptors = (fema, flavordb) => {
  const normalize = value => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const flavorDbDescriptors = flavordb?.found
    ? [
        ...splitDescriptorValues(flavordb.flavor_profile),
        ...splitDescriptorValues(flavordb.odor),
        ...splitDescriptorValues(flavordb.taste)
      ]
    : [];
  const flavorDbTerms = new Set(flavorDbDescriptors.map(normalize));
  const femaDescriptors = fema?.found
    ? splitDescriptorValues(fema.flavor_profile).filter(label => !flavorDbTerms.has(normalize(label)))
    : [];

  return [
    { key: 'fema', label: 'FEMA', descriptors: femaDescriptors },
    { key: 'flavordb', label: 'FlavorDB', descriptors: flavorDbDescriptors }
  ].filter(group => group.descriptors.length > 0);
};

const MatchModeControl = ({ exactMatch, onChange, isEnglish, compact = false }) => (
  <div className={`match-mode-control${compact ? ' compact' : ''}`} role="group" aria-label={isEnglish ? 'Matching method' : '匹配方式'}>
    <button type="button" className={exactMatch ? 'active' : ''} aria-pressed={exactMatch} onClick={() => onChange(true)}>
      {isEnglish ? 'Exact' : '精确'}
    </button>
    <button type="button" className={!exactMatch ? 'active' : ''} aria-pressed={!exactMatch} onClick={() => onChange(false)}>
      {isEnglish ? 'Fuzzy' : '模糊'}
    </button>
  </div>
);

export default function App() {
  const [currentView, setCurrentView] = useState(getViewFromLocation);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  
  const [searchMode, setSearchMode] = useState('single'); // 'single' or 'bulk'
  const [singleQuery, setSingleQuery] = useState('');
  const [bulkQuery, setBulkQuery] = useState('');
  const [selectedMedia, setSelectedMedia] = useState(['空气', '水', '其他介质']);
  const [includeBookResults, setIncludeBookResults] = useState(true);
  const [includeFlavorDescriptions, setIncludeFlavorDescriptions] = useState(true);
  const [includePubChem, setIncludePubChem] = useState(true);
  const [includeFlavorDB, setIncludeFlavorDB] = useState(true);
  const [selectedFlavorSources, setSelectedFlavorSources] = useState(['FEMA', 'FlavorDB']);
  const [selectedThresholdTypes, setSelectedThresholdTypes] = useState(['d', 'r']);
  const [filterOrder, setFilterOrder] = useState(['flavor', 'flavordb', 'pubchem', 'medium:水', 'medium:空气', 'medium:其他介质', 'book', 'threshold:d', 'threshold:r']);
  const [draggedFilterKey, setDraggedFilterKey] = useState(null);
  const [exactMatch, setExactMatch] = useState(true); // Default to exact match
  const fileInputRef = useRef(null);
  const trackedSearchesRef = useRef(new Set());
  const compoundProfilesRef = useRef({});

  // Use deferred values for smooth typing
  const deferredSingleQuery = useDeferredValue(singleQuery);
  const deferredBulkQuery = useDeferredValue(bulkQuery);
  
  const [normRefsKeys, setNormRefsKeys] = useState([]);
  const [selectedRef, setSelectedRef] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showCitationExample, setShowCitationExample] = useState(false);
  const [citationExpanded, setCitationExpanded] = useState(true);
  const [showContact, setShowContact] = useState(false);
  const [citationCopied, setCitationCopied] = useState(false);
  const [interfaceLanguage, setInterfaceLanguage] = useState('zh');
  const [refsLookup, setRefsLookup] = useState({});
  const [bookIndex, setBookIndex] = useState([]);
  const [femaProfiles, setFemaProfiles] = useState({});
  const [compoundProfiles, setCompoundProfiles] = useState({});
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const isEnglish = interfaceLanguage === 'en';

  useEffect(() => {
    document.documentElement.lang = isEnglish ? 'en' : 'zh-CN';
    document.title = isEnglish ? 'FlavorThresholdDB | HXQLab' : '香气阈值与风味描述检索库 | HXQLab';
  }, [isEnglish]);

  useEffect(() => {
    const syncViewWithLocation = () => setCurrentView(getViewFromLocation());
    window.addEventListener('popstate', syncViewWithLocation);
    window.addEventListener('hashchange', syncViewWithLocation);
    return () => {
      window.removeEventListener('popstate', syncViewWithLocation);
      window.removeEventListener('hashchange', syncViewWithLocation);
    };
  }, []);

  const openSearchView = () => {
    setCurrentView('search');
    window.history.pushState({ view: 'search' }, '', SEARCH_PATH);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openHomeView = () => {
    setCurrentView('home');
    setShowCitationExample(false);
    window.history.pushState({ view: 'home' }, '', `${APP_BASE_PATH}/`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const openDataSources = () => {
    setCurrentView('home');
    setShowCitationExample(true);
    setCitationExpanded(true);
    setShowContact(false);
    window.history.pushState({ view: 'home' }, '', `${APP_BASE_PATH}/`);
    window.setTimeout(() => {
      document.querySelector('.science-citation-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 0);
  };
  const ui = {
    loading: isEnglish ? 'Loading the local odor-threshold database...' : '正在解析本地阈值大数据库...',
    singleMode: isEnglish ? 'Single compound' : '单物质检索',
    bulkMode: isEnglish ? 'Batch matching' : '批量匹配',
    exact: isEnglish ? 'Exact search' : '精确检索',
    fuzzy: isEnglish ? 'Fuzzy search' : '模糊检索',
    bulkLabel: isEnglish ? 'Enter one substance per line' : '请输入需要匹配的物质名单（每行一个记录）',
    importFile: isEnglish ? 'Import CSV / Excel' : '导入 CSV / Excel 表格',
    bulkPlaceholder: isEnglish ? 'Enter one substance name or CAS number per line, or import a spreadsheet above...' : '每一行填写一个物质名称或 CAS 号，或者点击上方按钮导入表格...',
    bulkHelp: isEnglish ? 'Supports Chinese and English names, CAS numbers, and fuzzy matching.' : '支持中英文混排、支持 CAS 号与模糊匹配。直接提取出相关阈值记录结果。',
    filters: isEnglish ? 'Filters' : '筛选条件',
    chemicalInfo: isEnglish ? 'Chemical information' : '化学信息',
    dataScope: isEnglish ? 'Threshold data' : '阈值数据',
    thresholdScope: isEnglish ? 'Threshold type' : '阈值类型',
    searchLabel: isEnglish ? 'Compound name or CAS number' : '化合物名称或 CAS 号',
    liveSearchHelp: isEnglish ? 'Results update as you type.' : '输入内容后结果将自动更新。',
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
    flavorDescriptions: 'FEMA',
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
  const measurementMediaCount = new Set(data.map(item => item.medium).filter(Boolean)).size || 3;

  const accessDate = new Date();
  const accessYear = accessDate.getFullYear();
  const accessDateText = accessDate.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  const citationExampleText = `1. Odor thresholds were queried from FlavorThresholdDB v1.0. For each compound, the original source, measurement medium, and threshold unit were retained to ensure data traceability. Thresholds in water were primarily obtained from Van Gemert (2011), while aroma descriptors and chemical identifiers were cross-referenced against Fan and Xu (2020), the FEMA Flavor Ingredient Library, PubChem, and FlavorDB.

2. The odor thresholds, flavor profiles, and chemical identifiers of these compounds were determined based on previous reports and database records (Van Gemert, 2011; Fan and Xu, 2020; FEMA, ${accessYear}; PubChem, ${accessYear}; FlavorDB, ${accessYear}).

References:
Van Gemert, L. J. (2011). Flavour Thresholds (2nd ed.). Flavour or taste threshold values in water (Chapter 1).
Fan, W. L., & Xu, Y. (2020). Wine flavor chemistry. China Light Industry Press.
FEMA's Flavor Library. (${accessYear}). Flavor profile analysis. Retrieved from https://www.femaflavor.org/flavor-library. Accessed ${accessDateText}.
National Center for Biotechnology Information. (${accessYear}). PubChem. Retrieved from https://pubchem.ncbi.nlm.nih.gov/. Accessed ${accessDateText}.
FlavorDB. (${accessYear}). Flavor molecule database. Retrieved from https://cosylab.iiitd.edu.in/flavordb/. Accessed ${accessDateText}.`;

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
    const vanDeMatch = cleanCitation.match(/^(Van|De|Von|Le|La|Du|Di)\s+([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF-]+)/i);
    const hyphenMatch = cleanCitation.match(/^([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+-[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]+)/);
    const simpleMatch = cleanCitation.match(/^([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF-]+)/);
    
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
    const ampMatch = cleanCitation.match(/[&]\s*([a-zA-Z\u00C0-\u024F\u1E00-\u1EFF-]+)/);
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

  const queryMatchedResults = useMemo(() => {
    if (!data.length) return [];

    if (searchMode === 'single') {
      if (!deferredSingleQuery.trim()) return [];
      const q = deferredSingleQuery.toLowerCase().trim();
      return data.filter(item => {
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
        const matches = data.filter(item => {
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
  }, [data, deferredSingleQuery, deferredBulkQuery, searchMode, exactMatch]);

  const results = useMemo(
    () => queryMatchedResults.filter(item => selectedMedia.includes(item.medium)),
    [queryMatchedResults, selectedMedia]
  );

  useEffect(() => {
    if (!queryMatchedResults.length) return;

    const uniqueCas = [...new Set(queryMatchedResults.map(item => item.cas).filter(Boolean))].slice(0, 50);
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
  }, [queryMatchedResults, femaProfiles]);

  useEffect(() => {
    const limit = searchMode === 'single' ? 1 : 10;
    const uniqueCas = [...new Set(queryMatchedResults.map(item => item.cas).filter(Boolean))].slice(0, limit);
    const missingCas = uniqueCas.filter(cas => compoundProfilesRef.current[cas] === undefined);
    if (!missingCas.length) return undefined;

    setCompoundProfiles(prev => {
      const next = { ...prev };
      missingCas.forEach(cas => {
        const loadingProfile = { loading: true };
        next[cas] = loadingProfile;
        compoundProfilesRef.current[cas] = loadingProfile;
      });
      return next;
    });

    const loadProfiles = async () => {
      for (const cas of missingCas) {
        try {
          const response = await fetch(`${FEMA_API_URL}/compound?cas=${encodeURIComponent(cas)}`);
          if (!response.ok) throw new Error(`Compound lookup failed (${response.status})`);
          const profile = await response.json();
          const smartClassification = await classifyCompoundBySmarts(profile.pubchem?.smiles);
          profile.smart_classification = smartClassification;
          compoundProfilesRef.current[cas] = profile;
          setCompoundProfiles(prev => ({ ...prev, [cas]: profile }));
        } catch (error) {
          const failedProfile = { loading: false, error: error.message, pubchem: { found: false }, flavordb: { found: false } };
          compoundProfilesRef.current[cas] = failedProfile;
          setCompoundProfiles(prev => ({
            ...prev,
            [cas]: failedProfile,
          }));
        }
      }
    };
    loadProfiles();
    return undefined;
  }, [queryMatchedResults, searchMode]);

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
    return queryMatchedResults
      .map(item => ({ item, profile: femaProfiles[item.cas] }))
      .filter(({ item, profile }) => {
        if (!profile || !profile.found || !item.cas || seenCas.has(item.cas)) return false;
        seenCas.add(item.cas);
        return true;
      });
  }, [queryMatchedResults, femaProfiles, includeFlavorDescriptions]);

  const externalCompoundResults = useMemo(() => {
    const seenCas = new Set();
    return queryMatchedResults
      .map(item => ({ item, profile: compoundProfiles[item.cas] }))
      .filter(({ item, profile }) => {
        if (!item.cas || seenCas.has(item.cas) || !profile || profile.loading) return false;
        const hasPubChem = includePubChem && profile.pubchem?.found;
        const hasFlavorDB = includeFlavorDB && profile.flavordb?.found;
        if (!hasPubChem && !hasFlavorDB) return false;
        seenCas.add(item.cas);
        return true;
      });
  }, [queryMatchedResults, compoundProfiles, includePubChem, includeFlavorDB]);

  const integratedCompoundResults = useMemo(() => {
    const seenCas = new Set();
    return queryMatchedResults
      .map(item => ({
        item,
        fema: femaProfiles[item.cas] || {},
        profile: compoundProfiles[item.cas] || {}
      }))
      .filter(({ item, fema, profile }) => {
        if (!item.cas || seenCas.has(item.cas)) return false;
        const hasFema = includeFlavorDescriptions && fema.found;
        const hasPubChem = includePubChem && profile.pubchem?.found;
        const hasFlavorDB = includeFlavorDB && profile.flavordb?.found;
        if (!hasFema && !hasPubChem && !hasFlavorDB) return false;
        seenCas.add(item.cas);
        return true;
      });
  }, [queryMatchedResults, femaProfiles, compoundProfiles, includeFlavorDescriptions, includePubChem, includeFlavorDB]);

  useEffect(() => {
    if (!queryMatchedResults.length) return;
    const queryKey = searchMode === 'single'
      ? deferredSingleQuery.trim().toLowerCase()
      : deferredBulkQuery.trim().toLowerCase();
    if (!queryKey) return;

    const uniqueCompounds = [...new Map(
      queryMatchedResults.filter(item => item.cas).map(item => [item.cas, item])
    ).values()];

    uniqueCompounds.forEach(item => {
      const storageKey = `flavor-search:${queryKey}:${item.cas}`;
      if (sessionStorage.getItem(storageKey) || trackedSearchesRef.current.has(storageKey)) return;
      trackedSearchesRef.current.add(storageKey);
      const sourceName = (femaProfiles[item.cas] || {}).name || item.english_name || item.cas;
      const commonName = sourceName
        .toString()
        .replace(/\([^)]*\)/g, '')
        .trim()
        .toLowerCase()
        .replace(/[A-Za-z]/, match => match.toUpperCase());
      recordCompoundSearch({ cas: item.cas, commonName, chineseName: item.chinese_name })
        .then(recorded => {
          if (!recorded) {
            trackedSearchesRef.current.delete(storageKey);
            return;
          }
          sessionStorage.setItem(storageKey, '1');
          window.dispatchEvent(new CustomEvent('flavor-search-recorded'));
        })
        .catch(() => trackedSearchesRef.current.delete(storageKey));
    });
  }, [queryMatchedResults, deferredSingleQuery, deferredBulkQuery, searchMode, femaProfiles]);

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

  const toggleFlavorSource = (source) => {
    setSelectedFlavorSources(prev =>
      prev.includes(source)
        ? prev.filter(item => item !== source)
        : [...prev, source]
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
    {
      key: 'flavor',
      tone: 'flavor',
      group: 'chemical',
      label: ui.flavorDescriptions,
      active: includeFlavorDescriptions,
      onClick: () => setIncludeFlavorDescriptions(prev => !prev)
    },
    {
      key: 'pubchem',
      tone: 'pubchem',
      group: 'chemical',
      label: 'PubChem',
      active: includePubChem,
      onClick: () => setIncludePubChem(prev => !prev)
    },
    {
      key: 'flavordb',
      tone: 'flavordb',
      group: 'chemical',
      label: 'FlavorDB',
      active: includeFlavorDB,
      onClick: () => setIncludeFlavorDB(prev => !prev)
    },
    ...['空气', '水', '其他介质'].map((medium, index) => ({
      key: `medium:${medium}`,
      tone: ['air', 'water', 'other'][index],
      group: 'data',
      label: displayMedium(medium),
      active: selectedMedia.includes(medium),
      onClick: () => toggleMedium(medium)
    })),
    {
      key: 'book',
      tone: 'book',
      group: 'data',
      label: ui.bookResults,
      active: includeBookResults,
      onClick: () => setIncludeBookResults(prev => !prev)
    },
    ...[
      { code: 'd', label: isEnglish ? 'Detection threshold (d)' : '觉察阈 (d)' },
      { code: 'r', label: isEnglish ? 'Recognition threshold (r)' : '识别阈 (r)' }
    ].map(type => ({
      key: `threshold:${type.code}`,
      tone: type.code === 'd' ? 'detection' : 'recognition',
      group: 'threshold',
      label: type.label,
      active: selectedThresholdTypes.includes(type.code),
      onClick: () => toggleThresholdType(type.code)
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
        const yearOrder = getThresholdYear(b.threshold) - getThresholdYear(a.threshold);
        if (yearOrder) return yearOrder;
        const valueOrder = getThresholdNumericValue(a.threshold) - getThresholdNumericValue(b.threshold);
        if (valueOrder) return valueOrder;
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
        if (/^\s*\d+\s*[.、-]/.test(sentences[next]) && next !== index + 1) break;
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

  const exportCSV = (exportMode) => {
    if (!results.length) return;
    
    const headers = [
      '序号',
      'CAS号',
      '化合物中文名',
      '常用英文名',
      ...(includeFlavorDB ? ['主要官能团', 'FlavorDB CID', 'FlavorDB风味描述', 'FlavorDB链接'] : []),
      ...(includePubChem ? [
        '主要化合物类别',
        'SMARTS命中',
        '分子式',
        '分子量',
        'IUPAC',
        'XLogP',
        'TPSA',
        'HBD',
        'HBA',
        'SMILES',
        'PubChem CID',
        'PubChem链接'
      ] : []),
      '检索介质',
      '文献来源',
      '阈值类型(d/r)',
      '阈值数值',
      '阈值单位',
      ...(includeFlavorDescriptions ? ['FEMA编号', 'FEMA风味描述', 'FEMA链接'] : []),
      ...(includeBookResults ? ['书籍来源', '书籍页码片段', '书籍分类', '书籍命中文本'] : [])
    ];
    const rows = [headers.join(',')];
    const formatCommonEnglishName = (value) => {
      const raw = (value || '').toString().replace(/\([^)]*\)/g, '').trim();
      if (!raw) return '';
      const lower = raw.toLowerCase().replace(/\s+/g, ' ');
      return lower.replace(/[A-Za-z]/, match => match.toUpperCase());
    };

    const csvCell = (value) => `"${(value ?? '').toString().replace(/"/g, '""')}"`;
    const csvCasCell = (value) => {
      const cas = (value || '').toString().trim();
      return /^\d{2,7}-\d{2}-\d$/.test(cas)
        ? `="${cas}"`
        : csvCell(cas);
    };
    const getThresholdUnit = medium => medium === '空气' ? 'mg/m3' : 'mg/kg';
    const downloadCsv = (csvRows, mode) => {
      const csvContent = "\uFEFF" + csvRows.join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const modeLabel = mode === 'compact'
        ? (isEnglish ? 'compact' : '精简版')
        : (isEnglish ? 'detailed' : '详细版');
      link.setAttribute('href', url);
      link.setAttribute('download', `${isEnglish ? 'odor_threshold_export' : '香气阈值查询导出'}_${modeLabel}_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setExportMenuOpen(false);
    };

    if (exportMode === 'compact') {
      const selectedMediaInOrder = filterOrder
        .filter(key => key.startsWith('medium:'))
        .map(key => key.replace('medium:', ''))
        .filter(medium => selectedMedia.includes(medium));
      const compactHeaders = [
        '序号',
        'CAS号',
        '化合物中文名',
        '常用英文名',
        '化合物类别',
        '分子式',
        'FEMA风味描述',
        ...selectedMediaInOrder.flatMap(medium => [
          `${medium}-文献来源`,
          `${medium}-阈值类型(d/r)`,
          `${medium}-阈值数值`,
          `${medium}-阈值单位`
        ])
      ];
      const compactRows = [compactHeaders.map(csvCell).join(',')];
      const compounds = new Map();

      orderedResults.forEach(item => {
        if (!compounds.has(item.cas)) compounds.set(item.cas, { item, media: new Map() });
        compounds.get(item.cas).media.set(item.medium, item);
      });

      [...compounds.values()].forEach(({ item, media }, index) => {
        const fema = femaProfiles[item.cas] || {};
        const profile = compoundProfiles[item.cas] || {};
        const pubchem = profile.pubchem || {};
        const primaryClass = profile.smart_classification || { zh: '其他类', en: 'Others' };
        const commonEnglishNameText = formatCommonEnglishName(fema.name || item.english_name);
        const thresholdCells = selectedMediaInOrder.flatMap(medium => {
          const mediumItem = media.get(medium);
          const firstThreshold = mediumItem ? getFilteredThresholds(mediumItem)[0] : '';
          const parsed = firstThreshold
            ? parseThresholdStr(firstThreshold)
            : { author: '', type: '', value: '' };
          return [
            csvCell(parsed.author),
            csvCell(parsed.type),
            csvCell(parsed.value),
            csvCell(firstThreshold ? getThresholdUnit(medium) : '')
          ];
        });

        compactRows.push([
          csvCell(index + 1),
          csvCasCell(item.cas),
          csvCell(item.chinese_name),
          csvCell(commonEnglishNameText),
          csvCell(isEnglish ? primaryClass.en : primaryClass.zh),
          csvCell(pubchem.molecular_formula),
          csvCell(splitDescriptorValues(fema.flavor_profile).join('; ')),
          ...thresholdCells
        ].join(','));
      });

      downloadCsv(compactRows, exportMode);
      return;
    }

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
    
    let detailedRowIndex = 0;
    orderedResults.forEach(item => {
      const fema = femaProfiles[item.cas] || {};
      const profile = compoundProfiles[item.cas] || {};
      const pubchem = profile.pubchem || {};
      const flavordb = profile.flavordb || {};
      const commonEnglishNameText = formatCommonEnglishName(fema.name || item.english_name);
      const bookMatches = getBookMatchesForItem(item, fema, commonEnglishNameText);
      const filteredThresholds = getFilteredThresholds(item);
      const thresholdRecords = filteredThresholds.length ? filteredThresholds : [''];
      const functionalGroups = flavordb.functional_groups || [];
      const primaryClass = profile.smart_classification || { zh: '其他类', en: 'Others' };

      thresholdRecords.forEach(threshold => {
        const parsed = threshold
          ? parseThresholdStr(threshold)
          : { author: '', type: '', value: '' };
        detailedRowIndex += 1;
        rows.push([
        detailedRowIndex,
        csvCasCell(item.cas),
        csvCell(item.chinese_name),
        csvCell(commonEnglishNameText),
        ...(includeFlavorDB ? [
          csvCell(functionalGroups.join('; ')),
          csvCell(flavordb.cid),
          csvCell([
            ...(flavordb.flavor_profile || []),
            ...(flavordb.odor || []),
            ...(flavordb.taste || [])
          ].join('; ')),
          csvCell(flavordb.url)
        ] : []),
        ...(includePubChem ? [
          csvCell(isEnglish ? primaryClass.en : primaryClass.zh),
          csvCell((primaryClass.matches || []).map(match => isEnglish ? match.en : match.zh).join('; ')),
          csvCell(pubchem.molecular_formula),
          csvCell(pubchem.molecular_weight),
          csvCell(pubchem.iupac_name),
          csvCell(pubchem.xlogp),
          csvCell(pubchem.tpsa),
          csvCell(pubchem.h_bond_donor_count),
          csvCell(pubchem.h_bond_acceptor_count),
          csvCell(pubchem.smiles),
          csvCell(pubchem.cid),
          csvCell(pubchem.url)
        ] : []),
        csvCell(item.medium),
        csvCell(parsed.author),
        csvCell(parsed.type),
        csvCell(parsed.value),
        csvCell(threshold ? getThresholdUnit(item.medium) : ''),
        ...(includeFlavorDescriptions ? [
          csvCell(fema.fema_number),
          csvCell(fema.flavor_profile),
          csvCell(fema.url)
        ] : []),
        ...(includeBookResults ? [
          csvCell(bookMatches.length ? '酒类风味化学' : ''),
          csvCell(bookMatches.map(hit => `第 ${hit.page} 页 / 片段 ${hit.chunk}`).join('\n')),
          csvCell([...new Set(bookMatches.map(hit => classifyBookHit(hit.text)))].join('; ')),
          csvCell(bookMatches.map(hit => `[第 ${hit.page} 页 / 片段 ${hit.chunk}] ${hit.text}`).join('\n\n'))
        ] : [])
        ].join(','));
      });
    });

    downloadCsv(rows, 'detailed');
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
    <div className={`app-shell ${currentView === 'home' ? 'home-view' : 'search-view'}`}>
      {currentView === 'home' && (
      <section className="science-hero">
        <div className="hero-inner">
          <nav className="science-nav" aria-label={isEnglish ? 'Primary navigation' : '主导航'}>
            <a href="#top" className="science-brand" aria-label="HXQLab">
              <span className="science-brand-mark"><Network className="w-6 h-6" /></span>
              <span className="science-brand-copy">
                <strong>HXQLab</strong>
              </span>
            </a>
            <div className="science-nav-links">
              <a href="#top" className={!showCitationExample && !showContact ? 'active' : ''} onClick={() => setShowCitationExample(false)}>{isEnglish ? 'Home' : '首页'}</a>
              <button type="button" onClick={openSearchView}>FlavorThresholdDB</button>
              <button type="button" className={showCitationExample && !showContact ? 'active' : ''} onClick={openDataSources}>
                {isEnglish ? 'Sources' : '数据来源'}
              </button>
              <button type="button" className={`science-contact-link ${showContact ? 'active' : ''}`} onClick={() => setShowContact(true)}>
                {isEnglish ? 'Contact' : '联系我们'}
              </button>
            </div>
            <button type="button" className="science-mobile-contact" onClick={() => setShowContact(true)} aria-label={isEnglish ? 'Contact' : '联系我们'}>
              <MessageCircle className="w-4 h-4" />
            </button>
            <div className="science-language" aria-label={isEnglish ? 'Interface language' : '界面语言'}>
              <button type="button" onClick={() => setInterfaceLanguage('zh')} aria-pressed={interfaceLanguage === 'zh'} className={interfaceLanguage === 'zh' ? 'active' : ''}>中</button>
              <button type="button" onClick={() => setInterfaceLanguage('en')} aria-pressed={interfaceLanguage === 'en'} className={interfaceLanguage === 'en' ? 'active' : ''}>EN</button>
            </div>
          </nav>

          <header id="top" className="science-hero-content">
            <h1>FlavorThresholdDB</h1>
            <p className="science-subtitle">
              {isEnglish ? 'An Integrated Flavor Threshold and Descriptor Retrieval Database' : '香气阈值与风味描述检索库'}
            </p>
            <p className="science-description">
              {isEnglish
                ? 'Integrates authoritative literature and specialized databases to provide traceable support for compound identification, OAV analysis, and standardized flavor annotation.'
                : '整合多来源香气阈值与风味描述数据，保留介质、单位、阈值类型及文献来源，为风味化合物注释与 OAV 分析提供可追溯的数据支持。'}
            </p>
            {!showCitationExample && (
              <>
                <div className="science-actions">
                  <button type="button" onClick={openSearchView} className="science-primary-action">
                    <Search className="w-5 h-5" />
                  {isEnglish ? 'Begin your flavor exploration' : '开启风味探索之旅'}
                  </button>
                </div>

                <div className="science-metrics" aria-label={isEnglish ? 'Platform coverage' : '平台数据覆盖'}>
                  <div>
                    <span className="science-metric-icon"><Database aria-hidden="true" /></span>
                    <span className="science-metric-copy"><strong>5</strong><span>{isEnglish ? 'integrated data sources' : '整合数据来源'}</span></span>
                  </div>
                  <div>
                    <span className="science-metric-icon"><FlaskConical aria-hidden="true" /></span>
                    <span className="science-metric-copy"><strong>{measurementMediaCount}</strong><span>{isEnglish ? 'threshold media categories' : '阈值介质分类'}</span></span>
                  </div>
                  <div>
                    <span className="science-metric-icon"><ShieldCheck aria-hidden="true" /></span>
                    <span className="science-metric-copy"><strong className="science-metric-word">{isEnglish ? 'Traceable' : '可追溯'}</strong><span>{isEnglish ? 'source records retained' : '保留来源记录'}</span></span>
                  </div>
                </div>
              </>
            )}

            {showCitationExample && (
              <div className="science-citation-panel">
                <div className="science-citation-header">
                  <span>{isEnglish ? 'Citation examples for academic writing' : '论文写作引用示例'}</span>
                  <div className="science-citation-controls">
                    <button
                      type="button"
                      onClick={() => setCitationExpanded(prev => !prev)}
                      aria-expanded={citationExpanded}
                    >
                      {citationExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      {citationExpanded ? (isEnglish ? 'Collapse' : '折叠') : (isEnglish ? 'Expand' : '展开')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(citationExampleText);
                        setCitationCopied(true);
                        setTimeout(() => setCitationCopied(false), 2000);
                      }}
                    >
                      {citationCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                      {citationCopied ? (isEnglish ? 'Copied' : '已复制') : (isEnglish ? 'Copy' : '复制')}
                    </button>
                  </div>
                </div>
                {citationExpanded && (
                  <div className="science-citation-content">
                    <div className="science-source-overview" aria-label={isEnglish ? 'Five core data sources' : '五项核心数据来源'}>
                      <div><span>{isEnglish ? 'Literature' : '文献'}</span><strong>Van Gemert (2011)</strong><strong>Fan & Xu (2020)</strong></div>
                      <div><span>{isEnglish ? 'Databases' : '数据库'}</span><strong>FEMA</strong><strong>PubChem</strong><strong>FlavorDB</strong></div>
                    </div>
                    <pre>{citationExampleText}</pre>
                  </div>
                )}
              </div>
            )}

            {loading && (
              <div className="science-loading">
                <Loader2 className="animate-spin w-4 h-4" />
                <span>{ui.loading}</span>
              </div>
            )}
          </header>
          {!showCitationExample && (
            <SearchInsights
              isEnglish={isEnglish}
              onSelect={item => {
                setSearchMode('single');
                setExactMatch(true);
                setSingleQuery(item.cas);
                openSearchView();
              }}
            />
          )}
          <footer className="science-author-footer">
            <strong>{isEnglish ? 'Author statement' : '作者申明'}</strong>
            <span>
              {isEnglish
                ? 'For personal study and academic exchange only. Commercial use is prohibited. Please cite the source when reposting or sharing.'
                : '仅供个人学习与交流使用，不得用于商业用途；转载或分享时请注明来源。'}
            </span>
          </footer>
        </div>
      </section>
      )}

      {currentView === 'search' && (
      <>
      <a className="skip-link" href="#main-content">{isEnglish ? 'Skip to search' : '跳到检索区域'}</a>
      <header className="search-page-header">
        <nav className="science-nav search-science-nav" aria-label={isEnglish ? 'Primary navigation' : '主导航'}>
          <button type="button" className="science-brand" onClick={openHomeView} aria-label="HXQLab home">
            <span className="science-brand-mark"><Network className="w-6 h-6" /></span>
            <span className="science-brand-copy"><strong>HXQLab</strong></span>
          </button>
          <div className="science-nav-links">
            <button type="button" onClick={openHomeView}>{isEnglish ? 'Home' : '首页'}</button>
            <button type="button" className={showContact ? '' : 'active'} onClick={openSearchView}>FlavorThresholdDB</button>
            <button type="button" onClick={openDataSources}>{isEnglish ? 'Sources' : '数据来源'}</button>
            <button type="button" className={`science-contact-link ${showContact ? 'active' : ''}`} onClick={() => setShowContact(true)}>{isEnglish ? 'Contact' : '联系我们'}</button>
          </div>
          <button type="button" className="science-mobile-contact" onClick={() => setShowContact(true)} aria-label={isEnglish ? 'Contact' : '联系我们'}>
            <MessageCircle className="w-4 h-4" />
          </button>
          <div className="science-language" aria-label={isEnglish ? 'Interface language' : '界面语言'}>
            <button type="button" onClick={() => setInterfaceLanguage('zh')} aria-pressed={interfaceLanguage === 'zh'} className={interfaceLanguage === 'zh' ? 'active' : ''}>中</button>
            <button type="button" onClick={() => setInterfaceLanguage('en')} aria-pressed={interfaceLanguage === 'en'} className={interfaceLanguage === 'en' ? 'active' : ''}>EN</button>
          </div>
        </nav>
        <div className="search-shell-content">
          <h1>{isEnglish ? 'Aroma threshold and flavor descriptor search' : '香气阈值与风味描述检索'}</h1>
          <p>{isEnglish ? 'Search thresholds, flavor descriptors, and source records.' : '检索阈值、风味描述与来源记录。'}</p>
        </div>
      </header>
      <main id="main-content" className="search-main relative z-20 mx-auto flex flex-col px-4 md:px-8 pb-10">
        {/* Search Controls */}
        <div id="search-workspace" className="science-workspace search-control-panel bg-white p-5 md:p-6 mb-8 scroll-mt-6">
          
          <div className="search-mode-toolbar">
            <div className="search-mode-tabs flex flex-wrap gap-4">
              <button 
                onClick={() => setSearchMode('single')}
                aria-pressed={searchMode === 'single'}
                className={searchMode === 'single' ? 'active' : ''}
              >
                <Search className="w-5 h-5 mr-2" />
                {ui.singleMode}
              </button>
              <button 
                onClick={() => setSearchMode('bulk')}
                aria-pressed={searchMode === 'bulk'}
                className={searchMode === 'bulk' ? 'active' : ''}
              >
                <List className="w-5 h-5 mr-2" />
                {ui.bulkMode}
              </button>
            </div>
            {results.length > 0 && (
              <div className="export-menu search-toolbar-export">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen(open => !open)}
                  className="result-export-button"
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  {ui.exportCsv}
                  <ChevronDown className={`w-4 h-4 export-menu-chevron${exportMenuOpen ? ' open' : ''}`} />
                </button>
                {exportMenuOpen && (
                  <div className="export-menu-popover" role="menu">
                    <button type="button" role="menuitem" onClick={() => exportCSV('compact')}>
                      <span>{isEnglish ? 'Compact CSV' : '精简版'}</span>
                      <small>{isEnglish ? 'One row per compound' : '每种化合物一行，介质横向展示'}</small>
                    </button>
                    <button type="button" role="menuitem" onClick={() => exportCSV('detailed')}>
                      <span>{isEnglish ? 'Detailed CSV' : '详细版'}</span>
                      <small>{isEnglish ? 'All selected threshold records' : '导出全部已选阈值记录'}</small>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            {searchMode === 'single' ? (
              <div>
                <label htmlFor="compound-search" className="search-field-label">{ui.searchLabel}</label>
                <div className="search-input-shell">
                <Search className="search-input-icon" />
                <input
                  id="compound-search"
                  type="text"
                  autoComplete="off"
                  className="search-input"
                  placeholder={isEnglish
                    ? `Chinese name, English name, or CAS number (e.g., 64-19-7)`
                    : `输入中文名、英文名或 CAS 号（如 64-19-7）`}
                  value={singleQuery}
                  onChange={(e) => setSingleQuery(e.target.value)}
                />
                <MatchModeControl exactMatch={exactMatch} onChange={setExactMatch} isEnglish={isEnglish} compact />
                </div>
                <p className="search-field-help">{ui.liveSearchHelp}</p>
              </div>
            ) : (
              <div>
                <div className="bulk-field-header">
                  <label htmlFor="bulk-search" className="text-sm font-semibold text-slate-700 flex items-center">
                    <FileText className="w-4 h-4 mr-1 text-indigo-500" />
                    {ui.bulkLabel}
                  </label>
                  <div className="bulk-field-actions">
                    <MatchModeControl exactMatch={exactMatch} onChange={setExactMatch} isEnglish={isEnglish} />
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
                  id="bulk-search"
                  className="bulk-search-input"
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
          <div className="filter-disclosure">
            <div id="advanced-filters" className="advanced-filters legacy-filter-list" role="group" aria-label={isEnglish ? 'Detection medium filter' : '检测介质过滤'}>
              {[
                { key: 'chemical', label: ui.chemicalInfo },
                { key: 'data', label: ui.dataScope },
                { key: 'threshold', label: ui.thresholdScope }
              ].map(filterGroup => (
                <div key={filterGroup.key} className="legacy-filter-row" data-filter-group={filterGroup.key}>
                  <span className="legacy-filter-row-label">{filterGroup.label}</span>
                  <div className="legacy-filter-row-options">
                    {filterOptions.filter(option => option.group === filterGroup.key).map(option => (
                      <button
                        key={option.key}
                        draggable
                        onDragStart={(event) => handleFilterDragStart(event, option.key)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => handleFilterDrop(event, option.key)}
                        onDragEnd={() => setDraggedFilterKey(null)}
                        onClick={option.onClick}
                        aria-pressed={option.active}
                        className={`filter-chip ${option.active ? 'active' : ''} ${draggedFilterKey === option.key ? 'dragging' : ''}`}
                        data-filter-key={option.key}
                        data-filter-tone={option.tone}
                        title={ui.dragTitle}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Results Section */}
        {!loading && selectedMedia.length > 0 && (singleQuery.trim() || bulkQuery.trim()) && (
          <div
            className="result-section space-y-6"
            style={{ order: 20 + Math.min(...['medium:空气', 'medium:水', 'medium:其他介质'].map(getFilterOrderIndex)) }}
          >
            <div className="flex items-center justify-between mb-4 px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.results}
                <span className="section-count">
                  {isEnglish ? `${results.length} ${ui.found}` : `共找到 ${results.length} ${ui.found}`}
                </span>
              </h2>
              
            </div>

            {results.length === 0 ? (
              <div className="empty-result-state">
                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-slate-300" />
                </div>
                <h3 className="text-xl font-semibold text-slate-600 mb-2">{ui.noResults}</h3>
                <p className="text-slate-400">{ui.noResultsHelp}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {orderedResults.map((item, idx) => (
                  <div
                    key={`${item.cas}-${item.medium}-${idx}`}
                    className="result-entity threshold-result-entity bg-white overflow-hidden group"
                    data-medium={item.medium}
                    data-tone={['air', 'water', 'other'][['空气', '水', '其他介质'].indexOf(item.medium)] || 'water'}
                  >
                    <div className="threshold-entity-header">
                      <div className="threshold-identity-row">
                        <h3>{item.chinese_name || item.english_name}</h3>
                        {formatDisplayCommonEnglishName((femaProfiles[item.cas] || {}).name || item.english_name) && (
                          <span className="threshold-common-name">
                            {formatDisplayCommonEnglishName((femaProfiles[item.cas] || {}).name || item.english_name)}
                          </span>
                        )}
                        <span className="compound-cas">CAS {item.cas}</span>
                      </div>
                      
                      <div className="mt-4 md:mt-0 flex shrink-0">
                        <span className="entity-medium">
                          <span className="entity-medium-dot" aria-hidden="true" />
                          {ui.medium}: {displayMedium(item.medium)}
                        </span>
                      </div>
                    </div>

                    <div className="data-panel">
                      <h4 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4 flex items-center">
                        <Info className="w-4 h-4 mr-2" />
                        {ui.thresholdRecords}
                      </h4>
                      {getFilteredThresholds(item).length > 0 ? (
                        <div className="threshold-records" role="table" aria-label={ui.thresholdRecords}>
                          <div className="threshold-record-row threshold-record-head" role="row">
                            <span role="columnheader">{ui.source}</span>
                            <span role="columnheader">{ui.thresholdType}</span>
                            <span role="columnheader">{ui.threshold} ({item.medium === '空气' ? 'mg/m³' : 'mg/kg'})</span>
                          </div>
                          {getFilteredThresholds(item).slice(0, 1).map((th, idx) => {
                            const parsed = parseThresholdStr(th);
                            const fullRef = matchReference(parsed.author);
                            return (
                              <div key={`primary-${idx}`} className="threshold-record-row primary" role="row">
                                <span role="cell">
                                  {fullRef ? (
                                    <button onClick={() => setSelectedRef({ author: parsed.author, text: fullRef })} className="reference-link-button group inline-flex items-center text-left" aria-label={isEnglish ? 'View full reference' : '查看完整文献'}>
                                      <span>{parsed.author}</span><Info className="w-3.5 h-3.5 ml-1.5" />
                                    </button>
                                  ) : parsed.author}
                                </span>
                                <span role="cell" data-mobile-label={isEnglish ? 'Type: ' : '类型：'}>{displayThresholdType(parsed.type)}</span>
                                <strong role="cell" data-mobile-label={isEnglish ? 'Threshold: ' : '阈值：'}>{parsed.value}</strong>
                              </div>
                            );
                          })}
                          {getFilteredThresholds(item).length > 1 && (
                            <details className="threshold-more-records">
                              <summary>{isEnglish ? `Show ${getFilteredThresholds(item).length - 1} more records` : `展开其余 ${getFilteredThresholds(item).length - 1} 条记录`}</summary>
                              {getFilteredThresholds(item).slice(1).map((th, idx) => {
                                const parsed = parseThresholdStr(th);
                                const fullRef = matchReference(parsed.author);
                                return (
                                  <div key={`more-${idx}`} className="threshold-record-row" role="row">
                                    <span role="cell">
                                      {fullRef ? (
                                        <button onClick={() => setSelectedRef({ author: parsed.author, text: fullRef })} className="reference-link-button group inline-flex items-center text-left" aria-label={isEnglish ? 'View full reference' : '查看完整文献'}>
                                          <span>{parsed.author}</span><Info className="w-3.5 h-3.5 ml-1.5" />
                                        </button>
                                      ) : parsed.author}
                                    </span>
                                    <span role="cell" data-mobile-label={isEnglish ? 'Type: ' : '类型：'}>{displayThresholdType(parsed.type)}</span>
                                    <strong role="cell" data-mobile-label={isEnglish ? 'Threshold: ' : '阈值：'}>{parsed.value}</strong>
                                  </div>
                                );
                              })}
                            </details>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400 py-2">{ui.noThresholds}</div>
                      )}
                    </div>

                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && (singleQuery.trim() || bulkQuery.trim()) && integratedCompoundResults.length > 0 && (
          <section className="result-section integrated-records-section" style={{ order: 21 }}>
            <div className="integrated-records-heading">
              <div>
                <h2>{isEnglish ? 'Compound profiles' : '化合物档案'}</h2>
              </div>
              <span className="section-count">{integratedCompoundResults.length} {isEnglish ? 'compounds' : '种化合物'}</span>
            </div>

            <div className="integrated-record-list">
              {integratedCompoundResults.map(({ item, fema, profile }) => {
                const pubchem = profile.pubchem || {};
                const flavordb = profile.flavordb || {};
                const descriptorGroups = groupFlavorDescriptors(
                  includeFlavorDescriptions && selectedFlavorSources.includes('FEMA') ? fema : {},
                  includeFlavorDB && selectedFlavorSources.includes('FlavorDB') ? flavordb : {}
                );
                const commonName = formatDisplayCommonEnglishName(
                  (includeFlavorDescriptions && fema.name) || pubchem.title || flavordb.common_name || item.english_name
                );
                const primaryCompoundClass = profile.smart_classification || {
                  key: 'others',
                  zh: '其他类',
                  en: 'Others',
                  matches: [],
                  method: 'SMARTS',
                };
                const sourceLinks = [
                  includeFlavorDescriptions && fema.found && { key: 'fema', label: 'FEMA', meta: fema.fema_number ? `FEMA No. ${fema.fema_number}` : '', url: fema.url },
                  includePubChem && pubchem.found && { key: 'pubchem', label: 'PubChem', meta: pubchem.cid ? `CID ${pubchem.cid}` : '', url: pubchem.url },
                  includeFlavorDB && flavordb.found && { key: 'flavordb', label: 'FlavorDB', meta: flavordb.cid ? `CID ${flavordb.cid}` : '', url: flavordb.url }
                ].filter(Boolean);

                return (
                  <article key={`integrated-${item.cas}`} className="integrated-compound-card">
                    <header className="integrated-identity-header">
                      <div className="integrated-identity-copy integrated-identity-row">
                        <h3>{item.chinese_name || commonName || item.english_name}</h3>
                        {commonName && <p className="integrated-common-name">{commonName}</p>}
                        <div className="integrated-identity-ids">
                          <span>CAS {item.cas}</span>
                          {(pubchem.cid || flavordb.cid) && <span>CID {pubchem.cid || flavordb.cid}</span>}
                        </div>
                      </div>
                    </header>

                    <div className="integrated-content-grid">
                      {includePubChem && pubchem.found && (
                        <section className="integrated-chemistry" aria-labelledby={`chemistry-${item.cas}`}>
                          <div className="integrated-section-title">
                            <Database aria-hidden="true" />
                            <div><h4 id={`chemistry-${item.cas}`}>{isEnglish ? 'Chemical identity' : '化学身份'}</h4></div>
                          </div>
                          <div className="integrated-chemistry-body">
                            <PubChemStructureViewer
                              apiUrl={FEMA_API_URL}
                              cid={pubchem.cid}
                              compoundName={commonName || item.english_name}
                              imagePath={pubchem.image_path}
                              isEnglish={isEnglish}
                              pubchemUrl={pubchem.url}
                            />
                            <dl>
                              <div><dt>{isEnglish ? 'Formula' : '分子式'}</dt><dd>{pubchem.molecular_formula || '-'}</dd></div>
                              <div><dt>{isEnglish ? 'Molecular weight' : '分子量'}</dt><dd>{pubchem.molecular_weight ? `${pubchem.molecular_weight} g/mol` : '-'}</dd></div>
                              <div><dt>IUPAC</dt><dd>{pubchem.iupac_name || '-'}</dd></div>
                              <div><dt>XLogP</dt><dd>{pubchem.xlogp ?? '-'}</dd></div>
                              <div><dt>TPSA</dt><dd>{pubchem.tpsa != null ? `${pubchem.tpsa} Å²` : '-'}</dd></div>
                              <div><dt>HBD / HBA</dt><dd>{pubchem.h_bond_donor_count ?? '-'} / {pubchem.h_bond_acceptor_count ?? '-'}</dd></div>
                              {pubchem.smiles && <div className="integrated-chemistry-wide"><dt>SMILES</dt><dd><code>{pubchem.smiles}</code></dd></div>}
                              {includeFlavorDB && flavordb.functional_groups?.length > 0 && (
                                <div className="integrated-chemistry-wide">
                                  <dt>{isEnglish ? 'Functional groups' : '官能团名称'}</dt>
                                  <dd>{flavordb.functional_groups.join('; ')}</dd>
                                </div>
                              )}
                              <div className="integrated-chemistry-wide primary-compound-class">
                                <dt>{isEnglish ? 'Primary compound class' : '主要化合物类别'}</dt>
                                <dd data-compound-class={primaryCompoundClass.key}>
                                  {isEnglish ? primaryCompoundClass.en : primaryCompoundClass.zh}
                                </dd>
                                {primaryCompoundClass.matches?.length > 1 && (
                                  <small>
                                    {isEnglish ? 'SMARTS matches: ' : 'SMARTS 命中：'}
                                    {primaryCompoundClass.matches
                                      .map(match => isEnglish ? match.en : match.zh)
                                      .join('、')}
                                  </small>
                                )}
                              </div>
                            </dl>
                          </div>
                          {pubchem.inchi_key && (
                            <details className="integrated-structure-details">
                              <summary>{isEnglish ? 'More structure identifiers' : '更多结构标识符'}</summary>
                              {pubchem.inchi_key && <div><strong>InChIKey</strong><code>{pubchem.inchi_key}</code></div>}
                            </details>
                          )}
                        </section>
                      )}

                      <section className="integrated-flavor" aria-labelledby={`flavor-${item.cas}`}>
                        <div className="integrated-section-title">
                          <FlaskConical aria-hidden="true" />
                          <div><h4 id={`flavor-${item.cas}`}>{isEnglish ? 'Flavor descriptors' : '风味描述'}</h4></div>
                        </div>
                        <div className="integrated-flavor-source-controls" role="group" aria-label={isEnglish ? 'Flavor descriptor sources' : '风味描述数据来源'}>
                          <button
                            type="button"
                            data-source="fema"
                            className={selectedFlavorSources.includes('FEMA') && includeFlavorDescriptions ? 'active' : ''}
                            disabled={!includeFlavorDescriptions}
                            aria-pressed={selectedFlavorSources.includes('FEMA') && includeFlavorDescriptions}
                            onClick={() => toggleFlavorSource('FEMA')}
                          >
                            <span aria-hidden="true" /> FEMA
                          </button>
                          <button
                            type="button"
                            data-source="flavordb"
                            className={selectedFlavorSources.includes('FlavorDB') && includeFlavorDB ? 'active' : ''}
                            disabled={!includeFlavorDB}
                            aria-pressed={selectedFlavorSources.includes('FlavorDB') && includeFlavorDB}
                            onClick={() => toggleFlavorSource('FlavorDB')}
                          >
                            <span aria-hidden="true" /> FlavorDB
                          </button>
                        </div>
                        {descriptorGroups.length > 0 ? (
                          <div className="integrated-descriptor-sources">
                            {descriptorGroups.map(group => (
                              <section key={group.key} className="integrated-descriptor-source-card" data-source={group.key}>
                                <h5>{group.label}</h5>
                                <div className="integrated-descriptor-list">
                                  {group.descriptors.map((descriptor, index) => (
                                    <span key={`${group.key}-${descriptor}-${index}`} className="integrated-descriptor">
                                      <strong>{descriptor}</strong>
                                    </span>
                                  ))}
                                </div>
                              </section>
                            ))}
                          </div>
                        ) : (
                          <p className="integrated-empty">{isEnglish ? 'No descriptor returned by the selected sources.' : '所选来源暂未返回风味描述。'}</p>
                        )}
                      </section>
                    </div>

                    <footer className="integrated-source-links">
                      <div><strong>{isEnglish ? 'Sources and original records' : '来源与原始记录'}</strong><span>{isEnglish ? 'Open the source page to verify the record.' : '可跳转原网页核验数据。'}</span></div>
                      <nav aria-label={isEnglish ? 'Original database records' : '原始数据库记录'}>
                        {sourceLinks.map(source => (
                          <a key={source.key} href={source.url || '#'} target="_blank" rel="noreferrer" data-source={source.key} aria-disabled={!source.url}>
                            <span><strong>{source.label}</strong>{source.meta && <small>{source.meta}</small>}</span>
                            <ExternalLink aria-hidden="true" />
                          </a>
                        ))}
                      </nav>
                    </footer>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!loading && (singleQuery.trim() || bulkQuery.trim()) && externalCompoundResults.length > 0 && integratedCompoundResults.length === 0 && (
          <section className="result-section external-database-section" style={{ order: 21 }}>
            <div className="external-database-heading">
              <div>
                <span className="external-database-kicker">{isEnglish ? 'Linked scientific databases' : '关联科学数据库'}</span>
                <h2>{isEnglish ? 'Chemical and flavor records' : '化学信息与风味关联'}</h2>
              </div>
              <span className="section-count">{externalCompoundResults.length} {isEnglish ? 'compounds' : '种化合物'}</span>
            </div>

            <div className="external-compound-list">
              {externalCompoundResults.map(({ item, profile }) => {
                const pubchem = profile.pubchem || {};
                const flavordb = profile.flavordb || {};
                return (
                  <article key={`external-${item.cas}`} className="external-compound-record">
                    <header className="external-compound-header">
                      <div>
                        <h3>{item.chinese_name || pubchem.title || item.english_name}</h3>
                        <p>{pubchem.title || flavordb.common_name || item.english_name}</p>
                      </div>
                      <span>CAS {item.cas}</span>
                    </header>

                    <div className="external-source-grid">
                      {includePubChem && pubchem.found && (
                        <section className="external-source-card pubchem-source-card">
                          <div className="external-source-title">
                            <span className="external-source-icon"><Database aria-hidden="true" /></span>
                            <div><strong>PubChem</strong><small>CID {pubchem.cid}</small></div>
                            <a href={pubchem.url} target="_blank" rel="noreferrer" aria-label={isEnglish ? 'Open PubChem' : '打开 PubChem'}><ExternalLink /></a>
                          </div>
                          <div className="pubchem-summary">
                            <img src={`${FEMA_API_URL}${pubchem.image_path || `/pubchem-image?cid=${pubchem.cid}`}`} alt={`${pubchem.title || item.english_name} 2D structure`} loading="lazy" />
                            <dl>
                              <div><dt>{isEnglish ? 'Formula' : '分子式'}</dt><dd>{pubchem.molecular_formula || '-'}</dd></div>
                              <div><dt>{isEnglish ? 'Molecular weight' : '分子量'}</dt><dd>{pubchem.molecular_weight ? `${pubchem.molecular_weight} g/mol` : '-'}</dd></div>
                              <div><dt>IUPAC</dt><dd>{pubchem.iupac_name || '-'}</dd></div>
                              <div><dt>XLogP</dt><dd>{pubchem.xlogp ?? '-'}</dd></div>
                              <div><dt>TPSA</dt><dd>{pubchem.tpsa != null ? `${pubchem.tpsa} Å²` : '-'}</dd></div>
                              <div><dt>HBD / HBA</dt><dd>{pubchem.h_bond_donor_count ?? '-'} / {pubchem.h_bond_acceptor_count ?? '-'}</dd></div>
                            </dl>
                          </div>
                          <details className="external-identifiers">
                            <summary>{isEnglish ? 'Structure identifiers' : '结构标识符'}</summary>
                            <div><strong>InChIKey</strong><code>{pubchem.inchi_key || '-'}</code></div>
                            <div><strong>SMILES</strong><code>{pubchem.smiles || '-'}</code></div>
                          </details>
                          <p className="external-source-attribution">{isEnglish ? 'Source: PubChem PUG REST' : '来源：PubChem PUG REST'}</p>
                        </section>
                      )}

                      {includeFlavorDB && flavordb.found && (
                        <section className="external-source-card flavordb-source-card">
                          <div className="external-source-title">
                            <span className="external-source-icon"><FlaskConical aria-hidden="true" /></span>
                            <div><strong>FlavorDB</strong><small>PubChem CID {flavordb.cid}</small></div>
                            <a href={flavordb.url} target="_blank" rel="noreferrer" aria-label={isEnglish ? 'Open FlavorDB' : '打开 FlavorDB'}><ExternalLink /></a>
                          </div>

                          <div className="flavordb-group">
                            <h4>{isEnglish ? 'Flavor profile' : '风味特征'}</h4>
                            <div className="flavordb-tags">
                              {(flavordb.flavor_profile || []).map(tag => <span key={tag}>{tag}</span>)}
                            </div>
                          </div>
                          {(flavordb.odor?.length > 0 || flavordb.taste?.length > 0) && (
                            <dl className="flavordb-sensory">
                              {flavordb.odor?.length > 0 && <div><dt>{isEnglish ? 'Odor' : '气味'}</dt><dd>{flavordb.odor.join('; ')}</dd></div>}
                              {flavordb.taste?.length > 0 && <div><dt>{isEnglish ? 'Taste' : '味觉'}</dt><dd>{flavordb.taste.join('; ')}</dd></div>}
                            </dl>
                          )}
                          {flavordb.functional_groups?.length > 0 && (
                            <div className="flavordb-group">
                              <h4>{isEnglish ? 'Functional groups' : '功能基团'}</h4>
                              <p>{flavordb.functional_groups.join('; ')}</p>
                            </div>
                          )}
                          {flavordb.fema_flavor_profile?.length > 0 && (
                            <div className="flavordb-group">
                              <h4>FEMA Flavor Profile {flavordb.fema_number ? `· No. ${flavordb.fema_number}` : ''}</h4>
                              <p>{flavordb.fema_flavor_profile.join(', ')}</p>
                            </div>
                          )}
                          <p className="external-source-attribution">{isEnglish ? 'Source: FlavorDB · License: ' : '来源：FlavorDB · 许可：'}{flavordb.license}</p>
                        </section>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {!loading && (singleQuery.trim() || bulkQuery.trim()) && femaResults.length > 0 && integratedCompoundResults.length === 0 && (
          <div
            className="result-section mt-8 space-y-4"
            style={{ order: 20 + getFilterOrderIndex('flavor') }}
          >
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.flavorDescriptions}
                <span className="section-count">
                  FEMA {femaResults.length} {isEnglish ? 'records' : '条'}
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {femaResults.map(({ item, profile }) => (
                <div key={`fema-${item.cas}`} className="result-entity fema-result-entity bg-white overflow-hidden">
                  <div className="entity-header">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-bold text-slate-800">{item.chinese_name || item.english_name}</h3>
                        <span className="entity-cas">
                          CAS: {item.cas}
                        </span>
                      </div>
                      {formatDisplayCommonEnglishName(profile.name || item.english_name) && (
                        <p className="common-english-name mt-1 text-slate-700 font-semibold">
                          {formatDisplayCommonEnglishName(profile.name || item.english_name)}
                        </p>
                      )}
                    </div>
                    <span className="source-record-id">
                      FEMA No. {profile.fema_number || '-'}
                    </span>
                  </div>

                  <div className="p-5 md:p-6">
                    <div className="source-panel">
                      <h4 className="text-sm font-semibold text-slate-600 uppercase tracking-wider mb-2 flex items-center">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        FEMA
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
            className="result-section mt-8 space-y-4"
            style={{ order: 20 + getFilterOrderIndex('book') }}
          >
            <div className="flex items-center justify-between px-2">
              <h2 className="text-2xl font-bold text-slate-800 flex items-center">
                {ui.bookResults}
                <span className="section-count">
                  {isEnglish ? 'Wine Flavor Chemistry' : '酒类风味化学'} {bookResults.length} {isEnglish ? 'records' : '条'}
                </span>
              </h2>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {bookResults.map((item) => {
                const summary = summarizeBookHit(item.text, getActiveBookQueries());
                const tags = getBookHitTags(item.text);
                return (
                  <div key={item.id} className="result-entity book-result-entity bg-white overflow-hidden">
                    <div className="entity-header">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="source-label">
                          {isEnglish ? 'Wine Flavor Chemistry' : item.book_title}
                        </span>
                        <span className="text-sm font-semibold text-slate-600">
                          {ui.pageChunk(item.page, item.chunk)}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {tags.map(tag => (
                          <span key={tag} className="data-tag">
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
                                  <li key={lineIdx} className="book-data-line">
                                    {line}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      )}

                      <details className="group">
                        <summary className="book-original-trigger">
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

      </main>
      </>
      )}

      {showContact && (
        <div className="contact-overlay" role="dialog" aria-modal="true" aria-labelledby="contact-title">
          <button type="button" className="contact-backdrop" aria-label={isEnglish ? 'Close contact dialog' : '关闭联系方式'} onClick={() => setShowContact(false)} />
          <div className="contact-dialog">
            <div className="contact-dialog-header">
              <div>
                <h2 id="contact-title">{isEnglish ? 'Contact us' : '联系我们'}</h2>
              </div>
              <button type="button" onClick={() => setShowContact(false)} aria-label={isEnglish ? 'Close' : '关闭'}><X className="w-5 h-5" /></button>
            </div>
            <div className="contact-options">
              <div className="contact-wechat">
                <button type="button" className="contact-wechat-id" onClick={() => navigator.clipboard.writeText('XQ_player')}>
                  <MessageCircle className="w-5 h-5" />
                  <span><strong>{isEnglish ? 'WeChat' : '微信'}</strong><small>XQ_player</small></span>
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <a className="contact-email" href="mailto:hanxq888@gmail.com">
                <Mail className="w-5 h-5" />
                <span><strong>{isEnglish ? 'Email' : '邮箱'}</strong><small>hanxq888@gmail.com</small></span>
              </a>
            </div>
          </div>
        </div>
      )}

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
              <div className="bg-slate-50 p-5 rounded-xl border border-slate-200 text-slate-700 text-[15px] leading-relaxed font-serif whitespace-pre-wrap max-h-[50vh] overflow-y-auto">
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
                className={`reference-copy-button ${copied ? 'copied' : ''}`}
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
