# FlavorThresholdDB 项目开发历程

## 1. 项目定位

FlavorThresholdDB 是一个面向风味化学研究的中英文双语检索平台，用于整合多来源香气阈值、风味描述、化学身份和原始来源记录。

项目的核心目标是：

- 支持通过 CAS 号、中文名和英文名检索单一化合物；
- 支持批量清单匹配；
- 保留检测介质、阈值类型、数值、单位、文献来源和页码等可追溯信息；
- 汇集 FEMA、PubChem、FlavorDB 与 FlavorDB2 等外部数据库信息；
- 为风味化合物注释、OAV 分析和科研写作提供结构化数据支持；
- 提供适合 Excel 后续分析的精简版与详细版 CSV 导出。

## 2. 项目边界

本项目仅记录 FlavorThresholdDB 数据库、检索网站、外部数据接口、统计分析和公开部署的研发过程。

Thermo GC-MS 原始报告解析、SI/RSI 筛选、RI/Polar 比对、正构烷烃校准及 4-Octanol 半定量属于独立的数据处理工作流，不属于 FlavorThresholdDB 产品研发历程。相关规则、脚本、示例和批处理产物已单独整理至：

`E:\codex\Projects\Aroma analysis\赛默飞`

## 3. 公开仓库建立前：本地检索原型

项目最初用于整理文献级香气阈值数据，并建立本地查询页面。早期工作重点包括：

1. 将不同文献中的阈值记录统一为可检索结构；
2. 支持按 CAS 号、中英文名称精确或模糊检索；
3. 区分空气、水和其他介质；
4. 区分觉察阈与识别阈；
5. 保留文献来源、阈值单位和原始记录；
6. 支持单物质查询与批量匹配；
7. 初步建立 CSV 导出能力。

这一阶段形成了平台最核心的数据原则：不只返回一个阈值数字，而是同时保留测量环境、阈值类型、单位和来源。

## 4. 文献与风味描述扩展

在基础阈值查询之后，平台加入了《酒类风味化学》书籍检索和 FEMA Flavor Ingredient Library 风味描述。

主要改进包括：

- 建立书籍片段索引；
- 在查询结果中标注书名、页码和片段；
- 将空气、水、酒精或酒类应用等内容分区显示；
- 将 FEMA 风味描述从检测介质结果中独立出来；
- 在导出结果中保留风味描述及其来源；
- 增加引用示例、数据来源和作者申明。

此阶段将项目从单纯的“阈值表查询”扩展为“阈值、风味描述和文献上下文”联合检索工具。

## 5. 科研平台品牌与界面重构

项目随后确定 FlavorThresholdDB 名称，并以“科研品牌 + 科研资源平台”为方向重构首页和检索页。

主要界面演进包括：

- 建立 HXQLab 导航与 FlavorThresholdDB 品牌体系；
- 增加中英文界面切换；
- 将首页与检索工作台分离；
- 统一导航栏、按钮、输入框、筛选项和结果卡片；
- 建立颜色、字体、间距、圆角、阴影和动效 Design Tokens；
- 优化移动端、键盘焦点、减少动态效果模式和横向溢出；
- 增加联系方式弹窗；
- 将数据来源与引用说明改为按需展开。

设计方向逐步从普通后台页面收敛为“Scientific Instrument / Premium Research Database”，强调信息清晰、来源可追溯和科研软件质感。

## 6. 公开发布与部署架构

### 2026-07-29：首次公开发布

提交 `e076b5f` 建立 FlavorThresholdDB 公开版本，随后通过提交 `9eceb0d` 配置 GitHub Pages 自动部署。

公开地址：

- 首页：<https://xqplayer.github.io/FlavorThresholdDB/>
- 检索页：<https://xqplayer.github.io/FlavorThresholdDB/aroma-threshold/>

### 外部数据代理

由于 FEMA 等查询不能仅靠静态 GitHub Pages 完成，项目增加 Python 外部数据代理，并通过 Render Blueprint 部署。

当前公共 API：

`https://flavorthresholddb-api.onrender.com`

前端通过该服务访问 `/fema`、`/compound`、`/pubchem` 和 `/flavordb`。GitHub Actions 使用仓库变量 `FEMA_API_URL` 将线上 API 地址注入构建过程。

## 7. 版本演进

### v1.1.0：公开界面与部署稳定化

时间：2026-07-30

相关提交：

- `659e15b`：重构科研数据库界面；
- `89d3434`：支持检索页直接链接；
- `d5ba82f`：修复页面元数据和路由图标。

主要成果：

- 首页、导航和检索页形成统一视觉体系；
- 完成 favicon、页面标题和移动端适配；
- 修复 GitHub Pages 子路径和直接访问检索页的问题；
- 建立可持续维护的公开网站结构。

