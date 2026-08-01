# PubChem PUG View 挥发与分配性质接入设计

## 目标

扩展 FlavorThresholdDB 的 PubChem 集成，通过 PUG View 为单个化合物提供可追溯的挥发与分配性质。第一阶段同时接入沸点、蒸气压、Henry 常数、水中溶解度、实验 LogP/LogKow、密度、熔点和物理状态。

该模块只陈述 PubChem 聚合的数据库注释。它不根据单条物性记录自动推断顶空释放能力、实际基质分配、GC 出峰顺序或香气强度。

## 范围

### 接入字段

1. Boiling Point
2. Vapor Pressure
3. Henry's Law Constant
4. Solubility（在展示层标记为水中溶解度；无法确认介质时保留原文，不强制标为水）
5. LogP（实验 LogP/LogKow）
6. Density
7. Melting Point
8. Physical Description（提取物理状态，同时保留原始描述）

### 不在本阶段实施

- 根据物性自动生成“高挥发”“易进入顶空”等结论。
- 将多个实验值平均或选为唯一推荐值。
- 对无法可靠解析的单位进行猜测式换算。
- PubChem 感官注释、光谱、安全信息或 BioAssay。
- 将多来源物性压缩进现有简洁 CSV。

## 身份与来源原则

- PubChem CID 是 PUG View 查询键。
- InChIKey 继续用于结构一致性核验。
- CAS 和名称只用于前序检索，不直接传给 PUG View。
- PUG REST 的 XLogP 继续显示在基础化学身份中，并明确视为 PubChem 计算属性。
- PUG View 的 LogP/LogKow 记录显示在“挥发与分配性质”中，视为第三方实验或数据库注释。
- 每条记录保留原始文本、条件、Reference Number 和来源链接。

## 上游请求策略

每个 CID 使用一个请求：

```text
GET https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/{CID}/JSON?heading=Experimental%20Properties
```

代理从完整的 Experimental Properties 栏目中提取目标子栏目。该策略避免为八种性质分别发送八次请求，并符合 PubChem 不超过每秒五次请求的使用要求。

## 后端接口

新增：

```text
GET /pubchem-volatile?cid={CID}
```

现有 `/compound?cas=...` 增加 `pubchem_volatile` 字段。PUG View 查询失败时，PubChem 基础属性、FlavorDB2、FEMA、书籍和本地阈值结果继续返回。

缓存键：

```text
pubchem-volatile:{CID}
```

缓存与基础 PubChem 属性分离，以便独立失效和排查格式变化。

## 返回契约

```json
{
  "found": true,
  "cid": "8857",
  "properties": {
    "boiling_point": [],
    "vapor_pressure": [],
    "henrys_law_constant": [],
    "water_solubility": [],
    "experimental_logp": [],
    "density": [],
    "melting_point": [],
    "physical_state": []
  },
  "source": "PubChem PUG View",
  "url": "https://pubchem.ncbi.nlm.nih.gov/compound/8857#section=Experimental-Properties",
  "retrieved_at": "ISO-8601 timestamp",
  "cached": false
}
```

每条性质记录使用统一结构：

```json
{
  "raw_value": "93.2 mm Hg at 25 °C",
  "normalized_value": 93.2,
  "unit": "mmHg",
  "temperature": "25 °C",
  "pressure": "",
  "medium": "",
  "description": "PEER REVIEWED",
  "source": "HSDB",
  "source_url": "",
  "reference_number": 42,
  "evidence_level": "peer_reviewed"
}
```

`normalized_value` 只在数值和单位都能可靠识别时填写。原始文本始终保留，并作为默认展示依据。

## PUG View 解析规则

1. 递归遍历 `Record.Section`，按 `TOCHeading` 识别目标栏目，不依赖固定层级或顺序。
2. 遍历栏目下全部 `Information`，提取 `StringWithMarkup`、`Number`、`Unit`、`Description`、`URL` 和 `ReferenceNumber`。
3. 将 `Record.Reference` 建立为 Reference Number 映射，补充来源名称、文献和链接。
4. 物性原文中的温度、压力和介质采用保守解析：能明确识别才拆分，否则留在 `raw_value`。
5. 同一来源、相同原文的重复记录去重；不同来源或不同条件的相同数值仍分别保留。
6. Physical Description 不拆出气味结论，只识别明确的 solid、liquid、gas、液体、固体或气体状态；完整描述保留。
7. HTML 错误页、异常 JSON 或字段结构变化必须转为上游错误状态，不得显示为“没有数据”。

## 错误状态

- `found: false, status: "no_data"`：PUG View 正常响应，但目标栏目没有记录，或返回 404。
- `found: false, status: "upstream_unavailable"`：429、503、连接超时或临时服务不可用。
- `found: false, status: "invalid_response"`：返回 HTML、无效 JSON 或不符合预期的数据结构。
- `400`：本项目接口收到非法或缺失 CID。

错误响应不得写入长期缓存。有效空结果可以短期缓存，避免重复请求。

## 前端设计

“挥发与分配性质”放在化合物档案的“化学身份”之后、“风味描述”之前。

模块结构：

- 标题区：模块名称、PubChem PUG View 来源标识、原始栏目链接。
- 属性网格：八种性质分别显示记录数量和第一条信息最完整的记录。
- 记录展开：同一性质的其他来源在该属性内部展开，按信息完整度排列，不按数值大小暗示权威性。
- 来源明细：显示原始值、条件、来源名称和原始链接。
- 空状态：只显示“PubChem 暂无该性质记录”，不产生空白大卡片。
- 错误状态：显示“PubChem PUG View 暂时不可用”，与无数据明确区分。

桌面端使用紧凑的响应式网格，移动端改为单列。内部使用轻量分隔线，不再嵌套大型卡片。

## 前端组件边界

新增独立组件：

```text
frontend/src/components/PubChemVolatileProperties.jsx
```

该组件只接收规范化的 `pubchem_volatile` 数据并负责展示，不解析 PUG View 原始 JSON。属性标签、顺序和中英文名称集中配置，避免继续扩大 `App.jsx` 中的条件分支。

## 测试

### 后端单元测试

- 八类栏目均能解析。
- 多来源、多温度、多单位记录保持分离。
- Reference Number 正确映射来源。
- 重复原文去重。
- 无栏目、404、429、503、超时、HTML 响应和无效 JSON。
- 无法可靠解析的原文不产生伪造标准化值。

### 代表性真实数据

- 乙酸乙酯 CID 8857：八类数据覆盖和多来源记录。
- 至少一个缺失 Henry 常数的化合物：部分字段空状态。
- 至少一个常温固体：Physical Description 和熔点。

### 前端与回归

- 属性展开和来源跳转。
- 中英文标签。
- 桌面端和移动端无横向溢出。
- PUG View 失败时其他档案模块正常显示。
- Python 测试、现有书籍检索测试、ESLint、生产构建和浏览器端到端检查。

## 验收标准

1. 单次 PUG View 请求返回并解析八类目标物性。
2. 乙酸乙酯能显示多条可追溯记录，包括温度和来源差异。
3. 计算 XLogP 与实验 LogP 在不同模块展示且来源清晰。
4. 任何记录都不会因为标准化失败而丢失原始值。
5. PUG View 失败不阻断本地阈值、FEMA、FlavorDB2 或 PubChem 基础属性。
6. 页面在桌面和移动端均无横向溢出。
