import { useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  Activity,
  AlertCircle,
  ArrowDownToLine,
  Check,
  ChevronRight,
  Circle,
  Download,
  CloudDownload,
  FileCheck2,
  FileSpreadsheet,
  FlaskConical,
  Gauge,
  Layers3,
  Loader2,
  Network,
  Play,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  Upload,
  UserCheck,
  UserRound,
  LogOut,
  History,
} from 'lucide-react'
import { createShimadzuApi, getEnginePresentation, getMonitorStageIndex, getStageProgress } from '../../lib/shimadzuApi'
import { assertWorkbookFile, browserEnginePresentation } from '../../lib/shimadzuBrowserContract'
import { createShimadzuWorkerClient } from '../../lib/shimadzuWorkerClient'
import { createShimadzuCloud } from '../../lib/shimadzuCloud'
import { analyticsEnabled, supabase } from '../../lib/supabase'
import './ShimadzuAnalysisPage.css'

gsap.registerPlugin(useGSAP, ScrollTrigger)

const API_BASE = (import.meta.env.VITE_FEMA_API_URL || 'http://127.0.0.1:8787').replace(/\/$/, '')

const WORKFLOW = [
  { index: 0, short: '输入配置', label: '输入配置与清单', description: '核对工作表、样品分组、内标参数与名称映射。', work: ['读取原始工作簿与样品信息表', '匹配样品名称和三平行分组', '复算内标终浓度并建立输入清单'] },
  { index: 1, short: 'Hit #1', label: 'Hit #1 整理', description: '逐样品提取峰表与相似度检索中的第一候选。', work: ['定位 MC Peak Table', '匹配 Spectrum# 与 Hit #1', '保存源工作表和原始行号'] },
  { index: 2, short: '筛查', label: '化合物筛查', description: '清除无效 CAS、Si/F/Cl，并按 RI 规则处理重复峰。', work: ['执行元素与 CAS 有效性筛查', '计算单峰 RI 偏差', '合并相邻重复峰或保留最优记录'] },
  { index: 3, short: '平行处理', label: '平行峰面积处理', description: '定位内标，补建缺失内标，并按 2/3 与 1/3 规则处理。', work: ['定位配置内标与替代内标', '补建缺失内标峰面积', '执行三平行检出与缺失处理'] },
  { index: 4, short: '半定量', label: '跨样品合并与半定量', description: '跨样品按 CAS 合并，保留峰面积并计算浓度。', work: ['构建全样品 CAS 并集', '按样品内标计算半定量浓度', '记录 NA、响应因子和计算异常'] },
  { index: 5, short: '统计与 QC', label: '统计、CV、CAS 与 QC', description: '计算 Mean、样本 SD、CV30，并完成质量检查。', work: ['计算 Mean、SD 和 CV', '生成 CV30 前后四种结果', '检查 NA、重复 CAS、公式与内标回算'] },
  { index: 6, short: '矩阵拆分', label: '按矩阵拆分', description: '输出作图准备矩阵与完整项目 CAS 清单。', work: ['按矩阵名称拆分结果', '输出三个平行与 Mean 加 SD 版本', '执行完整性验证并封装结果'] },
]

const STATUS_LABELS = {
  created: '等待运行', queued: '排队中', running: '处理中', saving: '云端保存中', waiting_review: '等待复核', complete: '已完成', failed: '运行失败',
  pending: '未开始', PASS: '通过', WARN: '警告', REVIEW: '需复核', FAIL: '失败',
}

const APPROVAL_LABELS = { pending: '等待管理员审批', approved: '已获准使用', rejected: '申请未通过', suspended: '账号已停用' }