### v1.2.0：实时统计与热门检索

时间：2026-07-30

相关提交：

- `fb440e4`：增加实时活动与热门检索；
- `091f8b6`：补充 Supabase 客户端模块。

主要成果：

- 接入 Supabase；
- 记录累计访问、当前在线、累计检索和今日检索；
- 建立热门化合物矩阵图；
- 矩形面积随检索次数变化；
- 支持显示常用英文名、悬停查看 CAS 与中文名、点击进入检索结果；
- 增加数据库迁移脚本和每日统计逻辑。

### v1.3.0：多源化合物研究工作台

时间：2026-07-31

相关提交：`303e537`

这是项目功能范围最大的一次升级。平台由阈值检索页扩展为多源化合物研究工作台。

主要成果：

- 建立化合物档案，统一显示中文名、常用英文名、CAS 和 PubChem CID；
- 接入 PubChem PUG REST；
- 接入 FlavorDB；
- 保留 FEMA 与 FlavorDB 各自的风味描述，不混淆来源；
- 增加分子式、分子量、IUPAC、XLogP、TPSA、HBD/HBA 和 SMILES；
- 增加 PubChem 2D 结构、交互式 3D 构象和晶体结构记录；
- 支持结构图片与 SDF、JSON、XML、ASNT 等坐标或记录下载；
- 接入 RDKit，并使用 SMARTS 规则识别主要化合物类别；
- 支持醇、酚、醛、酮、羧酸、酯、醚、内酯、酸酐、酰胺、胺、吡嗪、吡啶、含硫化合物、呋喃、烯烃、炔烃和芳香环等类别；
- 阈值记录按文献年份和阈值大小排序，优先展示较新且较低的记录；
- 其余阈值记录折叠显示，降低信息拥挤；
- 建立 FEMA、FlavorDB、PubChem、不同介质和阈值类型之间一致的来源色彩体系；
- 导出结果遵循当前筛选状态；
- 修复 CAS 在 Excel 中被自动转换为日期的问题。

### v1.3.1：CSV 导出模式

时间：2026-07-31

相关提交：`4cbe586`

主要成果：

- 增加“精简版”和“详细版”两种 CSV 导出；
- 精简版每个化合物一行；
- 精简版包含序号、CAS、中文名、常用英文名、化合物类别、分子式、FEMA 风味描述及所选介质阈值；
- 多种介质的阈值横向展示；
- 详细版每条阈值记录一行，保留全部来源、介质、阈值类型、数值、单位、数据库和书籍结果；
- 文件名明确标识导出格式；
- CAS 继续使用 Excel 安全格式。

## 8. 当前数据来源

平台当前整合五类主要来源：

1. Van Gemert (2011), *Flavour Thresholds*；
2. Fan, W. L., & Xu, Y. (2020), *Wine Flavor Chemistry*；
3. FEMA Flavor Ingredient Library；
4. PubChem PUG REST；
5. FlavorDB。

平台尽可能保留原始来源、介质、阈值类型、数值、单位、页码和外部链接。FlavorDB 派生数据保留来源标注及其 CC BY-NC-SA 3.0 许可信息。

## 9. 当前技术架构

### 前端

- React 19；
- Vite 8；
- Lucide React；
- 3Dmol.js；
- RDKit WebAssembly；
- D3 hierarchy；
- SheetJS；
- Supabase JavaScript Client。

### 外部数据服务

- Python 代理服务；
- FEMA 本地缓存；
- PubChem 与 FlavorDB 聚合接口；
- Render 公网部署与健康检查。

### 数据分析

- Supabase PostgreSQL；
- 访问与检索事件记录；
- 每日检索统计；
- 热门化合物聚合与可视化。

### 持续部署

- GitHub 主仓库：<https://github.com/XQplayer/FlavorThresholdDB>；
- GitHub Actions 自动构建；
- GitHub Pages 托管静态前端；
- Render 托管外部数据 API；
- `dist/404.html` 支持 GitHub Pages 路由回退。

## 10. 当前质量保障

项目采用以下基础检查：

```bash
cd frontend
pnpm run lint
pnpm run build
```

历次迭代还重点检查：

- 首页与检索页；
- 桌面、平板和移动端；
- 横向溢出；
- 中英文切换；
- 键盘焦点；
- `prefers-reduced-motion`；
- GitHub Pages 子路径；
- Render API 健康状态；
- FEMA、PubChem 和 FlavorDB 公网返回；
- CSV 字段、筛选状态与 CAS 格式。

## 11. 当前稳定版本

