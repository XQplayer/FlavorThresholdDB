# 岛津 GC-MS 浏览器在线分析设计

日期：2026-08-03  
状态：已由用户授权按本设计直接实施  
范围：在不提高 FlavorThresholdDB 版本号的前提下，使小规模审核用户能够从公网完成岛津步骤 0–6 分析。

## 1. 目标与边界

目标是让获批用户从任意电脑访问公开页面，选择岛津原始 `.xlsx` 与样品/内标信息 `.xlsx`，在浏览器中执行经过验证的 V2 步骤 0–6，实时查看进度，并下载完整结果。分析不依赖项目所有者电脑，也不购买云端计算服务器。

本次不实现 OAV，不修改 V2 科学规则，不提高应用版本号，不把原始工作簿上传到云端，不提供匿名分析。结果压缩包保留 7 天；任务元数据与 QC 摘要保留 90 天。

## 2. 选定方案

采用“静态网页 + 浏览器 Web Worker + Supabase 免费服务”的混合架构：

- GitHub Pages 继续托管 React/Vite 前端。
- Web Worker 在访问者电脑中执行 Excel 解析、步骤 0–6、质量检查和结果封装。
- Supabase Auth 管理注册与登录；profile 状态控制管理员审批。
- Supabase Postgres 保存 90 天任务元数据、阶段状态和 QC 摘要。
- Supabase Storage 私有 bucket 保存 7 天结果压缩包。
- 原始工作簿和样品信息表只存在于当前浏览器内存，不进入 Supabase Storage。

这个方案消除服务器计算费用和多人争抢单个免费实例的问题。代价是分析期间页面必须保持打开，运行速度与访问者电脑性能相关。

## 3. 科学计算兼容层

### 3.1 单一规则来源

现有 `shimadzu-flavor-data-processing` V2 核心仍是科学规则基线。浏览器层不在 React 组件中实现计算规则，而是使用独立的 `shimadzu-browser` 模块与 Worker：

- 可直接复用的纯函数规则以源码快照形式进入浏览器模块，并记录源文件 SHA-256。
- Node 文件系统、私有 `@oai/artifact-tool` 和进程调用由浏览器兼容适配器替换。
- Excel 输入输出由公开、浏览器兼容的工作簿库完成。
- ZIP 结果包由浏览器兼容压缩库生成。
- React 只负责输入、参数、进度、复核、历史和下载，不承载科学算法。

### 3.2 等价性门禁

浏览器实现必须满足：

1. 使用合成边界数据验证无效 CAS、Si/F/Cl、重复 CAS、内标替代、2/3 补建、1/3 剔除、NA、Mean、样本 SD、CV30 和矩阵拆分。
2. 使用固定测试工作簿同时运行 Node V2 与浏览器核心，逐阶段比较规范化 JSON。
3. 最终阶段比较样品顺序、CAS 顺序、数值、状态、QC 代码、删除/补建日志和完整性清单。
4. 允许工作簿样式和 ZIP 时间戳不同；不允许科学数值、行集合、状态或血缘信息不同。
5. 任何阶段出现 `FAIL` 时停止；`REVIEW` 必须明确展示并由用户确认后继续。

## 4. 浏览器分析数据流

1. 页面加载后检查 Supabase 配置、当前 session 和 profile 审批状态。
2. 未登录用户只能查看流程与下载模板；已登录未审批用户显示待审核状态；已审批用户可分析。
3. 用户选择两个 `.xlsx` 文件。前端检查扩展名、MIME、大小和基本 ZIP/XLSX 签名。
4. 文件通过 transferable `ArrayBuffer` 发送到专用 Web Worker。
5. Worker 逐阶段执行，发送 `stage-start`、`stage-progress`、`stage-review`、`stage-complete`、`warning`、`error` 和 `complete` 消息。
6. UI 同步更新流程图、当前工作内容、日志、门禁和总体进度。
7. Worker 在内存中维护阶段数据与虚拟文件集合，生成每一步工作簿、报告、manifest、校验摘要和最终 ZIP。
8. 完成后先允许本地下载，再在用户同意的已登录会话中上传结果 ZIP 至私有 Storage 路径。
9. 上传成功后写入任务的 `result_path`、SHA-256、大小和 `result_expires_at`。
10. 原始 `ArrayBuffer`、中间内存和对象 URL 在完成、取消或失败后主动释放。

## 5. 身份、审批与授权

### 5.1 用户状态

`profiles.approval_status` 取值：`pending`、`approved`、`rejected`、`suspended`。新注册用户默认为 `pending`。

- `pending`：可以登录、查看说明、下载模板，不能开始分析。
- `approved`：可以创建任务、上传自己的结果和重新下载。
- `rejected/suspended`：不能分析或创建新的结果链接。
- 管理员：可以查看用户申请、修改审批状态、查看任务摘要；默认不能下载用户结果文件。

### 5.2 行级安全

所有业务表启用 RLS：

