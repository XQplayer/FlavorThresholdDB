import BiochemicalRelationships from '../../BiochemicalRelationships';
import BiologicalContext from '../../BiologicalContext';
import BioactivityEvidence from '../../BioactivityEvidence';
import StructureEvidence from '../../StructureEvidence';

export function BiochemistryChapter({ apiUrl, cas, inchikey, name, isEnglish = false }) {
  return (
    <div className="mechanism-chapter mechanism-chapter--biochemistry">
      <p className="scientific-chapter-note">
        {isEnglish
          ? 'These are identifier-linked biochemical associations and supporting records, not evidence of aroma-formation causality.'
          : '本章仅呈现标识符关联的生化关系与支持证据，不据此推断风味形成因果。'}
      </p>
      <BiochemicalRelationships apiUrl={apiUrl} cas={cas} inchikey={inchikey} compoundName={name} isEnglish={isEnglish} />
      <BiologicalContext apiUrl={apiUrl} cas={cas} inchikey={inchikey} compoundName={name} isEnglish={isEnglish} />
    </div>
  );
}

export function BioactivityChapter({ apiUrl, cid, inchikey, smiles, isEnglish = false }) {
  return (
    <div className="mechanism-chapter mechanism-chapter--bioactivity">
      <p className="scientific-chapter-note">
        {isEnglish
          ? 'Assay and target associations are condition-specific evidence, not proof of physiological or sensory causality.'
          : '活性与靶点关联是特定实验条件下的证据，不等同于生理效应或感官因果。'}
      </p>
      <BioactivityEvidence apiUrl={apiUrl} cid={cid} inchikey={inchikey} smiles={smiles} isEnglish={isEnglish} />
    </div>
  );
}

export function ProteinStructuresChapter({ apiUrl, cas, inchikey, name, isEnglish = false }) {
  return (
    <div className="mechanism-chapter mechanism-chapter--structures">
      <p className="scientific-chapter-note">
        {isEnglish
          ? 'Experimental archives and predicted models are kept distinct; neither alone establishes a ligand–protein mechanism.'
          : '实验结构档案与预测模型分开展示；二者均不能单独证明配体—蛋白作用机制。'}
      </p>
      <StructureEvidence apiUrl={apiUrl} cas={cas} inchikey={inchikey} compoundName={name} isEnglish={isEnglish} />
    </div>
  );
}
