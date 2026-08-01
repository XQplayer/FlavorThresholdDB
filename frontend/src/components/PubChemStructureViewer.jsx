import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, Image as ImageIcon, Loader2, Rotate3D } from 'lucide-react';

const VIEW_OPTIONS = [
  { key: '2d', zh: '2D 结构', en: '2D structure' },
  { key: '3d', zh: '3D 构象', en: '3D conformer' },
  { key: 'crystal', zh: '晶体结构', en: 'Crystal structures' },
];

export default function PubChemStructureViewer({
  apiUrl,
  cid,
  compoundName,
  imagePath,
  isEnglish,
  pubchemUrl,
}) {
  const [activeView, setActiveView] = useState('2d');
  const [sdf, setSdf] = useState('');
  const [threeDStatus, setThreeDStatus] = useState('idle');
  const [style, setStyle] = useState('stick');
  const [crystalData, setCrystalData] = useState(null);
  const [crystalStatus, setCrystalStatus] = useState('idle');
  const [openDownloadMenu, setOpenDownloadMenu] = useState(null);
  const viewerHostRef = useRef(null);
  const viewerInstanceRef = useRef(null);

  useEffect(() => {
    if (activeView !== '3d' || !sdf || !viewerHostRef.current) return;
    let viewer;
    let cancelled = false;
    import('3dmol').then(module => {
      if (cancelled || !viewerHostRef.current) return;
      const threeDmol = module.default || module;
      viewer = threeDmol.createViewer(viewerHostRef.current, {
        backgroundColor: '#f8fafc',
        antialias: true,
      });
      viewerInstanceRef.current = viewer;
      viewer.addModel(sdf, 'sdf');
      viewer.setStyle(
        {},
        style === 'sphere'
          ? { sphere: { scale: 0.3 }, stick: { radius: 0.12 } }
          : { stick: { radius: 0.16 }, sphere: { scale: 0.22 } }
      );
      viewer.zoomTo();
      viewer.render();
      viewer.zoom(1.15, 500);
    });
    return () => {
      cancelled = true;
      viewer?.clear();
      viewerInstanceRef.current = null;
    };
  }, [activeView, sdf, style]);

  useEffect(() => {
    if (!viewerHostRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const viewer = viewerInstanceRef.current;
      if (!viewer) return;
      viewer.resize();
      viewer.render();
    });
    observer.observe(viewerHostRef.current);
    return () => observer.disconnect();
  }, [activeView, sdf]);

  const downloadCurrent3DImage = () => {
    const imageUrl = viewerInstanceRef.current?.pngURI();
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = `pubchem-cid-${cid}-3d-current.png`;
    link.click();
  };

  const handleViewChange = async (view) => {
    setOpenDownloadMenu(null);
    setActiveView(view);
    if (view === '3d' && !sdf && threeDStatus === 'idle') {
      setThreeDStatus('loading');
      try {
        const response = await fetch(`${apiUrl}/pubchem-3d?cid=${encodeURIComponent(cid)}`);
        if (!response.ok) throw new Error('No 3D conformer');
        setSdf(await response.text());
        setThreeDStatus('ready');
      } catch {
        setThreeDStatus('empty');
      }
    }
    if (view === 'crystal' && !crystalData && crystalStatus === 'idle') {
      setCrystalStatus('loading');
      try {
        const response = await fetch(`${apiUrl}/pubchem-crystal?cid=${encodeURIComponent(cid)}`);
        if (!response.ok) throw new Error('Crystal lookup failed');
        const value = await response.json();
        setCrystalData(value);
        setCrystalStatus(value.found ? 'ready' : 'empty');
      } catch {
        setCrystalStatus('empty');
      }
    }
  };

  return (
    <div className="pubchem-structure-viewer" aria-label={isEnglish ? 'Resizable PubChem structure viewer' : '可调节大小的 PubChem 结构查看器'}>
      <div className="structure-view-tabs" role="tablist" aria-label={isEnglish ? 'PubChem structure views' : 'PubChem 结构视图'}>
        {VIEW_OPTIONS.map(option => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={activeView === option.key}
            className={activeView === option.key ? 'active' : ''}
            onClick={() => handleViewChange(option.key)}
          >
            {isEnglish ? option.en : option.zh}
          </button>
        ))}
        <a href={pubchemUrl} target="_blank" rel="noreferrer">
          PubChem <ExternalLink aria-hidden="true" />
        </a>
      </div>

      {activeView !== 'crystal' && (
        <div className="structure-download-bar">
          <details className="structure-download-menu" open={openDownloadMenu === 'image'}>
            <summary onClick={event => { event.preventDefault(); setOpenDownloadMenu(current => current === 'image' ? null : 'image'); }}><ImageIcon aria-hidden="true" />{isEnglish ? 'Get image' : '获取图片'}</summary>
            <div className="structure-download-popover image-download-options">
              {[100, 300, 500].map(size => (
                <a
                  key={size}
                  href={`${apiUrl}/pubchem-image?cid=${encodeURIComponent(cid)}&size=${size}x${size}&download=1`}
                  onClick={() => setOpenDownloadMenu(null)}
                >
                  {size} × {size} pixels
                </a>
              ))}
              {activeView === '3d' && sdf && (
                <button type="button" onClick={() => { setOpenDownloadMenu(null); downloadCurrent3DImage(); }}>
                  {isEnglish ? 'Current view' : '当前视图'}
                </button>
              )}
            </div>
          </details>

          <details className="structure-download-menu coordinate-download-menu" open={openDownloadMenu === 'coordinates'}>
            <summary onClick={event => { event.preventDefault(); setOpenDownloadMenu(current => current === 'coordinates' ? null : 'coordinates'); }}><Download aria-hidden="true" />{isEnglish ? 'Download coordinates' : '下载坐标'}</summary>
            <div className="structure-download-popover coordinate-download-options">
              {['sdf', 'json', 'xml', 'asnt'].map(format => {
                const recordType = activeView === '3d' ? '3d' : '2d';
                const baseUrl = `${apiUrl}/pubchem-coordinates?cid=${encodeURIComponent(cid)}&format=${format}&record_type=${recordType}`;
                return (
                  <div key={format}>
                    <strong>{format.toUpperCase()}</strong>
                    <a href={`${baseUrl}&download=1`} onClick={() => setOpenDownloadMenu(null)}><Download aria-hidden="true" />{isEnglish ? 'Save' : '保存'}</a>
                    <a href={baseUrl} target="_blank" rel="noreferrer">{isEnglish ? 'Display' : '查看'}<ExternalLink aria-hidden="true" /></a>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      )}

      <div className="structure-view-stage">
        {activeView === '2d' && (
          <div className="structure-2d-view" role="tabpanel">
            <img
              src={`${apiUrl}${imagePath || `/pubchem-image?cid=${cid}`}`}
              alt={`${compoundName} 2D structure`}
              loading="lazy"
            />
          </div>
        )}

        {activeView === '3d' && (
          <div className="structure-3d-view" role="tabpanel">
            {threeDStatus === 'loading' && <StructureLoading isEnglish={isEnglish} />}
            {threeDStatus === 'empty' && <StructureEmpty isEnglish={isEnglish} type="3d" />}
            {sdf && (
              <>
                <div ref={viewerHostRef} className="molecule-viewer-canvas" />
                <div className="molecule-viewer-tools">
                  <Rotate3D aria-hidden="true" />
                  <span>{isEnglish ? 'Drag to rotate · Scroll to zoom' : '拖动旋转 · 滚轮缩放'}</span>
                  <div className="molecule-style-toggle" role="group" aria-label={isEnglish ? 'Molecule style' : '分子显示样式'}>
                    <button type="button" className={style === 'stick' ? 'active' : ''} onClick={() => setStyle('stick')}>
                      {isEnglish ? 'Stick' : '球棍'}
                    </button>
                    <button type="button" className={style === 'sphere' ? 'active' : ''} onClick={() => setStyle('sphere')}>
                      {isEnglish ? 'Space fill' : '空间填充'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeView === 'crystal' && (
          <div className="crystal-structure-view" role="tabpanel">
            {crystalStatus === 'loading' && <StructureLoading isEnglish={isEnglish} />}
            {crystalStatus === 'empty' && <StructureEmpty isEnglish={isEnglish} type="crystal" />}
            {crystalStatus === 'ready' && (
              <div className="crystal-record-grid">
                {crystalData.records.map(record => (
                  <article key={record.reference_number} className="crystal-record">
                    {record.image_url && <img src={record.image_url} alt={`${compoundName} crystal structure`} loading="lazy" />}
                    <dl>
                      {record.ccdc_number && <div><dt>CCDC</dt><dd>{record.ccdc_number}</dd></div>}
                      {record.doi && <div><dt>DOI</dt><dd>{record.doi}</dd></div>}
                    </dl>
                    {(record.article_url || record.ccdc_url) && (
                      <a href={record.article_url || record.ccdc_url} target="_blank" rel="noreferrer">
                        {isEnglish ? 'Open original record' : '查看原始记录'} <ExternalLink aria-hidden="true" />
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StructureLoading({ isEnglish }) {
  return (
    <div className="structure-view-message">
      <Loader2 className="structure-loader" aria-hidden="true" />
      <span>{isEnglish ? 'Loading PubChem data…' : '正在加载 PubChem 数据…'}</span>
    </div>
  );
}

function StructureEmpty({ isEnglish, type }) {
  const text = type === '3d'
    ? (isEnglish ? 'No computed 3D conformer is available.' : 'PubChem 暂无可用的计算 3D 构象。')
    : (isEnglish ? 'No crystal structure record is available.' : 'PubChem 暂无晶体结构记录。');
  return <div className="structure-view-message empty">{text}</div>;
}