function AccountPanel({ cloud, session, profile, loading, error, onRefresh }) {
  const [registering, setRegistering] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [pendingUsers, setPendingUsers] = useState([])
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState('')
  const [bootstrapCode, setBootstrapCode] = useState('')

  useEffect(() => {
    if (!profile?.is_admin) return
    cloud.pendingUsers().then(setPendingUsers).catch(value => setMessage(value.message))
  }, [cloud, profile?.is_admin])

  const authenticate = async event => {
    event.preventDefault()
    setWorking(true); setMessage('')
    try {
      if (registering) {
        await cloud.signUp(email.trim(), password, displayName.trim(), window.location.href)
        setMessage('注册申请已提交。若邮箱验证已启用，请先完成邮件验证；之后等待管理员审批。')
      } else {
        await cloud.signIn(email.trim(), password)
        setMessage('登录成功，正在读取账号权限。')
      }
      await onRefresh()
    } catch (value) { setMessage(value.message) } finally { setWorking(false) }
  }

  const review = async (userId, status) => {
    setWorking(true); setMessage('')
    try {
      await cloud.reviewUser(userId, status)
      setPendingUsers(await cloud.pendingUsers())
      setMessage(status === 'approved' ? '已批准该账号。' : '已拒绝该账号。')
    } catch (value) { setMessage(value.message) } finally { setWorking(false) }
  }

  const claimAdmin = async event => {
    event.preventDefault()
    setWorking(true); setMessage('')
    try {
      await cloud.claimFirstAdmin(bootstrapCode.trim())
      setBootstrapCode('')
      setMessage('管理员初始化完成。')
      await onRefresh()
    } catch (value) { setMessage(value.message) } finally { setWorking(false) }
  }

  if (!cloud.configured) {
    return <section className="shimadzu-account local"><ShieldCheck /><div><strong>本地隐私模式</strong><p>当前构建未连接云端账号；仍可在浏览器内计算并立即下载，关闭页面后不保留结果。</p></div></section>
  }

  if (loading) return <section className="shimadzu-account"><Loader2 className="spin" /><div><strong>正在核验账号</strong><p>读取登录会话与审批状态。</p></div></section>

  if (!session) return (
    <section className="shimadzu-account shimadzu-reveal" aria-labelledby="account-title">
      <div className="shimadzu-account-copy"><UserRound /><div><h2 id="account-title">小组账号</h2><p>原始工作簿不会上传。登录并通过管理员审批后，可计算并保留结果 ZIP 7 天、任务记录 90 天。</p></div></div>
      <form onSubmit={authenticate} className="shimadzu-auth-form">
        {registering && <input aria-label="姓名" placeholder="姓名或小组内称呼" value={displayName} onChange={event => setDisplayName(event.target.value)} required />}
        <input aria-label="邮箱" type="email" placeholder="邮箱" value={email} onChange={event => setEmail(event.target.value)} required />
        <input aria-label="密码" type="password" minLength="6" placeholder="密码（至少 6 位）" value={password} onChange={event => setPassword(event.target.value)} required />
        <button type="submit" disabled={working}>{working ? <Loader2 className="spin" /> : <UserCheck />}{registering ? '提交注册申请' : '登录'}</button>
        <button type="button" className="text" onClick={() => { setRegistering(value => !value); setMessage('') }}>{registering ? '已有账号，返回登录' : '没有账号，申请使用'}</button>
      </form>
      {(message || error) && <p className="shimadzu-account-message">{message || error}</p>}
    </section>
  )

  return (
    <section className="shimadzu-account signed-in shimadzu-reveal" aria-labelledby="account-title">
      <div className="shimadzu-account-copy"><UserRound /><div><h2 id="account-title">{profile?.display_name || session.user.email}</h2><p>{session.user.email} · {APPROVAL_LABELS[profile?.approval_status] || '正在建立审批档案'}</p></div></div>
      <span className={`shimadzu-approval state-${profile?.approval_status || 'pending'}`}>{profile?.is_admin ? '管理员 · ' : ''}{APPROVAL_LABELS[profile?.approval_status] || '待确认'}</span>
      <button className="shimadzu-signout" type="button" onClick={() => cloud.signOut()}><LogOut />退出</button>
      {(message || error) && <p className="shimadzu-account-message">{message || error}</p>}
      {profile?.approval_status === 'pending' && <form className="shimadzu-bootstrap" onSubmit={claimAdmin}><div><strong>首次部署管理员初始化</strong><p>仅首位管理员使用；初始化成功后该入口不能再次认领管理员。</p></div><input aria-label="管理员初始化码" value={bootstrapCode} onChange={event => setBootstrapCode(event.target.value)} placeholder="管理员初始化码" required /><button type="submit" disabled={working}>认领管理员</button></form>}
      {profile?.is_admin && pendingUsers.length > 0 && <div className="shimadzu-approval-queue"><h3>待审批账号</h3>{pendingUsers.map(user => <div key={user.id}><span>{user.display_name || user.id}</span><button type="button" disabled={working} onClick={() => review(user.id, 'approved')}>批准</button><button type="button" disabled={working} onClick={() => review(user.id, 'rejected')}>拒绝</button></div>)}</div>}
    </section>
  )
}