- 用户只能读写 `user_id = auth.uid()` 的任务和阶段记录。
- 用户只能访问 `shimadzu-results/<user_id>/<job_id>/...`。
- 管理员权限通过受控 profile 字段和安全函数判断。
- 客户端仅使用 anon key；service-role key 不进入前端或 GitHub Pages。
- 分析资格同时由 UI 和数据库策略检查，不能只依赖按钮禁用。

## 6. 数据模型

### 6.1 `profiles`

- `id uuid`：对应 `auth.users.id`
- `display_name text`
- `approval_status text`
- `is_admin boolean`
- `requested_at timestamptz`
- `reviewed_at timestamptz`
- `reviewed_by uuid`

### 6.2 `shimadzu_jobs`

- `id uuid`
- `user_id uuid`
- `name text`
- `status text`：`created/running/waiting_review/complete/failed/cancelled/expired`
- `mode text`
- `current_stage integer`
- `progress integer`
- `source_names jsonb`：只记录文件名和大小，不记录原始内容
- `stage_summary jsonb`
- `qc_summary jsonb`
- `result_path text`
- `result_sha256 text`
- `result_size bigint`
- `result_expires_at timestamptz`
- `record_expires_at timestamptz`
- `created_at/updated_at/completed_at timestamptz`

### 6.3 `shimadzu_job_events`

保存经裁剪的阶段事件，不保存整份行级数据：

- `job_id/user_id/stage/event_type/message/severity/created_at`
- 每个任务限制事件总量和单条长度，避免耗尽免费数据库。

## 7. 文件生命周期

- 原始文件：不上传；页面刷新、关闭、取消或完成后不可恢复。
- 本地结果：分析完成后立即提供一次下载，不依赖云上传成功。
- 云端结果：私有 bucket 保存 7 天；使用短时 signed URL 下载。
- 任务记录：保存 90 天；结果删除后任务显示“文件已过期”。
- 清理机制：定时调用受保护的清理函数删除到期 Storage 对象，再清空任务结果字段；删除 90 天前事件和任务。
- 免费额度保护：单个输入默认上限 50 MB，单个结果 ZIP 默认上限 50 MB；用户同时只能运行一个任务；默认最多保留最近 20 个未过期结果。

## 8. UI 设计

现有专业视觉和流程图保留，新增四个区域：

1. 账户状态：登录、退出、待审批、已审批和管理员入口。
2. 本机计算状态：明确显示“计算在当前浏览器执行，原始数据不上传”。
3. 实时任务监控：阶段、子任务、百分比、耗时、门禁、日志、取消按钮和复核动作。
4. 我的分析：最近 90 天任务；显示状态、QC、完成时间、结果到期时间、重新下载或已过期。

如果 Supabase 环境变量缺失，页面进入“本地隐私模式”：允许浏览器分析和本地下载，但不声称登录、审批或云端留存已经启用。

## 9. 错误处理与恢复

- 文件错误：在启动 Worker 前拒绝，并说明具体文件与原因。
- Worker 异常：任务标为失败，保留阶段、错误代码和安全化信息；释放内存。
- 页面关闭：当前浏览器计算终止；再次打开时任务记录显示“已中断”，不能伪装为后台运行。
- 云上传失败：本地下载仍可用，任务显示“计算完成，云端保存失败”，允许在结果仍驻留内存时重试。
- Supabase 不可用：不阻断本地分析；跳过云端历史并清楚提示。
- 配额不足：不删除仍在保留期内的其他用户文件；拒绝新上传并建议立即本地下载。

## 10. 部署与配置

- 不修改 `frontend/package.json` 的应用版本。
- GitHub Pages 发布静态前端、Worker chunk 和浏览器核心。
- Supabase migration 创建表、索引、RLS、私有 bucket 与清理函数。
- GitHub Pages 构建需要 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`；缺失时按本地隐私模式构建。
- 管理员通过一次性 SQL 或受保护函数指定，不能由普通用户自助提升。
- 发布后分别验证匿名、待审批、已审批和管理员四种权限路径。

## 11. 验收标准

1. 公网 URL 可打开，版本号保持不变。
2. 未审批用户无法运行；已审批用户可运行。
3. 测试工作簿能在不访问本地 API 的情况下完成步骤 0–6。
4. 流程图和监控窗口按 Worker 消息实时变化。
5. 最终 ZIP 包含阶段 0–6、报告、manifest、校验文件和完整性验证结果，不含 OAV。
6. 浏览器与 Node V2 的规范化科学结果一致。
7. 原始文件未出现在网络请求或 Supabase Storage 中。
8. 结果只能由所属用户下载，7 天后不可下载；任务 90 天内仍可见。
9. Supabase 未配置或短暂故障时仍可本地分析和下载，并准确显示降级状态。
10. 单元测试、科学回归、ESLint、生产构建、桌面/移动端 E2E 和公网 smoke 全部通过。

## 12. 明确不做

- 不计算 OAV。
- 不支持 `.xls`。
- 不提供服务器后台持续计算。
- 不保存原始工作簿。
- 不开放匿名分析。
- 不在本次发布中实现收费、配额购买、团队空间或长期归档。
