# Shimadzu failure retention and administrator controls

## Goal

让本地部署的 Shimadzu GC–MS 浏览器分析在失败时自动收束并保存已完成证据，同时提供具体错误信息、结果删除控制和管理员审计下载能力；不改变既有科学计算规则、Web Worker 阶段顺序或输出内容契约。

## Scope and decisions

- 计算仍在浏览器 Web Worker 内执行，不新增服务器端计算队列。
- 阶段失败后任务状态统一为 `failed`，不继续保持 `running`。
- 保存失败前已经生成的阶段产物、失败阶段报告、manifest、计数和错误明细，形成可下载的部分结果 ZIP。
- 普通用户只能访问自己的任务、结果和原始工作簿；管理员可以查看全部任务并下载任意用户的完整/部分结果 ZIP、原始工作簿和样品信息表。
- 普通用户只能删除自己的结果 ZIP；管理员可删除任意任务的结果 ZIP。删除不删除任务记录、阶段摘要、错误日志或 QC 日志。
- 完整结果默认保留 7 天；原始工作簿默认保留 90 天；任务记录和审计日志默认保留 90 天。
- OAV、半定量公式、CV30、内标规则和既有文件命名不变。

## Architecture

### Failure lifecycle

`shimadzu.worker.js` and `shimadzuPipeline.js` will produce a structured failure envelope containing `code`, `message`, `stage`, `issues`, and a partial archive. The worker client will preserve the envelope instead of reducing it to only an `Error` message. `ShimadzuAnalysisPage` will mark the task as failed, persist the failed task and stage summary in IndexedDB, update the cloud row, and expose the partial archive for immediate download. A failed task remains retryable from its saved inputs.

### Error presentation

The job bar remains the primary status surface. A persistent alert directly below it shows the stage and human-readable cause. A compact expandable detail panel lists issue code, sample, CAS, severity and message. The generic gate code remains available for machine diagnostics but is no longer the only user-facing explanation.

### Result and input storage

The private `shimadzu-results` bucket will store:

- `user_id/job_id/result.zip` for complete or partial results;
- `user_id/job_id/raw/<original-name>` for the raw Shimadzu workbook;
- `user_id/job_id/samples/<original-name>` for the sample/internal-standard workbook.

The jobs table will retain object paths, hashes, sizes, result kind, and separate expiry timestamps. Uploading raw inputs happens after the job row is created and before Worker execution; an upload failure marks the job failed with a preparation error.

### Administrator view

The signed-in account area will contain a separate administrator task console. It will load all jobs and profiles only for admins, map user display names/emails, show status/current stage/progress/error summary and provide scoped download/delete buttons. Ordinary history remains owner-scoped and unchanged in meaning.

## Data and permission contract

Additive job fields:

- `result_kind` (`complete` or `partial`);
- `raw_path`, `sample_path`, `raw_sha256`, `sample_sha256`, `raw_size`, `sample_size`;
- `raw_expires_at`;

Storage policies will permit owner-or-admin reads/deletes for Shimadzu objects. Table policies will keep owner-or-admin reads, while updates that delete result metadata will be constrained to the owner or an admin. A security-definer deletion function will remove the object and clear only result fields atomically.

## Testing strategy

- Worker-client regression test: error details and partial archive survive conversion to a rejected error.
- Pipeline regression test: a stage-gate failure returns a partial archive and a failed stage summary rather than an unresolved/running task.
- Task-store regression test: failed tasks retain stage summaries, error details and resumable inputs.
- Cloud contract tests: raw-input upload, result deletion, admin job listing and signed downloads use the expected paths and metadata.
- UI contract tests: failure details, partial-result download, owner delete, administrator console and owner/admin visibility are rendered with accessible labels.
- Supabase migration is read-only to existing science outputs and retains existing retention cleanup semantics.

## Non-goals

- No change to scientific algorithms or stage gate thresholds.
- No server-side execution of Excel processing.
- No user-to-user access to task rows, result files or raw input files.
- No deletion of audit logs through the result-delete control.