- 当前正式版本：`v1.4.0`；当前候选版本：`v1.5.0`；
- 当前主分支：`main`；
- 当前版本标签提交：`5af7619`；
- 当前主分支提交：`f0fadfb`；
- 本地主仓库：`E:\codex\Projects\FlavorThresholdDB`；
- 本地发布候选：`E:\codex\Projects\FlavorThresholdDB\_local\release-candidates`；
- 本地源码备份：`E:\codex\Projects\FlavorThresholdDB\_local\backups`。

### 未发布候选（2026-08-02）

- 当前开发分支：`codex/pubchem-volatile-properties`，尚未合并 `main`，不属于公网稳定版本；
- 新增 FlavorDB2 天然来源、食材实体、食材—化合物关系和反向食材详情；
- 新增 PubChem PUG View 八组挥发与分配实验性质，保留逐条原文、来源和链接；
- PubChem 实验性质缓存使用模式版本、解析器版本和 30 天 TTL，旧解析缓存自动失效；
- Excel 文件上传已暂停，SheetJS 已移除；批量文本检索和 CSV 导出继续保留；
- 本地服务统一为前端 `127.0.0.1:5174` 与代理 `127.0.0.1:8787`，采用隐藏窗口、项目进程核验、单实例复用和健康检查；
- E2E 验证产物写入 `_local/verification`，不进入发布源码。
- 新增 MassBank 与 GNPS/GNPS2 开放光谱层：按 InChIKey/CAS 检索、单谱峰表、许可门控下载、Da/ppm 镜像比较、匹配峰高亮和 JSON/CSV/SVG 比较导出；
- GNPS2 精简元数据索引保存在 `_local/indexes/gnps_spectra.sqlite`，不进入 Git；检索缓存 24 小时，明确开放许可峰表缓存 30 天，待核许可峰表仅保存在内存；
- 当前候选验证：代理与运行控制 Python 测试 51/51、书籍索引 60/60、前端测试 37/37、ESLint、生产构建、生产依赖审计及桌面/移动端 E2E 全部通过。

## 12. 后续维护原则

1. 新功能首先明确其数据来源和许可边界；
2. 相同来源在筛选按钮、结果卡片和导出字段中保持统一颜色；
3. 不合并会导致语义丢失的阈值记录；
4. 保留每条记录的原始来源和核验链接；
5. 新增数据源时同步更新首页数据来源数量、引用指南、README 和导出规则；
6. 每次发布前运行 lint、build、桌面与移动端检查，并验证公共 API；
7. 发布前从明确的本地 Git 提交生成只读候选快照，公网验证通过后再创建源码备份；
8. 独立实验数据处理流程不得混入 FlavorThresholdDB 产品研发历程。

## 13. 《酒类风味化学》知识索引持续优化（2026-08-01）

- 历史任务回查 ID：`019facbe-c69c-7403-8872-4cd7aea6b089`；
- 原始 PDF 与 640 页 OCR 缓存保持只读，所有修正通过可审计规则和逐页证据叠加；
- 当前全量索引包含 4,863 个文本块、628 个 CAS 实体和 1,970 条结构化阈值（已去除完全重复项，并补录 4 条跨 OCR 分块遗漏的来源页阈值组）；
- 已建立 95 条逐页核验阈值金标准，当前 95/95 通过；实体金标准当前 6/6 通过；
- 精确 CAS 回退恢复了因括号和 OCR 排版未能按完整条目解析的实体；无 CAS 新化合物会终止旧 CAS 继承，并以名称级身份继续关联；
- 已对两处原书 CAS–名称错配建立 PubChem 权威核验层，保留原书身份，同时向网站提供规范主库身份和核验链接；
- 全部 17 个检测到的编号表均已完成逐行源页核验（180 行），可按正确化合物名称和单元格内容检索，网站直接显示结构化表格；
- 已完成全部 `pg/L` 单位歧义的逐页核验：OCR 误识别通过证据清单修正，原书真实 `pg/L` 原值保留并标为来源页已核实；当前未决歧义单位为 0；
- 新增来源页身份覆盖与跨化合物过渡块拆分，修复 α-蒎烯 CAS 行漏识别及 PCA 阈值误挂到 TBA 的问题；网站显示修正 CAS、原因和页图依据；
- 已恢复（S）-莫雷德、跨页 Leu-Gly、多条带肽级前缀的肽主体，以及被拆成两块的香叶基丙酮 CAS 3796-70-1；当前缺失身份为 0；
- 已逐页核实高数量级阈值、介质缺失和 OCR 科学计数法；当前未知介质、未决单位、缺失身份、可疑数量级及高风险规范身份冲突均为 0；保留 2 条原书 CAS–名称冲突与低风险名称变体的来源追溯；
- 阈值记录新增前鼻/后鼻路径、来源页介质补全、主体名称补全和完全重复去重；第 27 页三氯茴香醚阈值已按原页修正为 `3×10⁻⁵ μg/kg`；
- 氯化钠跨 OCR 分块造成的白葡萄汁、红葡萄酒与换算值遗漏已按第 607 页原图补录，并以 `source_verified_page_supplement` 单独追溯；
- 新增构建阻断型质量门槛，覆盖页数/记录/实体/阈值下限、异常上限、固定查询、错误单位模式及全部金标准；
- Python 书籍索引管线测试 60/60；当前候选的完整测试数量以发布前最终验证结果为准。

