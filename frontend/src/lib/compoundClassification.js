const SMARTS_CLASSES = [
  { key: 'acids', zh: '羧酸类', en: 'Carboxylic acids', patterns: ['[CX3](=O)[OX2H1,O-]'] },
  { key: 'anhydrides', zh: '酸酐类', en: 'Acid anhydrides', patterns: ['[CX3](=O)O[CX3](=O)'] },
  { key: 'lactones', zh: '内酯类', en: 'Lactones', patterns: ['[O;R][C;R](=O)'] },
  { key: 'esters', zh: '酯类', en: 'Esters', patterns: ['[CX3](=O)[OX2][#6]'] },
  { key: 'amides', zh: '酰胺类', en: 'Amides', patterns: ['[CX3](=O)[NX3]'] },
  { key: 'aldehydes', zh: '醛类', en: 'Aldehydes', patterns: ['[CX3H1](=O)'] },
  { key: 'ketones', zh: '酮类', en: 'Ketones', patterns: ['[#6][CX3](=O)[#6]'] },
  { key: 'phenols', zh: '酚类', en: 'Phenols', patterns: ['[OX2H][c]'] },
  { key: 'alcohols', zh: '醇类', en: 'Alcohols', patterns: ['[OX2H][C;!$(C=O)]'] },
  { key: 'thiols', zh: '硫醇类', en: 'Thiols', patterns: ['[SX2H]'] },
  { key: 'disulfides', zh: '二硫化物', en: 'Disulfides', patterns: ['[SX2][SX2]'] },
  { key: 'thioethers', zh: '硫醚类', en: 'Thioethers', patterns: ['[SX2]([#6])[#6]'] },
  { key: 'pyrazines', zh: '吡嗪类', en: 'Pyrazines', patterns: ['n1ccncc1'] },
  { key: 'pyridines', zh: '吡啶类', en: 'Pyridines', patterns: ['n1ccccc1'] },
  { key: 'furans', zh: '呋喃类', en: 'Furans', patterns: ['o1cccc1'] },
  { key: 'amines', zh: '胺类', en: 'Amines', patterns: ['[NX3;!$(N-C=O)]'] },
  { key: 'ethers', zh: '醚类', en: 'Ethers', patterns: ['[OD2]([#6])[#6]'] },
  {
    key: 'heterocycles',
    zh: '其他风味杂环',
    en: 'Other flavor heterocycles',
    patterns: ['[nH]1cccc1', 's1cccc1', 'n1ccsc1', 'n1ccoc1'],
  },
  { key: 'alkynes', zh: '炔烃类', en: 'Alkynes', patterns: ['[CX2]#[CX2]'] },
  { key: 'alkenes', zh: '烯烃类', en: 'Alkenes', patterns: ['[CX3]=[CX3]'] },
  { key: 'aromatics', zh: '芳香环化合物', en: 'Aromatic compounds', patterns: ['[a;r5,r6]'] },
];

const FALLBACK_CLASS = {
  key: 'others',
  zh: '其他类',
  en: 'Others',
  matches: [],
  method: 'SMARTS',
};

const unavailableFallback = reason => ({ ...FALLBACK_CLASS, reliable: false, reason });

let rdkitPromise;
const resultCache = new Map();

const loadRDKit = async () => {
  if (!rdkitPromise) {
    rdkitPromise = Promise.all([
      import('@rdkit/rdkit'),
      import('@rdkit/rdkit/dist/RDKit_minimal.wasm?url'),
    ]).then(([module, wasmModule]) => {
      const initRDKitModule = module.default || module.initRDKitModule || module;
      return initRDKitModule({ locateFile: () => wasmModule.default });
    });
  }
  return rdkitPromise;
};

const hasSmartsMatch = (rdkit, molecule, smarts) => {
  const query = rdkit.get_qmol(smarts);
  if (!query) return false;
  try {
    const match = JSON.parse(molecule.get_substruct_match(query) || '{}');
    return Array.isArray(match.atoms) && match.atoms.length > 0;
  } finally {
    query.delete();
  }
};

export const classifyCompoundBySmarts = async (smiles) => {
  const normalized = (smiles || '').trim();
  if (!normalized) return unavailableFallback('missing_smiles');
  if (resultCache.has(normalized)) return resultCache.get(normalized);

  try {
    const rdkit = await loadRDKit();
    const molecule = rdkit.get_mol(normalized);
    if (!molecule) return unavailableFallback('invalid_smiles');
    try {
      const matches = SMARTS_CLASSES.filter(definition =>
        definition.patterns.some(smarts => hasSmartsMatch(rdkit, molecule, smarts))
      );
      const primary = matches[0] || FALLBACK_CLASS;
      const result = {
        key: primary.key,
        zh: primary.zh,
        en: primary.en,
        matches: matches.map(({ key, zh, en }) => ({ key, zh, en })),
        method: 'SMARTS',
        reliable: true,
      };
      resultCache.set(normalized, result);
      return result;
    } finally {
      molecule.delete();
    }
  } catch (error) {
    console.warn('SMARTS classification unavailable:', error);
    return unavailableFallback('classification_unavailable');
  }
};

