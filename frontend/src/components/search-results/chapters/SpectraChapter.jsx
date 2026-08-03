import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

const OpenSpectraWorkbench = lazy(() => import('../../spectra/OpenSpectraWorkbench'));
const NistWebbookPresence = lazy(() => import('../../NistWebbookPresence'));

export default function SpectraChapter({ apiUrl, cas, inchikey, smiles, name, isEnglish = false, onStatusChange }) {
  const [sourceStatuses, setSourceStatuses] = useState({ open: 'loading', nist: 'loading' });
  const setOpenStatus = useCallback(status => setSourceStatuses(current => ({ ...current, open: status })), []);
  const setNistStatus = useCallback(status => setSourceStatuses(current => ({ ...current, nist: status })), []);
  useEffect(() => {
    const values = Object.values(sourceStatuses);
    const status = values.includes('loading') ? 'loading'
      : values.every(value => value === 'failed') ? 'failed'
        : values.every(value => value === 'no_data') ? 'no_data'
          : values.some(value => ['failed', 'partial', 'no_data'].includes(value)) ? 'partial' : 'available';
    onStatusChange?.(status);
  }, [onStatusChange, sourceStatuses]);
  return (
    <div className="spectra-chapter" data-testid="spectrum-workbench">
      <p className="scientific-chapter-note">
        {isEnglish
          ? 'Spectrum matches and original-site availability are evidence records; verify experimental conditions at the source.'
          : '谱图匹配与原站可用性均为证据记录；实验条件请回到原始来源核验。'}
      </p>
      <Suspense fallback={<p>{isEnglish ? 'Loading spectrum tools…' : '正在载入谱图工具…'}</p>}>
        <OpenSpectraWorkbench
          apiUrl={apiUrl}
          cas={cas}
          inchikey={inchikey}
          smiles={smiles}
          compoundName={name}
          isEnglish={isEnglish}
          onStatusChange={setOpenStatus}
        />
        <NistWebbookPresence apiUrl={apiUrl} cas={cas} isEnglish={isEnglish} onStatusChange={setNistStatus} />
      </Suspense>
    </div>
  );
}