function HistoryPanel({ jobs, onDownload }) {
  if (!jobs.length) return null
  return (
    <section className="shimadzu-history shimadzu-reveal" aria-labelledby="history-title">
      <div className="shimadzu-region-heading"><div><h2 id="history-title"><History />最近任务</h2><p>任务与 QC 摘要保留 90 天；结果包完成后保留 7 天。</p></div><span>私有记录</span></div>
      <div className="shimadzu-history-table" role="table">
        {jobs.map(item => {
          const downloadable = item.result_path && new Date(item.result_expires_at) > new Date()
          return <div key={item.id} role="row"><div><strong>{item.name}</strong><small>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</small></div><span className={`shimadzu-job-badge ${item.status}`}>{STATUS_LABELS[item.status] || item.status}</span><span>步骤 {item.current_stage}/7 · {item.progress}%</span>{downloadable ? <button type="button" onClick={() => onDownload(item)}><CloudDownload />重新下载</button> : <small>{item.status === 'complete' || item.status === 'expired' ? '结果已过期' : '暂无结果'}</small>}</div>
        })}
      </div>
    </section>
  )
}

const stageStatus = (job, index) => job?.stages?.[index]?.status || 'pending'

const StageMark = ({ status }) => {
  if (status === 'running') return <Loader2 className="spin" aria-hidden="true" />
  if (['PASS', 'WARN', 'REVIEW'].includes(status)) return <Check aria-hidden="true" />
  if (status === 'FAIL') return <AlertCircle aria-hidden="true" />
  return <Circle aria-hidden="true" />
}

const TemplateLink = ({ href, children }) => (
  <a className="shimadzu-template-link" href={href} download>
    <ArrowDownToLine aria-hidden="true" />
    {children}
  </a>
)

