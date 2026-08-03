import { lazy, Suspense } from 'react';

const OpenSpectraWorkbench = lazy(() => import('../../spectra/OpenSpectraWorkbench'));
const NistWebbookPresence = lazy(() => import('../../NistWebbookPresence'));

export default function SpectraChapter({ apiUrl, cas, inchikey, smiles, name, isEnglish = false }) {
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
        />
        <NistWebbookPresence apiUrl={apiUrl} cas={cas} isEnglish={isEnglish} />
      </Suspense>
    </div>
  );
}