## 14. 公共光谱与生化证据层（2026-08-02）

- MassBank 与 GNPS 已统一为开放光谱检索、单谱峰表、许可门控下载和镜像比较接口；前端新增峰表滚动视图与 PNG 镜像图导出；
- GNPS 公网索引采用“本地构建、外部分发、清单校验、原子安装”的方式，约 1 GB SQLite 与生成缓存均保留在 `_local/`，不进入 Git；
- NIST Chemistry WebBook 仅接入 CAS 原始页面跳转和栏目存在性标记，不复制或再分发受限制光谱；
- 新增 ChEBI → Rhea → UniProt 关系链：只对结构/CAS 已核验实体自动展开，名称候选会停止扩展；
- 生化关系卡片保留 ChEBI、Rhea、UniProt 原始记录链接，并明确不得将数据库关联解释为食材存在、微生物来源或风味形成因果；
- 本阶段仍需在正式发布前完成完整 Python/前端/E2E 回归，并在外部发布 GNPS 索引资产后写入稳定的轻量清单 URL。

## 15. 基因、物种与代谢组研究上下文（2026-08-02）

- 新增 NCBI Gene 与 NCBI Taxonomy 公共接口；仅沿已核验的 ChEBI → Rhea → UniProt 蛋白证据继续查询基因和物种，不按化合物名称臆测关联；
- 新增 MetaboLights 公共研究检索，保留 MTBLS 稳定编号、原始研究链接、命中总数与最多 10 条预览；
- BRENDA 根据已核验蛋白中的 EC 编号提供原站记录链接；HMDB 因再分发许可边界采用仅链接模式，不抓取或缓存其受限数据；
- 新增 `/biological-context/resolve` 聚合接口和前端“基因、物种与代谢组研究”卡片，分别显示各来源状态并隔离上游失败；
- 乙酸乙酯真实网络验证返回 3 个 NCBI Gene 记录、14 个物种分类、78 项 MetaboLights 命中（展示前 10 项）、2 个 BRENDA EC 链接；相关后端契约测试、60 项前端测试、ESLint、生产构建和桌面/移动端 E2E 均通过。

## 16. 生物活性与靶点证据（2026-08-02）

- 新增 PubChem BioAssay、ChEMBL、GtoPdb 与 BindingDB 聚合接口；各来源独立返回状态和原始记录链接；
- PubChem BioAssay 按 CID 查询并保留 AID、活性结果、靶点、实验名称和 PubMed 标识；ChEMBL 必须先通过完整 InChIKey 精确匹配 molecule，再查询 activity；
- GtoPdb 禁止直接使用会忽略 InChIKey 条件的全局 interactions 接口，必须先解析精确 ligand ID；BindingDB 仅允许结构相似度 1.0 的查询；
- 前端新增分来源切换、长列表滚动和精确匹配说明，明确体外数据库活性不能直接解释为生理效应、香气感知或因果；
- 乙酸乙酯实测返回 PubChem BioAssay 606 条（页面保留前 100 条）和 ChEMBL 41 条；GtoPdb、BindingDB 精确检索均为无记录，不以相似化合物填充。

## 17. 蛋白结构证据（2026-08-02）

- 新增 RCSB PDB、AlphaFold DB 与 GPCRdb 结构证据接口，输入严格来自 ChEBI → Rhea → UniProt 链中的 accession；
- RCSB PDB 记录标为实验结构并链接结构页与 mmCIF 下载；AlphaFold DB 标为预测模型并保留版本及 global pLDDT；GPCRdb 必须精确匹配 UniProt accession；
- 前端将实验结构、预测模型和 GPCR 受体分栏显示，明确 AlphaFold 模型不是实验性配体—蛋白复合物证据；
- 乙酸乙酯实测得到 2 个 RCSB PDB 实验结构、14 个 AlphaFold 预测模型和 0 个精确 GPCRdb 记录；三来源并发查询并按来源 TTL 缓存。