const FilePicker = ({ label, hint, file, onChange, inputRef, templateHref, templateLabel }) => (
  <div className={`shimadzu-upload-slot${file ? ' has-file' : ''}`}>
    <label className="shimadzu-file-picker">
      <input ref={inputRef} type="file" accept=".xlsx" onChange={event => onChange(event.target.files?.[0] || null)} />
      <span className="shimadzu-file-icon">{file ? <FileCheck2 aria-hidden="true" /> : <FileSpreadsheet aria-hidden="true" />}</span>
      <span className="shimadzu-file-copy">
        <strong>{file?.name || label}</strong>
        <small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · 已准备` : hint}</small>
      </span>
      <span className="shimadzu-file-action">{file ? '更换文件' : '选择文件'}</span>
    </label>
    <TemplateLink href={templateHref}>{templateLabel}</TemplateLink>
  </div>
)

function WorkflowMap({ job }) {
  const activeIndex = job?.stages?.findIndex(stage => stage.status === 'running') ?? -1
  return (
    <section className="shimadzu-workflow shimadzu-reveal" aria-labelledby="workflow-title">
      <div className="shimadzu-section-intro">
        <div>
          <h2 id="workflow-title">分析思路与七步流程</h2>
          <p>先保留原始证据，再逐步收敛化合物与平行样品，最后计算浓度、统计质量并输出作图矩阵。任何阶段未通过门禁，后续步骤都会停止。</p>
        </div>
        <div className="shimadzu-method-principles" aria-label="分析原则">
          <span><ShieldCheck />原始证据不覆盖</span>
          <span><Layers3 />每步独立输出</span>
          <span><Gauge />QC 门禁后推进</span>
        </div>
      </div>
      <div className="shimadzu-flow-track" role="list" aria-label="岛津气质分析流程图">
        {WORKFLOW.map((stage, position) => {
          const status = stageStatus(job, stage.index)
          const isActive = activeIndex === stage.index
          return (
            <div key={stage.index} className={`shimadzu-flow-node state-${status}${isActive ? ' active' : ''}`} role="listitem" data-testid="workflow-node" aria-current={isActive ? 'step' : undefined}>
              <div className="shimadzu-flow-node-head">
                <span className="shimadzu-flow-marker"><StageMark status={status} /></span>
                <span className="shimadzu-flow-index">{String(stage.index).padStart(2, '0')}</span>
              </div>
              <strong>{stage.short}</strong>
              <small>{stage.description}</small>
              {position < WORKFLOW.length - 1 && <ChevronRight className="shimadzu-flow-arrow" aria-hidden="true" />}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LiveMonitor({ job, capabilities, engine: engineOverride }) {
  const engine = engineOverride || getEnginePresentation(capabilities)
  const selectedIndex = getMonitorStageIndex(job, WORKFLOW.length)
  const stage = WORKFLOW[selectedIndex]
  const liveStage = job?.stages?.[selectedIndex]
  const log = [...(job?.stages || [])].reverse().find(item => item.log_tail)?.log_tail
  const monitorState = !job ? 'standby' : job.status
  const title = !job
    ? '等待输入文件'
    : job.status === 'complete'
      ? '完整性验证已通过'
      : job.status === 'saving'
        ? '计算完成，正在保存私有结果包'
      : job.status === 'waiting_review'
        ? `等待复核：${stage.label}`
        : job.status === 'failed'
          ? '流程已在异常节点停止'
          : `正在执行：${stage.label}`
  return (
    <section className={`shimadzu-monitor shimadzu-reveal state-${monitorState}`} aria-labelledby="monitor-title">
      <div className="shimadzu-monitor-toolbar">
        <div className="shimadzu-monitor-title" role="status" aria-live="polite">
          <span className="shimadzu-live-dot" />
          <div><h2 id="monitor-title">实时分析监控</h2><p>{title}</p></div>
        </div>
        <span className="shimadzu-engine-chip"><Activity />{engine.chip}</span>
      </div>
      <div className="shimadzu-monitor-body">
        <div className="shimadzu-current-work">
          <p className="shimadzu-monitor-label">{job?.status === 'running' ? '本阶段工作范围' : '当前工作内容'}</p>
          <h3>{job ? stage.label : '上传文件后建立分析任务'}</h3>
          <ul>
            {(job ? stage.work : ['校验两个 .xlsx 文件', '读取样品与内标参数', '建立步骤 0 至步骤 6 作业目录']).map((item, index) => (
              <li key={item} className={job?.status === 'running' && index === 0 ? 'working' : ''}>
                {job?.status === 'running' && index === 0
                  ? <Loader2 className="spin" />
                  : ['complete', 'waiting_review'].includes(job?.status)
                    ? <Check />
                    : <Circle />}
                {item}
              </li>
            ))}
          </ul>
          <div className="shimadzu-monitor-metadata">
            <span>节点 <strong>{job ? `${selectedIndex + 1}/7` : '0/7'}</strong></span>
            <span>门禁 <strong>{liveStage?.can_advance === false ? '停止' : liveStage?.can_advance === true ? '可推进' : '待检查'}</strong></span>
            <span>刷新 <strong>1.5 s</strong></span>
          </div>
        </div>
        <div className="shimadzu-console">
          <div className="shimadzu-console-heading"><TerminalSquare /><span>运行日志</span><small>{job?.updated_at ? new Date(job.updated_at).toLocaleTimeString('zh-CN', { hour12: false }) : '尚未启动'}</small></div>
          <pre aria-live="polite">{log || (job ? '任务已建立，等待分析引擎输出。' : '系统处于待机状态。\n选择两个模板或正式工作簿后开始分析。')}</pre>
        </div>
      </div>
    </section>
  )
}

export default function ShimadzuAnalysisPage({ onHome, onThresholds, isEnglish, setInterfaceLanguage }) {
  const api = useMemo(() => createShimadzuApi(API_BASE), [])
  const cloud = useMemo(() => createShimadzuCloud(supabase), [])
  const pageRef = useRef(null)
  const rawInputRef = useRef(null)
  const samplesInputRef = useRef(null)
  const workerClientRef = useRef(null)
  const resultUrlRef = useRef('')
  const activeJobIdRef = useRef('')
  const cloudSyncRef = useRef(Promise.resolve())
  const stageSummaryRef = useRef([])
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [rawFile, setRawFile] = useState(null)
  const [samplesFile, setSamplesFile] = useState(null)
  const [name, setName] = useState('岛津气质分析')
  const [mode, setMode] = useState('continuous')
  const [job, setJob] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [history, setHistory] = useState([])
  const [cloudLoading, setCloudLoading] = useState(analyticsEnabled)
  const [cloudError, setCloudError] = useState('')

  const refreshCloud = async (knownSession = undefined) => {
    if (!cloud.configured) return
    setCloudLoading(true); setCloudError('')
    try {
      const activeSession = knownSession === undefined ? await cloud.session() : knownSession
      setSession(activeSession)
      if (!activeSession) { setProfile(null); setHistory([]); return }
      const nextProfile = await cloud.profile(activeSession.user.id)
      setProfile(nextProfile)
      setHistory(await cloud.listJobs())
    } catch (value) {
      setProfile(null); setHistory([])
      setCloudError(value.code === 'PGRST205' || value.code === '42P01' ? '云端数据表尚未初始化，管理员需要先应用随本次发布提供的 Supabase 迁移。' : value.message)
    } finally { setCloudLoading(false) }
  }

  useEffect(() => {
    document.title = '岛津气质分析 | HXQLab'
    workerClientRef.current = createShimadzuWorkerClient()
    return () => {
      workerClientRef.current?.dispose()
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [api])

  useEffect(() => {
    if (!cloud.configured) return undefined
    refreshCloud()
    return cloud.onAuthChange(nextSession => refreshCloud(nextSession))
    // cloud is stable for the lifetime of this page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud])

  useGSAP(() => {
    const revealTargets = gsap.utils.toArray('.shimadzu-reveal')
    const heroTargets = gsap.utils.toArray('.shimadzu-hero-animate')

    if (reducedMotion) {
      gsap.set([...heroTargets, ...revealTargets, '.shimadzu-flow-node'], { autoAlpha: 1, x: 0, y: 0, clearProps: 'transform' })
      return
    }

    gsap.timeline({ defaults: { duration: 0.76, ease: 'power3.out' } })
      .from(heroTargets, { autoAlpha: 0, y: 20, stagger: 0.08 })
      .from('.shimadzu-workflow', { autoAlpha: 0, y: 24 }, '-=0.34')
      .from('.shimadzu-flow-node', { autoAlpha: 0, y: 12, stagger: 0.055, duration: 0.58 }, '-=0.46')

    revealTargets
      .filter(element => !element.classList.contains('shimadzu-workflow'))
      .forEach((element, index) => {
        gsap.from(element, {
          autoAlpha: 0,
          y: 26,
          duration: 0.82,
          ease: 'power3.out',
          scrollTrigger: {
            id: `shimadzu-reveal-${index}`,
            trigger: element,
            start: 'clamp(top 90%)',
            once: true,
          },
        })
      })

    ScrollTrigger.refresh()
  }, { scope: pageRef, dependencies: [Boolean(job), reducedMotion], revertOnUpdate: true })

  const progress = getStageProgress(job)
  const engine = browserEnginePresentation()
  const canAnalyze = !cloud.configured || profile?.approval_status === 'approved'
  const canStart = rawFile && samplesFile && canAnalyze && !submitting

  const handleWorkerEvent = event => {
    setJob(current => {
      if (!current) return current
      const stages = current.stages.map(stage => ({ ...stage }))
      if (Number.isInteger(event.stage) && stages[event.stage]) {
        if (event.type === 'stage-start') stages[event.stage] = { ...stages[event.stage], status: 'running', log_tail: event.message || WORKFLOW[event.stage].work[0] }
        if (event.type === 'stage-complete') stages[event.stage] = { ...stages[event.stage], status: event.status || 'PASS', counts: event.counts || {}, can_advance: true, log_tail: `${WORKFLOW[event.stage].label}完成` }
      }
      if (event.type === 'stage-review') return { ...current, stages, status: 'waiting_review', next_stage: event.stage + 1, updated_at: new Date().toISOString() }
      return { ...current, stages, status: event.type === 'stage-start' ? 'running' : current.status, next_stage: Number.isInteger(event.stage) ? event.stage + 1 : current.next_stage, updated_at: new Date().toISOString() }
    })
    if (cloud.configured && session?.user && activeJobIdRef.current && ['stage-complete', 'stage-review'].includes(event.type)) {
      const currentStage = Math.min(7, (event.stage ?? 0) + 1)
      stageSummaryRef.current[event.stage] = { stage: event.stage, status: event.status || 'PASS', counts: event.counts || {} }
      const patch = {
        status: event.type === 'stage-review' ? 'waiting_review' : 'running',
        current_stage: currentStage,
        progress: Math.round(currentStage / 7 * 100),
        stage_summary: stageSummaryRef.current.filter(Boolean),
      }
      if (event.stage === 5) patch.qc_summary = event.counts || {}
      cloudSyncRef.current = cloudSyncRef.current
        .then(() => cloud.updateJob(activeJobIdRef.current, patch))
        .catch(value => setCloudError(`云端进度同步失败：${value.message}`))
    }
  }

  const submit = async event => {
    event.preventDefault()
    if (!canStart) return
    setSubmitting(true)
    setError('')
    try {
      assertWorkbookFile(rawFile)
      assertWorkbookFile(samplesFile)
      const created = {
        id: crypto.randomUUID(), name, status: 'running', next_stage: 0, updated_at: new Date().toISOString(),
        stages: WORKFLOW.map(stage => ({ index: stage.index, status: 'pending', counts: {} })),
      }
      if (cloud.configured) {
        if (!session?.user || profile?.approval_status !== 'approved') throw Object.assign(new Error('当前账号尚未通过管理员审批。'), { code: 'ACCOUNT_NOT_APPROVED' })
        await cloud.createJob({
          id: created.id, userId: session.user.id, name: name.trim() || '岛津气质分析', mode,
          sourceNames: { raw: { name: rawFile.name, size: rawFile.size }, sample_info: { name: samplesFile.name, size: samplesFile.size } },
        })
      }
      activeJobIdRef.current = created.id
      stageSummaryRef.current = []
      cloudSyncRef.current = Promise.resolve()
      setJob(created)
      const [rawBytes, sampleBytes] = await Promise.all([rawFile.arrayBuffer(), samplesFile.arrayBuffer()])
      const result = await workerClientRef.current.run({
        rawBytes, sampleBytes, rawName: rawFile.name, sampleName: samplesFile.name, name, mode, onEvent: handleWorkerEvent,
      })
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = URL.createObjectURL(new Blob([result.archiveBytes], { type: 'application/zip' }))
      const completedResult = { next_stage: 7, updated_at: new Date().toISOString(), downloadUrl: resultUrlRef.current, resultFileName: result.fileName, archiveSha256: result.archiveSha256, archiveSize: result.archiveSize }
      setJob(current => ({ ...current, ...completedResult, status: cloud.configured ? 'saving' : 'complete' }))
      if (cloud.configured) {
        try {
          await cloudSyncRef.current
          await cloud.uploadResult({ userId: session.user.id, jobId: created.id, archiveBytes: result.archiveBytes, sha256: result.archiveSha256 })
          setHistory(await cloud.listJobs())
          setJob(current => ({ ...current, ...completedResult, status: 'complete' }))
        } catch (value) {
          setCloudError(`分析已完成且可立即下载，但云端结果保存失败：${value.message}`)
          await cloud.updateJob(created.id, { status: 'complete', current_stage: 7, progress: 100, completed_at: new Date().toISOString() }).catch(() => {})
          setJob(current => ({ ...current, ...completedResult, status: 'complete' }))
        }
      }
    } catch (value) {
      setError(value.message)
      setJob(current => current ? { ...current, status: value.code === 'ANALYSIS_CANCELLED' ? 'cancelled' : 'failed', error: { code: value.code || 'BROWSER_ANALYSIS_FAILED', message: value.message } } : null)
      if (cloud.configured && activeJobIdRef.current) cloud.updateJob(activeJobIdRef.current, { status: value.code === 'ANALYSIS_CANCELLED' ? 'cancelled' : 'failed' }).catch(() => {})
    } finally {
      setSubmitting(false)
    }
  }

  const continueJob = async () => {
    setError('')
    workerClientRef.current?.continueReview()
    setJob(current => ({ ...current, status: 'running', updated_at: new Date().toISOString() }))
    if (cloud.configured && activeJobIdRef.current) cloud.updateJob(activeJobIdRef.current, { status: 'running' }).catch(value => setCloudError(value.message))
  }

  const cancelJob = () => {
    workerClientRef.current?.cancel()
  }

  const downloadCloudResult = async item => {
    setCloudError('')
    try {
      const url = await cloud.downloadUrl(item.result_path)
      window.location.assign(url)
    } catch (value) { setCloudError(`无法建立下载链接：${value.message}`) }
  }

  const reset = () => {
    workerClientRef.current?.cancel()
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = ''
    activeJobIdRef.current = ''
    stageSummaryRef.current = []
    cloudSyncRef.current = Promise.resolve()
    setJob(null); setRawFile(null); setSamplesFile(null); setError('')
    if (rawInputRef.current) rawInputRef.current.value = ''
    if (samplesInputRef.current) samplesInputRef.current.value = ''
  }

  return (
    <div ref={pageRef} className="shimadzu-page" data-ui-revision="instrument-console-v2" data-motion={reducedMotion ? 'reduced' : 'full'}>
      <header className="shimadzu-header">
        <nav className="science-nav search-science-nav" aria-label="主导航">
          <button type="button" className="science-brand" onClick={onHome} aria-label="HXQLab 首页">
            <span className="science-brand-mark"><Network className="w-6 h-6" /></span><span className="science-brand-copy"><strong>HXQLab</strong></span>
          </button>
          <div className="science-nav-links">
            <button type="button" onClick={onHome}>{isEnglish ? 'Home' : '首页'}</button>
            <button type="button" onClick={onThresholds}>FlavorThresholdDB</button>
            <button type="button" className="active">{isEnglish ? 'Shimadzu GC-MS' : '岛津气质分析'}</button>
          </div>
          <div className="science-language" aria-label="界面语言">
            <button type="button" onClick={() => setInterfaceLanguage('zh')} aria-pressed={!isEnglish} className={!isEnglish ? 'active' : ''}>中</button>
            <button type="button" onClick={() => setInterfaceLanguage('en')} aria-pressed={isEnglish} className={isEnglish ? 'active' : ''}>EN</button>
          </div>
        </nav>
        <div className="shimadzu-hero">
          <div className="shimadzu-hero-copy shimadzu-hero-animate">
            <span className="shimadzu-product-kicker"><FlaskConical aria-hidden="true" /> GC–MS FLAVOR WORKFLOW</span>
            <h1>岛津气质数据一站式分析</h1>
            <p>从岛津原始工作簿出发，完整执行 Hit #1 提取、化合物筛查、平行补建、半定量、CV30 与作图矩阵输出。每一步都保留证据、报告与质量门禁。</p>
            <dl className="shimadzu-hero-facts" aria-label="工作台信息">
              <div><dt>流程</dt><dd>7 个审计节点</dd></div>
              <div><dt>输入</dt><dd>2 个 Excel 工作簿</dd></div>
              <div><dt>数据边界</dt><dd>当前浏览器处理</dd></div>
            </dl>
          </div>
          <div className="shimadzu-hero-status shimadzu-hero-animate">
            <span className={engine.state}>{engine.state === 'ready' ? <ShieldCheck /> : engine.state === 'checking' ? <Loader2 className="spin" /> : <AlertCircle />}</span>
            <div><small>BROWSER ENGINE</small><strong>{engine.title}</strong><p>{engine.detail}</p></div>
          </div>
        </div>
      </header>

      <main className="shimadzu-main">
        {error && <div className="shimadzu-alert" role="alert"><AlertCircle /><span><strong>当前操作未完成</strong>{error}</span></div>}
        {cloudError && <div className="shimadzu-alert cloud" role="alert"><AlertCircle /><span><strong>云端服务提示</strong>{cloudError}</span></div>}
        <AccountPanel cloud={cloud} session={session} profile={profile} loading={cloudLoading} error={cloudError} onRefresh={refreshCloud} />
        <WorkflowMap job={job} />

        {!job ? (
          <form className="shimadzu-setup" onSubmit={submit}>
            <section className="shimadzu-input-region shimadzu-reveal" aria-labelledby="input-title">
              <div className="shimadzu-region-heading"><div><h2 id="input-title">准备输入文件</h2><p>正式文件和示例模板采用相同的数据契约。建议先下载示例核对结构。</p></div><span>2 个 Excel 文件</span></div>
              <div className="shimadzu-upload-grid">
                <FilePicker inputRef={rawInputRef} label="岛津原始工作簿" hint="包含 Peak Table、Similarity Search Results 与 Hit #" file={rawFile} onChange={setRawFile} templateHref={api.templateUrl('raw-example')} templateLabel="下载原始工作簿示例" />
                <FilePicker inputRef={samplesInputRef} label="样品与内标信息表" hint="包含样品分组、形态、内标浓度、添加量与体系" file={samplesFile} onChange={setSamplesFile} templateHref={api.templateUrl('sample-info')} templateLabel="下载样品信息模板" />
              </div>
              <div className="shimadzu-upload-note"><Upload /><span>仅接受 .xlsx，每个文件不超过 50 MB。原始文件只在当前浏览器中处理，不上传云端；示例数据仅用于结构验证。</span></div>
            </section>

            <aside className="shimadzu-settings shimadzu-reveal" aria-labelledby="settings-title">
              <div className="shimadzu-region-heading"><div><h2 id="settings-title">运行设置</h2><p>科学规则已经由 skill 固定。</p></div></div>
              <label className="shimadzu-field"><span>任务名称</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
              <fieldset className="shimadzu-mode-field">
                <legend>执行方式</legend>
                <label className={mode === 'continuous' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'continuous'} onChange={() => setMode('continuous')} /><span><strong>连续执行</strong><small>自动完成全部七步。</small></span></label>
                <label className={mode === 'step' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'step'} onChange={() => setMode('step')} /><span><strong>逐步复核</strong><small>每完成一步暂停确认。</small></span></label>
              </fieldset>
              <dl className="shimadzu-parameter-list"><div><dt>CV 阈值</dt><dd>30%</dd></div><div><dt>响应因子</dt><dd>1</dd></div><div><dt>内标参数</dt><dd>按样品表</dd></div><div><dt>OAV</dt><dd>关闭</dd></div></dl>
              <button className="shimadzu-run-button" type="submit" disabled={!canStart}>{submitting ? <Loader2 className="spin" /> : <Play />}{submitting ? '正在建立任务' : '开始一站式分析'}</button>
              {cloud.configured && !canAnalyze && <p className="shimadzu-run-gate"><ShieldCheck />登录且通过管理员审批后开放计算。</p>}
            </aside>
            <LiveMonitor job={null} capabilities={null} engine={engine} />
          </form>
        ) : (
          <div className="shimadzu-job-workspace">
            <section className="shimadzu-job-bar shimadzu-reveal">
              <div className="shimadzu-job-identity"><span className={`shimadzu-job-badge ${job.status}`}>{STATUS_LABELS[job.status] || job.status}</span><div><h2>{job.name || name}</h2><code>{job.id}</code></div></div>
              <div className="shimadzu-job-progress"><div><span>总流程</span><strong>{progress.completed} / {progress.total || 7}</strong></div><div className="shimadzu-progress-track"><span style={{ '--progress': progress.completed / (progress.total || 7) }} /></div></div>
              <div className="shimadzu-job-actions">
                {job.status === 'waiting_review' && <button type="button" className="primary" onClick={continueJob}><ChevronRight />复核完成，继续</button>}
                {job.status === 'running' && <button type="button" onClick={cancelJob}><AlertCircle />取消分析</button>}
                {job.status === 'saving' && <span className="shimadzu-saving"><Loader2 className="spin" />正在保存结果</span>}
                {job.status === 'complete' && <a className="primary" href={job.downloadUrl} download={job.resultFileName}><Download />下载结果包</a>}
                {job.status !== 'saving' && <button type="button" onClick={reset}><RotateCcw />新任务</button>}
              </div>
            </section>
            {job.error && <div className="shimadzu-inline-error"><AlertCircle /><span><strong>{job.error.code}</strong>{job.error.message}</span></div>}
            <LiveMonitor job={job} capabilities={null} engine={engine} />
            <section className="shimadzu-stage-detail shimadzu-reveal" aria-labelledby="detail-title">
              <div className="shimadzu-region-heading"><div><h2 id="detail-title">步骤状态与处理计数</h2><p>状态来自各步骤 manifest，WARN 与 REVIEW 会保留到报告。</p></div></div>
              <ol>
                {WORKFLOW.map(stage => {
                  const runtime = job.stages?.[stage.index] || {}
                  const status = runtime.status || 'pending'
                  return <li key={stage.index} className={`state-${status}`}><span className="shimadzu-stage-status"><StageMark status={status} /></span><div><p><b>{String(stage.index).padStart(2, '0')}</b><strong>{stage.label}</strong></p><small>{stage.description}</small></div><div className="shimadzu-stage-result"><span>{STATUS_LABELS[status] || status}</span>{Object.keys(runtime.counts || {}).length > 0 && <small>{Object.entries(runtime.counts).slice(0, 3).map(([key, value]) => `${key} ${value}`).join(' · ')}</small>}</div></li>
                })}
              </ol>
            </section>
          </div>
        )}
        <HistoryPanel jobs={history} onDownload={downloadCloudResult} />
      </main>
    </div>
  )
}
