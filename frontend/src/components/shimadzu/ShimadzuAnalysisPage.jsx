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
import { authCallbackMessage, createShimadzuCloud, shimadzuAuthRedirect } from '../../lib/shimadzuCloud'
import { createShimadzuTaskStore } from '../../lib/shimadzuTaskStore'
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
  created: '等待运行', queued: '排队中', running: '处理中', saving: '云端保存中', waiting_review: '等待复核', complete: '已完成', failed: '运行失败', interrupted: '已中断，需重新运行',
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
  const [message, setMessage] = useState(() => authCallbackMessage(window.location.hash))
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
        const redirectTo = shimadzuAuthRedirect(window.location.origin, import.meta.env.BASE_URL)
        await cloud.signUp(email.trim(), password, displayName.trim(), redirectTo)
        setMessage('注册申请已提交。请打开最新的验证邮件；验证完成后还需等待管理员审批。')
      } else {
        await cloud.signIn(email.trim(), password)
        setMessage('登录成功，正在读取账号权限。')
      }
      await onRefresh()
    } catch (value) { setMessage(value.message) } finally { setWorking(false) }
  }

  const resendConfirmation = async () => {
    if (!email.trim()) {
      setMessage('请先填写注册邮箱，再重新发送验证邮件。')
      return
    }
    setWorking(true); setMessage('')
    try {
      const redirectTo = shimadzuAuthRedirect(window.location.origin, import.meta.env.BASE_URL)
      await cloud.resendSignup(email.trim(), redirectTo)
      setMessage('新的验证邮件已发送。请只使用最新邮件中的链接，之前的链接可能已经失效。')
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
    return <section className="shimadzu-account local"><ShieldCheck /><div><strong>本地隐私模式</strong><p>当前构建未连接云端账号；活动任务可在同一浏览器恢复，完成后请立即下载结果。</p></div></section>
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
        <button type="button" className="text" disabled={working} onClick={resendConfirmation}>验证链接失效？重新发送验证邮件</button>
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

function HistoryPanelLegacy({ jobs, interruptedJobIds, onDownload, onMarkInterrupted }) {
  if (!jobs.length) return null
  return (
    <section className="shimadzu-history shimadzu-reveal" aria-labelledby="history-title">
      <div className="shimadzu-region-heading"><div><h2 id="history-title"><History />最近任务</h2><p>任务与 QC 摘要保留 90 天；结果包完成后保留 7 天。</p></div><span>私有记录</span></div>
      <div className="shimadzu-history-table" role="table">
        {jobs.map(item => {
          const downloadable = item.result_path && new Date(item.result_expires_at) > new Date()
          const interrupted = interruptedJobIds.has(item.id)
          const visibleStatus = interrupted ? 'interrupted' : item.status
          return <div key={item.id} role="row"><div><strong>{item.name}</strong><small>{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</small></div><span className={`shimadzu-job-badge ${visibleStatus}`}>{STATUS_LABELS[visibleStatus] || visibleStatus}</span><span>步骤 {item.current_stage}/7 · {item.progress}%</span>{interrupted ? <button type="button" onClick={() => onMarkInterrupted(item)}>确认中断</button> : downloadable ? <button type="button" onClick={() => onDownload(item)}><CloudDownload />重新下载</button> : <small>{item.status === 'complete' || item.status === 'expired' ? '结果已过期' : '暂无结果'}</small>}</div>
        })}
      </div>
    </section>
  )
}

function HistoryPanel({ jobs, interruptedJobIds, onDownload, onMarkInterrupted, onDownloadInput, onDeleteResult, isAdmin = false }) {
  if (!jobs.length) return null
  return (
    <section className="shimadzu-history shimadzu-reveal" aria-labelledby="history-title">
      <div className="shimadzu-region-heading"><div><h2 id="history-title"><History />{isAdmin ? '管理员任务台' : '最近任务'}</h2><p>{isAdmin ? '可查看所有用户运行状态，并下载原始工作簿与结果证据。' : '任务与 QC 摘要保留 90 天；结果包完成后保留 7 天。'}</p></div><span>{isAdmin ? '管理员可见' : '私有记录'}</span></div>
      <div className="shimadzu-history-table" role="table">
        {jobs.map(item => {
          const downloadable = item.result_path && new Date(item.result_expires_at) > new Date()
          const interrupted = interruptedJobIds.has(item.id)
          const visibleStatus = interrupted ? 'interrupted' : item.status
          return <div key={item.id} role="row"><div><strong>{item.name}</strong><small>{isAdmin ? `用户 ${item.user_id} · ` : ''}{new Date(item.created_at).toLocaleString('zh-CN', { hour12: false })}</small></div><span className={`shimadzu-job-badge ${visibleStatus}`}>{STATUS_LABELS[visibleStatus] || visibleStatus}</span><span>步骤 {item.current_stage}/7 · {item.progress}%</span><div className="shimadzu-history-actions">{interrupted ? <button type="button" onClick={() => onMarkInterrupted(item)}>确认中断</button> : downloadable ? <button type="button" onClick={() => onDownload(item)}><CloudDownload />重新下载</button> : <small>{item.status === 'complete' || item.status === 'expired' ? '结果已过期' : '暂无结果'}</small>}{isAdmin && item.raw_path && <button type="button" onClick={() => onDownloadInput(item)}><Download />原始文件</button>}{downloadable && onDeleteResult && <button type="button" className="danger" onClick={() => onDeleteResult(item)}>删除结果</button>}</div></div>
        })}
      </div>
    </section>
  )
}

void HistoryPanelLegacy

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

const jobFromStoredTask = (task, status = 'running') => {
  const summaries = new Map((task.stageSummary || []).filter(item => Number.isInteger(item?.stage)).map(item => [item.stage, item]))
  return {
    id: task.id,
    name: task.name,
    status,
    next_stage: task.nextStage || 0,
    updated_at: task.savedAt || new Date().toISOString(),
    error: task.error || null,
    partialArchiveFileName: task.partialArchiveFileName || null,
    partialArchiveSha256: task.partialArchiveSha256 || null,
    partialArchiveSize: task.partialArchiveSize || null,
    stages: WORKFLOW.map(stage => {
      const summary = summaries.get(stage.index)
      return summary
        ? { index: stage.index, status: summary.status || 'PASS', counts: summary.counts || {}, can_advance: true, log_tail: `${stage.label}已完成` }
        : { index: stage.index, status: 'pending', counts: {} }
    }),
  }
}

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
  const taskStore = useMemo(() => createShimadzuTaskStore(), [])
  const pageRef = useRef(null)
  const rawInputRef = useRef(null)
  const samplesInputRef = useRef(null)
  const workerClientRef = useRef(null)
  const resultUrlRef = useRef('')
  const partialResultUrlRef = useRef('')
  const activeJobIdRef = useRef('')
  const cloudSyncRef = useRef(Promise.resolve())
  const taskSyncRef = useRef(Promise.resolve())
  const stageSummaryRef = useRef([])
  const taskScopeRef = useRef('local')
  const resumeFromStageRef = useRef(0)
  const restoreScopeRef = useRef('')
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
  const [activeTaskId, setActiveTaskId] = useState('')
  const [recoveryChecked, setRecoveryChecked] = useState(false)
  const [recoveryNotice, setRecoveryNotice] = useState('')

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
      if (partialResultUrlRef.current) URL.revokeObjectURL(partialResultUrlRef.current)
    }
  }, [api])

  useEffect(() => {
    if (!cloud.configured) return undefined
    queueMicrotask(() => refreshCloud())
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
  const fileReadiness = useMemo(() => {
    const missing = []
    if (!rawFile) missing.push('岛津原始工作簿')
    if (!samplesFile) missing.push('样品与内标信息表')
    if (missing.length) {
      return {
        ready: false,
        buttonLabel: missing.length === 2 ? '请先添加两个 Excel 文件' : `请添加${missing[0]}`,
        message: `还缺少：${missing.join('、')}`,
      }
    }

    const invalid = []
    try { assertWorkbookFile(rawFile) } catch { invalid.push('岛津原始工作簿') }
    try { assertWorkbookFile(samplesFile) } catch { invalid.push('样品与内标信息表') }
    if (invalid.length) {
      return {
        ready: false,
        buttonLabel: '请更换不符合要求的文件',
        message: `${invalid.join('、')}未通过检查；仅接受不超过 50 MB 的 .xlsx 文件。`,
      }
    }

    return { ready: true, buttonLabel: '开始分析', message: '文件已准备，可以开始分析' }
  }, [rawFile, samplesFile])
  const startFeedback = useMemo(() => {
    if (submitting) return { buttonLabel: '正在建立任务', message: '正在读取文件并建立分析任务。' }
    if (!fileReadiness.ready) return fileReadiness
    if (!canAnalyze) return { buttonLabel: '等待账号审批后开始', message: '文件已准备，可以开始分析。当前账号还需通过管理员审批。' }
    return fileReadiness
  }, [canAnalyze, fileReadiness, submitting])
  const canStart = fileReadiness.ready && canAnalyze && !submitting
  const interruptedJobIds = useMemo(() => {
    if (!recoveryChecked) return new Set()
    return new Set(history
      .filter(item => ['running', 'waiting_review'].includes(item.status) && item.id !== activeTaskId)
      .map(item => item.id))
  }, [activeTaskId, history, recoveryChecked])

  const handleWorkerEvent = event => {
    const replayedStage = Number.isInteger(event.stage) && event.stage < resumeFromStageRef.current
    if (replayedStage) return
    if (event.type === 'stage-start' && recoveryNotice) setRecoveryNotice('任务已恢复，正在继续未完成的分析步骤。')
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
    if (activeJobIdRef.current && ['stage-complete', 'stage-review'].includes(event.type)) {
      const currentStage = Math.min(7, (event.stage ?? 0) + 1)
      if (event.type === 'stage-complete') stageSummaryRef.current[event.stage] = { stage: event.stage, status: event.status || 'PASS', counts: event.counts || {} }
      const patch = {
        status: event.type === 'stage-review' ? 'waiting_review' : 'running',
        current_stage: currentStage,
        progress: Math.round(currentStage / 7 * 100),
        stage_summary: stageSummaryRef.current.filter(Boolean),
      }
      taskSyncRef.current = taskSyncRef.current
        .then(() => taskStore.update(taskScopeRef.current, {
          status: patch.status,
          nextStage: currentStage,
          stageSummary: patch.stage_summary,
        }))
        .catch(value => setError(`无法保存恢复进度：${value.message}`))
      if (event.stage === 5) patch.qc_summary = event.counts || {}
      if (cloud.configured && session?.user) {
        cloudSyncRef.current = cloudSyncRef.current
          .then(() => cloud.updateJob(activeJobIdRef.current, patch))
          .catch(value => setCloudError(`云端进度同步失败：${value.message}`))
      }
    }
  }

  const runTask = async (task, { restored = false } = {}) => {
    setSubmitting(true)
    setError('')
    activeJobIdRef.current = task.id
    taskScopeRef.current = task.scope
    resumeFromStageRef.current = restored ? Math.max(0, Number(task.nextStage) || 0) : 0
    stageSummaryRef.current = [...(task.stageSummary || [])]
    cloudSyncRef.current = Promise.resolve()
    taskSyncRef.current = Promise.resolve()
    setActiveTaskId(task.id)
    setName(task.name)
    setMode(task.mode)
    setJob(jobFromStoredTask(task, 'running'))
    if (restored) setRecoveryNotice('已从当前浏览器恢复任务，正在重新验证已完成步骤。')
    try {
      const result = await workerClientRef.current.run({
        rawBytes: task.rawBytes,
        sampleBytes: task.sampleBytes,
        rawName: task.rawName,
        sampleName: task.sampleName,
        name: task.name,
        mode: task.mode,
        resumeFromStage: resumeFromStageRef.current,
        onEvent: handleWorkerEvent,
      })
      if (partialResultUrlRef.current) {
        URL.revokeObjectURL(partialResultUrlRef.current)
        partialResultUrlRef.current = ''
      }
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = URL.createObjectURL(new Blob([result.archiveBytes], { type: 'application/zip' }))
      const completedResult = { next_stage: 7, updated_at: new Date().toISOString(), downloadUrl: resultUrlRef.current, resultFileName: result.fileName, archiveSha256: result.archiveSha256, archiveSize: result.archiveSize }
      setJob(current => ({ ...current, ...completedResult, status: cloud.configured ? 'saving' : 'complete' }))
      if (cloud.configured) {
        try {
          await cloudSyncRef.current
          await cloud.uploadResult({ userId: task.userId, jobId: task.id, archiveBytes: result.archiveBytes, sha256: result.archiveSha256 })
          setHistory(await cloud.listJobs())
          setJob(current => ({ ...current, ...completedResult, status: 'complete' }))
        } catch (value) {
          setCloudError(`分析已完成且可立即下载，但云端结果保存失败：${value.message}`)
          await cloud.updateJob(task.id, { status: 'complete', current_stage: 7, progress: 100, completed_at: new Date().toISOString() }).catch(() => {})
          setJob(current => ({ ...current, ...completedResult, status: 'complete' }))
        }
      }
      await taskSyncRef.current
      await taskStore.clear(task.scope)
      setActiveTaskId('')
      setRecoveryNotice('')
    } catch (value) {
      if (value.code === 'ANALYSIS_INTERRUPTED') return
      const cancelled = value.code === 'ANALYSIS_CANCELLED'
      setError(value.message)
      const failure = {
        code: value.code || 'BROWSER_ANALYSIS_FAILED', message: value.message, details: value.details || null,
        at: new Date().toISOString(),
      }
      let partialResult = {}
      if (!cancelled && value.archiveBytes) {
        if (partialResultUrlRef.current) URL.revokeObjectURL(partialResultUrlRef.current)
        partialResultUrlRef.current = URL.createObjectURL(new Blob([value.archiveBytes], { type: 'application/zip' }))
        partialResult = {
          partialDownloadUrl: partialResultUrlRef.current,
          partialArchiveFileName: value.fileName || `${task.name}_部分结果.zip`,
          partialArchiveSha256: value.archiveSha256 || null,
          partialArchiveSize: value.archiveSize || value.archiveBytes.byteLength,
        }
      }
      setJob(current => current ? { ...current, ...partialResult, status: cancelled ? 'cancelled' : 'failed', error: failure } : null)
      const nextStage = Math.max(resumeFromStageRef.current, stageSummaryRef.current.filter(Boolean).length)
      if (cancelled) {
        await taskSyncRef.current.catch(() => {})
        await taskStore.clear(task.scope).catch(() => {})
        setActiveTaskId('')
      } else {
        await taskSyncRef.current.catch(() => {})
        await taskStore.update(task.scope, {
          status: 'failed', nextStage, stageSummary: stageSummaryRef.current.filter(Boolean), error: failure,
          ...(value.archiveBytes ? {
            partialArchiveBytes: value.archiveBytes,
            partialArchiveSha256: value.archiveSha256 || null,
            partialArchiveSize: value.archiveSize || value.archiveBytes.byteLength,
            partialArchiveFileName: value.fileName || `${task.name}_部分结果.zip`,
          } : {}),
        }).catch(() => {})
      }
      if (cloud.configured && activeJobIdRef.current) {
        if (!cancelled && value.archiveBytes) {
          await cloud.uploadResult({
            userId: task.userId, jobId: activeJobIdRef.current, archiveBytes: value.archiveBytes,
            sha256: value.archiveSha256, status: 'failed', currentStage: Math.max(0, nextStage), progress: Math.round(Math.min(6, nextStage) / 7 * 100),
          }).catch(uploadError => setCloudError(`失败任务的部分结果保存失败：${uploadError.message}`))
        }
        const stageSummary = [...stageSummaryRef.current.filter(Boolean), { type: 'error', ...failure }]
        await cloud.updateJob(activeJobIdRef.current, { status: cancelled ? 'cancelled' : 'failed', stage_summary: stageSummary }).catch(() => {})
        setHistory(await cloud.listJobs().catch(() => history))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const submit = async event => {
    event.preventDefault()
    if (!canStart) return
    setSubmitting(true)
    setError('')
    const scope = cloud.configured ? session?.user?.id : 'local'
    let cloudJobId = ''
    try {
      assertWorkbookFile(rawFile)
      assertWorkbookFile(samplesFile)
      if (cloud.configured && (!session?.user || profile?.approval_status !== 'approved')) throw Object.assign(new Error('当前账号尚未通过管理员审批。'), { code: 'ACCOUNT_NOT_APPROVED' })
      const [rawBytes, sampleBytes] = await Promise.all([rawFile.arrayBuffer(), samplesFile.arrayBuffer()])
      const task = {
        id: crypto.randomUUID(), scope, userId: session?.user?.id || '', name: name.trim() || '岛津气质分析', mode,
        status: 'running', nextStage: 0, stageSummary: [], rawName: rawFile.name, sampleName: samplesFile.name,
        rawSize: rawFile.size, sampleSize: samplesFile.size, rawBytes, sampleBytes,
      }
      if (cloud.configured) {
        await cloud.createJob({
          id: task.id, userId: task.userId, name: task.name, mode,
          sourceNames: { raw: { name: rawFile.name, size: rawFile.size }, sample_info: { name: samplesFile.name, size: samplesFile.size } },
        })
        cloudJobId = task.id
        try {
          await cloud.uploadInputs({ userId: task.userId, jobId: task.id, rawBytes, sampleBytes })
        } catch (value) {
          setCloudError(`原始工作簿云端留存失败，分析仍会继续：${value.message}`)
        }
      }
      await taskStore.save(task)
      await runTask(task)
    } catch (value) {
      setError(value.message)
      if (cloud.configured && cloudJobId) await cloud.updateJob(cloudJobId, { status: 'failed', stage_summary: [{ type: 'error', code: value.code || 'TASK_PREPARATION_FAILED', message: value.message, at: new Date().toISOString() }] }).catch(() => {})
      setSubmitting(false)
    }
  }

  const restoreActiveTask = async scope => {
    setRecoveryChecked(false)
    try {
      const task = await taskStore.load(scope)
      if (!task) {
        setActiveTaskId('')
        return
      }
      taskScopeRef.current = scope
      activeJobIdRef.current = task.id
      stageSummaryRef.current = [...(task.stageSummary || [])]
      resumeFromStageRef.current = Math.max(0, Number(task.nextStage) || 0)
      taskSyncRef.current = Promise.resolve()
      setActiveTaskId(task.id)
      setName(task.name)
      setMode(task.mode)
      if (task.status === 'failed') {
        const restoredJob = jobFromStoredTask(task, 'failed')
        if (task.partialArchiveBytes) {
          if (partialResultUrlRef.current) URL.revokeObjectURL(partialResultUrlRef.current)
          partialResultUrlRef.current = URL.createObjectURL(new Blob([task.partialArchiveBytes], { type: 'application/zip' }))
          restoredJob.partialDownloadUrl = partialResultUrlRef.current
        }
        setJob(restoredJob)
        setRecoveryNotice('已恢复上次失败任务及错误信息。可重新运行，或更换文件建立新任务。')
        return
      }
      if (task.status === 'waiting_review') {
        setJob({ ...jobFromStoredTask(task, 'waiting_review'), restoredPause: true })
        setRecoveryNotice('已恢复到刷新前的复核节点；确认后再继续下一步。')
        return
      }
      setRecoveryChecked(true)
      await runTask(task, { restored: true })
    } catch (value) {
      setError(`无法恢复浏览器任务：${value.message}`)
    } finally {
      setRecoveryChecked(true)
    }
  }

  useEffect(() => {
    if (cloud.configured && cloudLoading) return
    if (cloud.configured && (!session?.user || profile?.approval_status !== 'approved')) {
      restoreScopeRef.current = ''
      queueMicrotask(() => setRecoveryChecked(true))
      return
    }
    const scope = cloud.configured ? session.user.id : 'local'
    if (restoreScopeRef.current === scope) return
    restoreScopeRef.current = scope
    restoreActiveTask(scope)
    // Restore runs once per authenticated scope; runTask is intentionally guarded by restoreScopeRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud.configured, cloudLoading, profile?.approval_status, session?.user?.id, taskStore])

  const continueJob = async () => {
    setError('')
    if (job?.restoredPause) {
      const task = await taskStore.load(taskScopeRef.current)
      if (!task) {
        setError('本地恢复数据已不存在，请重新选择两个输入文件。')
        return
      }
      await taskStore.update(task.scope, { status: 'running' })
      await runTask({ ...task, status: 'running' }, { restored: true })
      return
    }
    workerClientRef.current?.continueReview()
    setJob(current => ({ ...current, status: 'running', updated_at: new Date().toISOString() }))
    taskSyncRef.current = taskSyncRef.current
      .then(() => taskStore.update(taskScopeRef.current, { status: 'running' }))
      .catch(value => setError(`无法保存恢复进度：${value.message}`))
    if (cloud.configured && activeJobIdRef.current) cloud.updateJob(activeJobIdRef.current, { status: 'running' }).catch(value => setCloudError(value.message))
  }

  const cancelJob = () => {
    workerClientRef.current?.cancel()
  }

  const retryJob = async () => {
    setError('')
    const task = await taskStore.load(taskScopeRef.current)
    if (!task) {
      setError('本地恢复数据已不存在，请重新选择两个输入文件。')
      return
    }
    await taskStore.update(task.scope, { status: 'running', error: null })
    if (cloud.configured) await cloud.updateJob(task.id, { status: 'running' }).catch(value => setCloudError(value.message))
    await runTask({ ...task, status: 'running', error: null }, { restored: true })
  }

  const downloadCloudResult = async item => {
    setCloudError('')
    try {
      const url = await cloud.downloadUrl(item.result_path)
      window.location.assign(url)
    } catch (value) { setCloudError(`无法建立下载链接：${value.message}`) }
  }

  const downloadCloudInput = async item => {
    setCloudError('')
    try {
      const url = await cloud.downloadInputUrl(item.raw_path)
      window.location.assign(url)
    } catch (value) { setCloudError(`无法建立原始工作簿下载链接：${value.message}`) }
  }

  const deleteCloudResult = async item => {
    if (!window.confirm('仅删除这个结果 ZIP，任务记录和质量日志会保留。继续吗？')) return
    setCloudError('')
    try {
      await cloud.deleteResult({ jobId: item.id, path: item.result_path })
      setHistory(await cloud.listJobs())
    } catch (value) { setCloudError(`结果 ZIP 删除失败：${value.message}`) }
  }

  const markInterrupted = async item => {
    setCloudError('')
    try {
      const stageSummary = Array.isArray(item.stage_summary) ? item.stage_summary : []
      await cloud.updateJob(item.id, {
        status: 'failed',
        stage_summary: [...stageSummary, { type: 'interrupted', code: 'LOCAL_INPUTS_UNAVAILABLE', message: '页面已关闭且当前浏览器没有可恢复的输入文件。', at: new Date().toISOString() }],
      })
      setHistory(await cloud.listJobs())
    } catch (value) { setCloudError(`无法更新中断状态：${value.message}`) }
  }

  const reset = async () => {
    workerClientRef.current?.cancel()
    await taskSyncRef.current.catch(() => {})
    await taskStore.clear(taskScopeRef.current).catch(() => {})
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    resultUrlRef.current = ''
    if (partialResultUrlRef.current) URL.revokeObjectURL(partialResultUrlRef.current)
    partialResultUrlRef.current = ''
    activeJobIdRef.current = ''
    stageSummaryRef.current = []
    cloudSyncRef.current = Promise.resolve()
    taskSyncRef.current = Promise.resolve()
    setActiveTaskId(''); setRecoveryNotice('')
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
            <h1>岛津 GC–MS 风味数据分析工作台</h1>
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
        {recoveryNotice && <div className="shimadzu-recovery-notice" role="status" aria-live="polite"><RotateCcw /><span><strong>浏览器任务恢复</strong>{recoveryNotice}</span></div>}
        <AccountPanel cloud={cloud} session={session} profile={profile} loading={cloudLoading} error={cloudError} onRefresh={refreshCloud} />

        {!job ? (
          <>
            <form className="shimadzu-setup" onSubmit={submit}>
              <section className="shimadzu-input-region shimadzu-reveal" aria-labelledby="input-title">
                <div className="shimadzu-region-heading"><div><h2 id="input-title">准备输入文件</h2><p>正式文件和示例模板采用相同的字段结构。建议先下载示例核对内容。</p></div><span>2 个 Excel 文件</span></div>
                <div className="shimadzu-upload-grid">
                  <FilePicker inputRef={rawInputRef} label="岛津原始工作簿" hint="包含 Peak Table、Similarity Search Results 与 Hit #" file={rawFile} onChange={setRawFile} templateHref={api.templateUrl('raw-example')} templateLabel="下载原始工作簿示例" />
                  <FilePicker inputRef={samplesInputRef} label="样品与内标信息表" hint="包含样品分组、形态、内标浓度、添加量与体系" file={samplesFile} onChange={setSamplesFile} templateHref={api.templateUrl('sample-info')} templateLabel="下载样品信息模板" />
                </div>
                <div className="shimadzu-upload-note"><Upload /><span>仅接受 .xlsx，每个文件不超过 50 MB。原始文件不上传云端；活动任务会临时保存在当前浏览器，刷新或重新打开后自动恢复。页面关闭期间不会继续计算。</span></div>
              </section>

              <aside className="shimadzu-settings shimadzu-reveal" aria-labelledby="settings-title">
                <div className="shimadzu-region-heading"><div><h2 id="settings-title">运行设置</h2><p>分析参数依据已确认的科研规则执行。</p></div></div>
                <label className="shimadzu-field"><span>任务名称</span><input value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label>
                <fieldset className="shimadzu-mode-field">
                  <legend>执行方式</legend>
                  <label className={mode === 'continuous' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'continuous'} onChange={() => setMode('continuous')} /><span><strong>连续执行</strong><small>自动完成全部七步。</small></span></label>
                  <label className={mode === 'step' ? 'selected' : ''}><input type="radio" name="mode" checked={mode === 'step'} onChange={() => setMode('step')} /><span><strong>逐步复核</strong><small>每完成一步暂停确认。</small></span></label>
                </fieldset>
                <dl className="shimadzu-parameter-list"><div><dt>CV 阈值</dt><dd>30%</dd></div><div><dt>响应因子</dt><dd>1</dd></div><div><dt>内标参数</dt><dd>按样品表</dd></div><div><dt>OAV</dt><dd>关闭</dd></div></dl>
                <button className="shimadzu-run-button" type="submit" disabled={!canStart}>{submitting ? <Loader2 className="spin" /> : <Play />}{startFeedback.buttonLabel}</button>
                <p className={`shimadzu-run-readiness${fileReadiness.ready && canAnalyze ? ' ready' : ''}`} role="status" aria-live="polite">{startFeedback.message}</p>
                {cloud.configured && !canAnalyze && <p className="shimadzu-run-gate"><ShieldCheck />登录且通过管理员审批后开放计算。</p>}
              </aside>
            </form>
            <WorkflowMap job={job} />
            <LiveMonitor job={null} capabilities={null} engine={engine} />
          </>
        ) : (
          <>
            <div className="shimadzu-job-workspace">
              <section className="shimadzu-job-bar shimadzu-reveal">
                <div className="shimadzu-job-identity"><span className={`shimadzu-job-badge ${job.status}`}>{STATUS_LABELS[job.status] || job.status}</span><div><h2>{job.name || name}</h2><code>{job.id}</code></div></div>
                <div className="shimadzu-job-progress"><div><span>总流程</span><strong>{progress.completed} / {progress.total || 7}</strong></div><div className="shimadzu-progress-track"><span style={{ '--progress': progress.completed / (progress.total || 7) }} /></div></div>
                <div className="shimadzu-job-actions">
                  {job.status === 'waiting_review' && <button type="button" className="primary" onClick={continueJob}><ChevronRight />复核完成，继续</button>}
                  {job.status === 'running' && <button type="button" onClick={cancelJob}><AlertCircle />取消分析</button>}
                  {job.status === 'failed' && <button type="button" className="primary" onClick={retryJob}><RotateCcw />重新运行</button>}
                  {job.status === 'saving' && <span className="shimadzu-saving"><Loader2 className="spin" />正在保存结果</span>}
                  {job.status === 'complete' && <a className="primary" href={job.downloadUrl} download={job.resultFileName}><Download />下载结果包</a>}
                  {job.status !== 'saving' && <button type="button" onClick={reset}><RotateCcw />新任务</button>}
                </div>
              </section>
              {job.error && <div className="shimadzu-inline-error" role="alert"><AlertCircle /><div><p><strong>{job.error.code}</strong>{job.error.message}</p>{job.error.details?.stage !== undefined && <small>失败步骤：{Number(job.error.details.stage) + 1} / 7</small>}{job.error.details?.issues?.length > 0 && <ul>{job.error.details.issues.slice(0, 4).map((issue, index) => <li key={`${issue.code || 'issue'}-${index}`}>{issue.code || '质量门禁问题'}{issue.sampleName ? ` · ${issue.sampleName}` : ''}{issue.cas ? ` · CAS ${issue.cas}` : ''}</li>)}</ul>}{job.partialDownloadUrl && <a href={job.partialDownloadUrl} download={job.partialArchiveFileName}><Download />下载已完成步骤与错误证据</a>}</div></div>}
              <LiveMonitor job={job} capabilities={null} engine={engine} />
              <section className="shimadzu-stage-detail shimadzu-reveal" aria-labelledby="detail-title">
                <div className="shimadzu-region-heading"><div><h2 id="detail-title">步骤状态与处理计数</h2><p>各步骤的运行状态、警告和待复核项会保留到最终报告。</p></div></div>
                <ol>
                  {WORKFLOW.map(stage => {
                    const runtime = job.stages?.[stage.index] || {}
                    const status = runtime.status || 'pending'
                    return <li key={stage.index} className={`state-${status}`}><span className="shimadzu-stage-status"><StageMark status={status} /></span><div><p><b>{String(stage.index).padStart(2, '0')}</b><strong>{stage.label}</strong></p><small>{stage.description}</small></div><div className="shimadzu-stage-result"><span>{STATUS_LABELS[status] || status}</span>{Object.keys(runtime.counts || {}).length > 0 && <small>{Object.entries(runtime.counts).slice(0, 3).map(([key, value]) => `${key} ${value}`).join(' · ')}</small>}</div></li>
                  })}
                </ol>
              </section>
            </div>
            <WorkflowMap job={job} />
          </>
        )}
        <HistoryPanel jobs={history} interruptedJobIds={interruptedJobIds} onDownload={downloadCloudResult} onMarkInterrupted={markInterrupted} onDownloadInput={downloadCloudInput} onDeleteResult={deleteCloudResult} isAdmin={profile?.is_admin === true} />
      </main>
    </div>
  )
}
