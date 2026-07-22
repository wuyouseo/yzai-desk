import { Component, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bot,
  BellRing,
  Bold,
  CalendarDays,
  Check,
  CircleCheckBig,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Clock3,
  CloudSun,
  Copy,
  Download,
  FileDown,
  FileText,
  FileUp,
  ExternalLink,
  Database,
  Flame,
  Info,
  Italic,
  LayoutDashboard,
  LockKeyhole,
  List,
  ListChecks,
  ListOrdered,
  MessageCircleMore,
  MessageSquarePlus,
  MemoryStick,
  MoreHorizontal,
  NotebookPen,
  Palette,
  PanelsTopLeft,
  Paperclip,
  Pin,
  Plus,
  Search,
  Server,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  applyAppearance,
  askAI,
  callCommand,
  createNotePasswordConfig,
  decryptNote,
  encryptNote,
  exportBackup,
  getActiveAIProvider,
  getCachedNotePassword,
  loadData,
  readBackup,
  saveData,
  setCachedNotePassword,
  subscribe,
  verifyNotePassword,
} from "../lib/deskApi";
import { lookupWeatherLocation, verifyWeatherLocation } from "../lib/weatherApi";

const NAV = [
  ["overview", "今日总览", LayoutDashboard],
  ["calendar", "日程管理", CalendarDays],
  ["notes", "便签", NotebookPen],
  ["clipboard", "剪贴板", Clipboard],
  ["focus", "专注统计", Flame],
  ["assistant", "AI 助手", MessageCircleMore],
  ["settings", "系统设置", Settings],
];

const APP_VERSION = "0.5.5";

const SETTINGS_NAV = [
  ["general", "常规", Settings],
  ["appearance", "外观与主题", Palette],
  ["widgets", "桌面挂件", PanelsTopLeft],
  ["ai", "AI 服务", Bot],
  ["data", "数据与备份", Database],
  ["about", "关于", Info],
];

const THEMES = [
  { id: "obsidian", name: "曜石紫", description: "沉稳深色与紫色高光", colors: ["#090a0f", "#8d6cff", "#5fd7e5"] },
  { id: "midnight", name: "午夜蓝", description: "冷静蓝黑与冰蓝强调", colors: ["#07111d", "#4f8cff", "#55d8ff"] },
  { id: "aurora", name: "极光青", description: "墨绿背景与青绿光感", colors: ["#071411", "#34c9a5", "#8de7d1"] },
  { id: "cloud", name: "云雾白", description: "明亮柔和的浅色工作台", colors: ["#eef1f7", "#7557d9", "#2c9cb0"] },
];

const EVENT_TYPES = {
  schedule: { label: "日程", description: "安排需要完成的事项", icon: CalendarDays },
  reminder: { label: "提醒", description: "在指定时间弹窗提醒", icon: BellRing },
  memo: { label: "备忘", description: "记录信息，不弹出提醒", icon: StickyNote },
};

const getEventType = (event) => EVENT_TYPES[event?.kind] || EVENT_TYPES.schedule;

const FALLBACK_SYSTEM_FONTS = ["Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", "微软雅黑", "Arial"];

const MINI_WIDGETS = [
  { id: "calendar", name: "桌面日历", description: "月份、日期和日程标记", icon: CalendarDays },
  { id: "note", name: "桌面便签", description: "随手记录并自动保存", icon: NotebookPen },
  { id: "focus", name: "番茄时间", description: "独立专注计时与控制", icon: Flame },
  { id: "weather", name: "天气挂件", description: "温度、体感和实时风速", icon: CloudSun },
];

const pad = (number) => String(number).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const sameDay = (value, date) => dateKey(new Date(value)) === dateKey(date);
const readableTime = (value) => new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
const localDateTimeInput = (value) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const TEXT_ATTACHMENT_EXTENSIONS = new Set(["txt", "md", "csv", "json", "js", "jsx", "ts", "tsx", "py", "html", "css", "xml", "yaml", "yml", "log"]);
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;

const readAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ""));
  reader.onerror = () => reject(new Error(`无法读取附件：${file.name}`));
  reader.readAsDataURL(file);
});

const createAttachment = async (file) => {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const base = { id: uid(), name: file.name, type: file.type || "application/octet-stream", size: file.size };
  if (file.type.startsWith("image/")) return { ...base, kind: "image", data_url: await readAsDataUrl(file) };
  if (file.type === "application/pdf" || extension === "pdf") return { ...base, kind: "pdf", data_url: await readAsDataUrl(file) };
  if (file.type.startsWith("text/") || TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    const content = await file.text();
    return { ...base, kind: "text", text: content.slice(0, 120_000), truncated: content.length > 120_000 };
  }
  throw new Error(`暂不支持“${file.name}”，请上传图片、PDF、文本或常见代码文件`);
};

const formatFileSize = (size = 0) => size >= 1024 * 1024
  ? `${(size / 1024 / 1024).toFixed(1)} MB`
  : `${Math.max(1, Math.round(size / 1024))} KB`;

const conversationTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const today = new Date();
  if (sameDay(date, today)) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
};

function MarkdownMessage({ content }) {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>,
          input: ({ ...props }) => <input {...props} disabled />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("Page rendering failed", error, details);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <section className="panel page-error-boundary">
      <Info />
      <h2>此页面暂时无法显示</h2>
      <p>数据仍保存在本机。请返回总览后重试；若问题持续出现，可在“系统设置 → 数据与备份”导出备份。</p>
      <button className="primary-button" onClick={this.props.onRecover}>返回今日总览</button>
    </section>;
  }
}

function SettingsDashboard() {
  const [data, setData] = useState(null);
  const [active, setActive] = useState("overview");
  const [toast, setToast] = useState("");
  const [month, setMonth] = useState(new Date());
  const [eventDraft, setEventDraft] = useState(null);
  const importRef = useRef(null);

  useEffect(() => {
    loadData().then(setData);
    const cleanups = [
      subscribe("clipboard-changed", (item) => setData((current) => current && ({ ...current, clipboard: [item, ...current.clipboard] }))),
      subscribe("pomo-finished", async () => {
        setData(await loadData());
        flash("本次专注已完成");
      }),
    ];
    return () => cleanups.forEach((promise) => promise.then((off) => off()));
  }, []);

  useEffect(() => {
    if (data?.settings) applyAppearance(data.settings);
  }, [data?.settings?.theme, data?.settings?.system_font, data?.settings?.font_size]);

  const flash = (message) => {
    setToast(message);
    window.clearTimeout(flash.timer);
    flash.timer = window.setTimeout(() => setToast(""), 2400);
  };

  const commit = async (next, message) => {
    const changedSections = Object.keys(next).filter(
      (section) => JSON.stringify(next[section]) !== JSON.stringify(data?.[section]),
    );
    const saved = await saveData(next, changedSections);
    setData(saved);
    if (message) flash(message);
  };

  const todayEvents = useMemo(
    () => data?.events.filter((event) => sameDay(event.time, new Date())).sort((a, b) => new Date(a.time) - new Date(b.time)) || [],
    [data],
  );

  if (!data) return <div className="app-loading"><div className="loading-orb" /><p>正在整理你的桌面…</p></div>;

  const openNewEvent = (selectedDate = new Date(), kind = "schedule") => {
    const local = new Date(selectedDate);
    local.setHours(9, 0, 0, 0);
    setEventDraft({ id: "", title: "", time: `${dateKey(local)}T09:00`, kind, notes: "", remind: kind !== "memo", notified_at: null, recurring: "none", done: false });
  };

  const saveEvent = async (event) => {
    if (!event.title.trim()) return flash(`请填写${getEventType(event).label}名称`);
    if (!event.time || Number.isNaN(new Date(event.time).getTime())) return flash("请选择有效的日期和时间");
    const previous = data.events.find((item) => item.id === event.id);
    const normalizedTime = new Date(event.time).toISOString();
    const reminderChanged = !previous
      || new Date(previous.time).getTime() !== new Date(normalizedTime).getTime()
      || previous.remind !== event.remind
      || previous.kind !== event.kind;
    const normalized = {
      ...event,
      id: event.id || uid(),
      kind: event.kind || "schedule",
      notes: event.notes || "",
      remind: event.kind === "memo" ? false : event.kind === "reminder" ? true : event.remind !== false,
      recurring: event.kind === "memo" ? "none" : event.recurring || "none",
      notified_at: reminderChanged ? null : event.notified_at || null,
      time: normalizedTime,
    };
    const exists = data.events.some((item) => item.id === normalized.id);
    const events = exists ? data.events.map((item) => item.id === normalized.id ? normalized : item) : [...data.events, normalized];
    const typeLabel = getEventType(normalized).label;
    await commit({ ...data, events }, exists ? `${typeLabel}已更新` : `${typeLabel}已添加`);
    setEventDraft(null);
  };

  return (
    <div className="desk-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Sparkles size={18} /></span><span><strong>咏智桌面</strong><small>YZAI DESK</small></span></div>
        <nav>
          {NAV.map(([key, label, Icon]) => (
            <button key={key} className={active === key ? "active" : ""} onClick={() => setActive(key)}>
              <Icon size={18} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="privacy-card"><ShieldCheck size={18} /><div><strong>本地隐私保护</strong><span>数据仅存储在此设备</span></div></div>
        <div className="sidebar-foot"><span className="status-dot" /> 后台服务运行中 <small>v{APP_VERSION}</small></div>
      </aside>

      <main className={`dashboard dashboard-${active}`}>
        <header className="topbar">
          <div><p>{new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" })}</p><h1>{NAV.find(([key]) => key === active)?.[1]}</h1></div>
        </header>

        <div className={`page-content page-${active}`}>
          <PageErrorBoundary key={active} onRecover={() => setActive("overview")}>
            {active === "overview" && <Overview data={data} todayEvents={todayEvents} setActive={setActive} openNewEvent={openNewEvent} commit={commit} />}
            {active === "calendar" && <CalendarPage data={data} month={month} setMonth={setMonth} openNewEvent={openNewEvent} setEventDraft={setEventDraft} commit={commit} />}
            {active === "notes" && <NotesPage data={data} commit={commit} flash={flash} />}
            {active === "clipboard" && <ClipboardPage data={data} commit={commit} flash={flash} />}
            {active === "focus" && <FocusPage data={data} />}
            {active === "assistant" && <AssistantPage data={data} commit={commit} flash={flash} />}
            {active === "settings" && <SettingsPage data={data} commit={commit} importRef={importRef} flash={flash} />}
          </PageErrorBoundary>
        </div>
      </main>

      {eventDraft && <EventModal draft={eventDraft} setDraft={setEventDraft} onSave={saveEvent} onClose={() => setEventDraft(null)} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </div>
  );
}

function Overview({ data, todayEvents, setActive, openNewEvent, commit }) {
  const undone = data.events.filter((event) => !event.done).length;
  const todayPomos = data.pomo_stats?.[dateKey(new Date())] || 0;
  const focusMinutes = todayPomos * Number(data.settings.pomo_duration || 25);
  const greeting = new Date().getHours() < 12 ? "早上好" : new Date().getHours() < 18 ? "下午好" : "晚上好";
  const toggleEvent = (id) => commit({ ...data, events: data.events.map((item) => item.id === id ? { ...item, done: !item.done } : item) });

  return <>
    <section className="hero-card">
      <div><span className="eyebrow"><Sparkles size={14} /> TODAY, MAKE IT COUNT</span><h2>{greeting}，今天也要从容一点。</h2><p>把注意力留给真正重要的事，其余交给咏智桌面。</p></div>
      <div className="hero-date"><strong>{new Date().getDate()}</strong><span>{new Date().toLocaleDateString("zh-CN", { month: "short" })}</span></div>
    </section>
    <section className="metric-grid">
      <article><span className="metric-icon violet"><CalendarDays /></span><div><small>待完成日程</small><strong>{undone}<em> 项</em></strong></div></article>
      <article><span className="metric-icon amber"><Clock3 /></span><div><small>今日专注</small><strong>{focusMinutes}<em> 分钟</em></strong></div></article>
      <article><span className="metric-icon cyan"><Clipboard /></span><div><small>剪贴板记录</small><strong>{data.clipboard.length}<em> 条</em></strong></div></article>
    </section>
    <section className="overview-grid">
      <div className="panel schedule-panel">
        <PanelHead title="今日安排" action="查看日历" onClick={() => setActive("calendar")} />
        <div className="timeline">
          {todayEvents.length ? todayEvents.map((event) => <div className={`timeline-item ${event.done ? "done" : ""}`} key={event.id}>
            <button className="task-check" onClick={() => toggleEvent(event.id)}>{event.done && <Check size={13} />}</button>
            <time>{readableTime(event.time)}</time><div><strong>{event.title}</strong><span>{getEventType(event).label}{event.recurring !== "none" ? " · 周期" : ""}{event.notes ? ` · ${event.notes}` : ""}</span></div>
          </div>) : <EmptyState icon={CalendarDays} text="今天还没有安排" action="添加第一项" onClick={() => openNewEvent()} />}
        </div>
        <button className="add-row" onClick={() => openNewEvent()}><Plus size={16} /> 添加日程、提醒或备忘</button>
      </div>
      <div className="panel focus-card">
        <PanelHead title="专注节奏" action="查看统计" onClick={() => setActive("focus")} />
        <div className="focus-ring" style={{ "--progress": `${Math.min(todayPomos * 25, 100)}%` }}><div><Flame size={24} /><strong>{todayPomos}</strong><span>个番茄</span></div></div>
        <p>{todayPomos ? "状态不错，记得在专注之间活动一下。" : "开始第一段专注，让今天进入节奏。"}</p>
        <button className="primary-button" onClick={() => setActive("focus")}><Clock3 size={16} /> 开始专注</button>
      </div>
    </section>
  </>;
}

function CalendarPage({ data, month, setMonth, openNewEvent, setEventDraft, commit }) {
  const [filter, setFilter] = useState("all");
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => new Date(year, monthIndex, i + 1))];
  const changeMonth = (delta) => setMonth(new Date(year, monthIndex + delta, 1));
  const monthEvents = data.events.filter((event) => {
    const eventDate = new Date(event.time);
    return eventDate.getFullYear() === year && eventDate.getMonth() === monthIndex;
  });
  const filteredEvents = data.events.filter((event) => {
    if (filter === "reminder") return event.kind !== "memo" && event.remind;
    if (filter === "memo") return event.kind === "memo";
    if (filter === "unfinished") return !event.done;
    if (filter === "completed") return event.done;
    return true;
  });
  const stats = [
    { id: "reminder", label: "提醒数量", value: monthEvents.filter((event) => event.kind !== "memo" && event.remind).length, icon: BellRing },
    { id: "memo", label: "备忘数量", value: monthEvents.filter((event) => event.kind === "memo").length, icon: StickyNote },
    { id: "unfinished", label: "未完成", value: monthEvents.filter((event) => !event.done).length, icon: ListChecks },
    { id: "completed", label: "已完成", value: monthEvents.filter((event) => event.done).length, icon: CircleCheckBig },
  ];
  const editEvent = (event) => setEventDraft({ ...event, time: localDateTimeInput(event.time) });
  const remove = (id) => commit({ ...data, events: data.events.filter((item) => item.id !== id) }, "事项已删除");
  const toggleDone = (id) => commit({ ...data, events: data.events.map((item) => item.id === id ? { ...item, done: !item.done } : item) }, "完成状态已更新");
  const upcoming = filteredEvents
    .filter((event) => filter === "completed" ? event.done : !event.done)
    .sort((a, b) => filter === "completed" ? new Date(b.time) - new Date(a.time) : new Date(a.time) - new Date(b.time))
    .slice(0, 10);

  return <div className="calendar-page">
    <section className="calendar-stats">{stats.map((stat) => { const StatIcon = stat.icon; return <button key={stat.id} className={`panel ${filter === stat.id ? "active" : ""}`} onClick={() => setFilter((current) => current === stat.id ? "all" : stat.id)}><span><StatIcon /></span><div><small>本月 · {stat.label}</small><strong>{stat.value}<em> 项</em></strong></div></button>; })}</section>
    <div className="calendar-layout">
      <section className="panel calendar-panel">
        <div className="calendar-toolbar"><div><button className="ghost-button" onClick={() => { setMonth(new Date()); setFilter("all"); }}>返回今日</button><button className="icon-button" title="上个月" onClick={() => changeMonth(-1)}><ChevronLeft /></button><button className="icon-button" title="下个月" onClick={() => changeMonth(1)}><ChevronRight /></button></div><div className="calendar-title"><h2>{year} 年 {monthIndex + 1} 月</h2>{filter !== "all" && <button onClick={() => setFilter("all")}>清除筛选</button>}</div><button className="primary-button" onClick={() => openNewEvent()}><Plus size={16} /> 新建事项</button></div>
        <div className="weekdays">{"日一二三四五六".split("").map((day) => <span key={day}>周{day}</span>)}</div>
        <div className="month-grid">{cells.map((date, index) => {
          if (!date) return <div key={`blank-${index}`} className="blank" />;
          const dayEvents = filteredEvents.filter((event) => sameDay(event.time, date));
          return <button key={date.toISOString()} className={sameDay(date, new Date()) ? "today" : ""} onDoubleClick={() => openNewEvent(date)}>
            <div className="day-head"><span>{date.getDate()}</span>{dayEvents.length > 0 && <small>{dayEvents.length} 项</small>}</div>
            {dayEvents.slice(0, 3).map((event) => <em className={`event-chip type-${event.kind || "schedule"} ${event.done ? "done" : ""}`} key={event.id} onClick={(clickEvent) => { clickEvent.stopPropagation(); editEvent(event); }}><i />{event.kind === "memo" ? "" : readableTime(event.time)} {event.title}</em>)}
            {dayEvents.length > 3 && <small className="more-events">还有 {dayEvents.length - 3} 项</small>}
          </button>;
        })}</div>
      </section>
      <aside className="panel agenda-list"><PanelHead title={filter === "all" ? "待处理事项" : `${stats.find((stat) => stat.id === filter)?.label || "筛选结果"}`} /><div>{upcoming.length ? upcoming.map((event) => { const type = getEventType(event); const TypeIcon = type.icon; return <article className={event.done ? "done" : ""} key={event.id} onClick={() => editEvent(event)}><time><strong>{new Date(event.time).getDate()}</strong>{new Date(event.time).toLocaleDateString("zh-CN", { month: "short" })}</time><div><span className={`agenda-type type-${event.kind || "schedule"}`}><TypeIcon />{type.label}</span><strong>{event.title}</strong><span>{readableTime(event.time)}{event.notes ? ` · ${event.notes}` : ""}</span></div><div className="agenda-actions"><button title="切换完成状态" onClick={(clickEvent) => { clickEvent.stopPropagation(); toggleDone(event.id); }}><Check /></button><button title="删除" onClick={(clickEvent) => { clickEvent.stopPropagation(); remove(event.id); }}><Trash2 /></button></div></article>; }) : <EmptyState icon={CalendarDays} text="当前筛选下没有待处理事项" />}</div></aside>
    </div>
  </div>;
}

function NotesPage({ data, commit, flash }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(data.notes[0]?.id || null);
  const [unlocked, setUnlocked] = useState(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [plainDraft, setPlainDraft] = useState(null);
  const textareaRef = useRef(null);
  const importTextRef = useRef(null);
  const current = data.notes.find((note) => note.id === selected);
  const editorContent = current?.encrypted
    ? unlocked?.content || ""
    : plainDraft?.id === current?.id ? plainDraft.content : current?.content || "";
  const update = (patch, message) => commit({ ...data, notes: data.notes.map((note) => note.id === selected ? { ...note, ...patch, updated_at: new Date().toISOString() } : note) }, message);

  useEffect(() => {
    if (current && !current.encrypted) setPlainDraft({ id: current.id, content: current.content || "" });
  }, [current?.id, current?.encrypted]);

  useEffect(() => {
    if (!current && data.notes.length) {
      setSelected(data.notes[0].id);
      setUnlocked(null);
      setMoreOpen(false);
    }
  }, [current, data.notes]);

  const add = () => {
    const note = { id: uid(), title: "未命名便签", content: "", category: "随记", updated_at: new Date().toISOString(), encrypted: false, pinned: false };
    commit({ ...data, notes: [note, ...data.notes] }, "已创建便签");
    setSelected(note.id);
    setMoreOpen(false);
  };
  const remove = () => {
    const notes = data.notes.filter((note) => note.id !== selected);
    commit({ ...data, notes }, "便签已删除");
    setSelected(notes[0]?.id || null);
    setUnlocked(null);
    setMoreOpen(false);
  };
  const requestUnifiedPassword = async () => {
    const config = data.settings.note_password_config;
    if (!config) return null;
    const cached = getCachedNotePassword();
    if (cached && await verifyNotePassword(cached, config)) return cached;
    const password = window.prompt("请输入统一便签密码");
    if (!password) return null;
    if (!await verifyNotePassword(password, config)) {
      flash("统一便签密码不正确");
      return null;
    }
    setCachedNotePassword(password);
    return password;
  };
  const unlockNote = async () => {
    const config = data.settings.note_password_config;
    const password = config ? await requestUnifiedPassword() : window.prompt("这是旧版加密便签，请输入原密码");
    if (!password) return;
    try {
      const content = await decryptNote(current, password);
      setUnlocked({ id: current.id, password, content });
    } catch (error) {
      flash(error.message);
    }
  };
  const toggleLock = async () => {
    if (current.encrypted) {
      if (unlocked?.id === current.id) setUnlocked(null);
      else await unlockNote();
      return;
    }
    if (!data.settings.note_password_config) {
      flash("请先在设置中心 → 数据与备份中设置统一便签密码");
      return;
    }
    const password = await requestUnifiedPassword();
    if (!password) return;
    const encrypted = await encryptNote(editorContent, password);
    await update({ content: "", encrypted: true, ...encrypted }, "便签已锁定");
    setUnlocked(null);
  };
  const saveEditorDraft = async () => {
    if (!current) return;
    if (current.encrypted) {
      if (unlocked?.id !== current.id) return;
      const encrypted = await encryptNote(unlocked.content, unlocked.password);
      await update({ content: "", ...encrypted });
      return;
    }
    if (editorContent !== (current.content || "")) await update({ content: editorContent });
  };
  const setEditorContent = (content) => {
    if (!current) return;
    if (current.encrypted) setUnlocked({ ...unlocked, content });
    else setPlainDraft({ id: current.id, content });
  };
  const applyFormat = (type) => {
    const editor = textareaRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    let next = editorContent;
    let selectionStart = start;
    let selectionEnd = end;
    if (type === "bold" || type === "italic") {
      const marker = type === "bold" ? "**" : "*";
      const fallback = type === "bold" ? "加粗文字" : "斜体文字";
      const selectedText = editorContent.slice(start, end) || fallback;
      next = `${editorContent.slice(0, start)}${marker}${selectedText}${marker}${editorContent.slice(end)}`;
      selectionStart = start + marker.length;
      selectionEnd = selectionStart + selectedText.length;
    } else {
      const lineStart = editorContent.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const nextBreak = editorContent.indexOf("\n", end);
      const lineEnd = nextBreak === -1 ? editorContent.length : nextBreak;
      const source = editorContent.slice(lineStart, lineEnd) || "列表项";
      const formatted = source.split("\n").map((line, index) => type === "ordered" ? `${index + 1}. ${line}` : `- ${line}`).join("\n");
      next = `${editorContent.slice(0, lineStart)}${formatted}${editorContent.slice(lineEnd)}`;
      selectionStart = lineStart;
      selectionEnd = lineStart + formatted.length;
    }
    setEditorContent(next);
    requestAnimationFrame(() => { editor.focus(); editor.setSelectionRange(selectionStart, selectionEnd); });
  };
  const togglePinned = () => {
    update({ pinned: !current.pinned }, current.pinned ? "已取消置顶" : "便签已置顶");
    setMoreOpen(false);
  };
  const exportText = () => {
    if (current.encrypted && unlocked?.id !== current.id) return flash("请先解锁便签再导出");
    const blob = new Blob([editorContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(current.title || "便签").replace(/[\\/:*?"<>|]/g, "_")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setMoreOpen(false);
    flash("便签文本已导出");
  };
  const importText = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (current.encrypted && unlocked?.id !== current.id) {
      flash("请先解锁便签再导入文本");
    } else {
      const content = await file.text();
      if (current.encrypted) {
        const encrypted = await encryptNote(content, unlocked.password);
        setUnlocked({ ...unlocked, content });
        await update({ content: "", ...encrypted }, "文本已导入");
      } else {
        setPlainDraft({ id: current.id, content });
        await update({ content, title: current.title === "未命名便签" ? file.name.replace(/\.[^.]+$/, "") : current.title }, "文本已导入");
      }
    }
    event.target.value = "";
  };
  const filtered = [...data.notes]
    .filter((note) => `${String(note.title || "")} ${note.encrypted ? "" : String(note.content || "")}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0));

  return <section className="panel notes-workspace">
    <aside><div className="section-actions"><label className="search-box"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索便签" /></label><button className="icon-button filled" onClick={add}><Plus /></button></div><div className="note-list">{filtered.map((note) => <button className={selected === note.id ? "active" : ""} key={note.id} onClick={() => { setSelected(note.id); setUnlocked(null); setMoreOpen(false); }}><span>{note.encrypted ? <LockKeyhole size={15} /> : <NotebookPen size={15} />}{note.category}{note.pinned && <em><Pin size={10} />置顶</em>}</span><strong>{note.title}</strong><p>{note.encrypted ? "AES-256-GCM 加密内容" : note.content || "空白便签"}</p><time>{new Date(note.updated_at).toLocaleDateString("zh-CN")}</time></button>)}</div></aside>
    <div className="note-editor">{current ? <><div className="editor-toolbar"><input className="note-title" value={current.title} onChange={(e) => update({ title: e.target.value })} /><div><button className={`icon-button ${current.encrypted ? "locked" : ""}`} title={current.encrypted ? (unlocked?.id === current.id ? "锁定便签" : "解锁便签") : "锁定便签"} onClick={toggleLock}><LockKeyhole /></button><button className="icon-button danger" onClick={remove}><Trash2 /></button><div className="note-more"><button className={`icon-button ${moreOpen ? "active" : ""}`} title="更多操作" onClick={() => setMoreOpen((value) => !value)}><MoreHorizontal /></button>{moreOpen && <div className="note-more-menu"><button onClick={togglePinned}><Pin />{current.pinned ? "取消置顶" : "置顶便签"}</button><button onClick={() => { setMoreOpen(false); importTextRef.current?.click(); }}><FileUp />导入文本</button><button onClick={exportText}><FileDown />导出文本</button></div>}</div></div></div><div className="note-meta"><span>{current.category}</span><span>{current.encrypted ? "AES-256-GCM 加密存储" : "保存于本机"}</span>{current.pinned && <span>已置顶</span>}</div>{current.encrypted && unlocked?.id !== current.id ? <EmptyState icon={LockKeyhole} text="这条便签已加密" action="使用统一密码解锁" onClick={unlockNote} /> : <><div className="format-toolbar"><span>格式</span><button title="加粗" onClick={() => applyFormat("bold")}><Bold /></button><button title="斜体" onClick={() => applyFormat("italic")}><Italic /></button><i /><button title="无序列表" onClick={() => applyFormat("unordered")}><List /></button><button title="有序列表" onClick={() => applyFormat("ordered")}><ListOrdered /></button><small>支持 Markdown 格式</small></div><textarea ref={textareaRef} value={editorContent} onChange={(e) => setEditorContent(e.target.value)} onBlur={saveEditorDraft} placeholder="写下此刻的想法…" /></>}</> : <EmptyState icon={NotebookPen} text="选择或创建一条便签" action="新建便签" onClick={add} />}<input ref={importTextRef} type="file" hidden accept="text/plain,text/markdown,.txt,.md" onChange={importText} /></div>
  </section>;
}

function ClipboardPage({ data, commit, flash }) {
  const [query, setQuery] = useState("");
  const filtered = [...data.clipboard]
    .filter((item) => item.text.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.copied_at) - new Date(a.copied_at));
  const pinnedItems = filtered.filter((item) => item.pinned);
  const regularItems = filtered.filter((item) => !item.pinned);
  const pinnedCount = data.clipboard.filter((item) => item.pinned).length;
  const clearableCount = data.clipboard.length - pinnedCount;
  const togglePin = (id) => {
    const item = data.clipboard.find((entry) => entry.id === id);
    commit({ ...data, clipboard: data.clipboard.map((entry) => entry.id === id ? { ...entry, pinned: !entry.pinned } : entry) }, item?.pinned ? "已取消置顶" : "记录已置顶，不会被一键清理");
  };
  const remove = (item) => {
    if (item.pinned) return flash("置顶记录受保护，请先取消置顶");
    return commit({ ...data, clipboard: data.clipboard.filter((entry) => entry.id !== item.id) }, "记录已删除");
  };
  const clearUnpinned = () => {
    if (!clearableCount) return flash(pinnedCount ? "所有记录均已置顶，没有可清理内容" : "剪贴板历史已经为空");
    return commit({ ...data, clipboard: data.clipboard.filter((item) => item.pinned) }, pinnedCount ? `已清理 ${clearableCount} 条记录，保留 ${pinnedCount} 条置顶` : `已清理 ${clearableCount} 条记录`);
  };
  const copy = async (item) => {
    await callCommand("clean_paste", { text: item.text });
    if (!window.__TAURI_INTERNALS__) await navigator.clipboard?.writeText(item.text);
    flash("已复制为纯文本");
  };
  const renderItem = (item) => <article key={item.id} className={`${item.is_sensitive ? "sensitive" : ""} ${item.pinned ? "pinned" : ""}`}><div className="clip-type">{item.is_sensitive ? <LockKeyhole /> : <Clipboard />}</div><div className="clip-content"><p>{item.text}</p><span>{new Date(item.copied_at).toLocaleString("zh-CN")}{item.pinned && <em className="pinned-label"><Pin />已置顶</em>}{item.is_sensitive && <em>敏感内容</em>}</span></div><div className="clip-actions"><button className={item.pinned ? "active" : ""} title={item.pinned ? "取消置顶" : "置顶并防止清理"} onClick={() => togglePin(item.id)}><Pin /></button><button title="复制为纯文本" onClick={() => copy(item)}><Copy /></button><button className="delete-clip" disabled={item.pinned} title={item.pinned ? "置顶记录不可删除" : "删除记录"} onClick={() => remove(item)}><Trash2 /></button></div></article>;
  return <section className="panel clipboard-page">
    <div className="section-head"><div><h2>剪贴板历史</h2><p>置顶记录始终排在最前，并在一键清理时受到保护。</p></div><div className="section-actions"><label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索剪贴板内容" /></label><button className="ghost-button danger" disabled={!clearableCount} onClick={clearUnpinned}>一键清理</button></div></div>
    <div className="clipboard-summary"><article><span><Clipboard /></span><div><small>全部记录</small><strong>{data.clipboard.length}<em> 条</em></strong></div></article><article><span><Pin /></span><div><small>置顶保护</small><strong>{pinnedCount}<em> 条</em></strong></div></article><article><span><Trash2 /></span><div><small>可一键清理</small><strong>{clearableCount}<em> 条</em></strong></div></article></div>
    <div className="clipboard-list">{filtered.length ? <>{pinnedItems.length > 0 && <section className="clipboard-group pinned-group"><header><span><Pin />置顶记录</span><em>{pinnedItems.length}</em></header>{pinnedItems.map(renderItem)}</section>}{regularItems.length > 0 && <section className="clipboard-group"><header><span><Clipboard />普通记录</span><em>{regularItems.length}</em></header>{regularItems.map(renderItem)}</section>}</> : <EmptyState icon={Clipboard} text={query ? "没有匹配的剪贴板记录" : "还没有剪贴板记录"} />}</div>
  </section>;
}

function FocusPage({ data }) {
  const [active, setActive] = useState(false);
  const [seconds, setSeconds] = useState(Number(data.settings.pomo_duration || 25) * 60);
  const [sessionDuration, setSessionDuration] = useState(Number(data.settings.pomo_duration || 25) * 60);
  const duration = Math.max(1, sessionDuration);
  useEffect(() => {
    callCommand("get_active_pomo").then((session) => {
      if (!session) return;
      const remaining = session.running
        ? Math.max(0, Math.ceil((new Date(session.target_time).getTime() - Date.now()) / 1000))
        : Number(session.remaining_seconds || 0);
      setSeconds(remaining);
      setSessionDuration(Number(session.duration_mins || data.settings.pomo_duration || 25) * 60);
      setActive(Boolean(session.running && remaining > 0));
    });
  }, []);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setSeconds((value) => value > 0 ? value - 1 : 0), 1000);
    return () => clearInterval(timer);
  }, [active]);
  useEffect(() => { if (seconds === 0) setActive(false); }, [seconds]);
  const start = async () => { await callCommand("start_pomo", { seconds: Math.max(1, seconds), durationMins: Math.max(1, Math.ceil(duration / 60)), label: "深度专注" }); setActive(true); };
  const pause = async () => { const session = await callCommand("pause_pomo"); setSeconds(Number(session?.remaining_seconds ?? seconds)); setActive(false); };
  const reset = async () => { const nextDuration = Number(data.settings.pomo_duration || 25) * 60; await callCommand("stop_pomo"); setActive(false); setSessionDuration(nextDuration); setSeconds(nextDuration); };
  const days = Array.from({ length: 7 }, (_, index) => { const day = new Date(); day.setDate(day.getDate() - (6 - index)); const key = dateKey(day); return { label: day.toLocaleDateString("zh-CN", { weekday: "short" }), count: data.pomo_stats?.[key] || 0, minutes: data.pomo_minutes?.[key] ?? (data.pomo_stats?.[key] || 0) * Number(data.settings.pomo_duration || 25) }; });
  const max = Math.max(4, ...days.map((day) => day.count));
  const weekSessions = days.reduce((sum, day) => sum + day.count, 0);
  const weekMinutes = days.reduce((sum, day) => sum + day.minutes, 0);
  const today = days[days.length - 1];
  return <div className="focus-layout">
    <section className="panel timer-panel">
      <span className="eyebrow"><Flame size={14} /> FOCUS SESSION</span>
      <div className="focus-session-copy"><h2>开始一段专注时间</h2><p>一次只做一件事，完成后会自动计入最近 7 天统计。</p></div>
      <div className="timer-ring" style={{ "--angle": `${Math.min(1, seconds / duration) * 360}deg` }}><div><strong>{pad(Math.floor(seconds / 60))}:{pad(seconds % 60)}</strong><span>{active ? "保持专注" : seconds < duration ? "已暂停" : "准备开始"}</span></div></div>
      <input value="深度专注" aria-label="专注名称" readOnly />
      <div className="timer-actions"><button className="ghost-button" onClick={reset}>重置</button><button className="primary-button" onClick={active ? pause : start}>{active ? "暂停" : seconds < duration ? "继续专注" : "开始专注"}</button></div>
    </section>
    <section className="panel stats-panel">
      <PanelHead title="最近 7 天" />
      <div className="focus-kpis"><article><span>今日完成</span><strong>{today.count}<em>次</em></strong></article><article><span>本周专注</span><strong>{weekSessions}<em>次</em></strong></article><article><span>日均时长</span><strong>{Math.round(weekMinutes / 7)}<em>分钟</em></strong></article></div>
      <div className="bar-chart">{days.map((day) => <div key={day.label}><span>{day.count || ""}</span><i style={{ height: `${Math.max(8, day.count / max * 100)}%` }} /><em>{day.label}</em></div>)}</div>
      <div className="focus-summary"><article><small>7 日专注时长</small><strong>{weekMinutes} <em>分钟</em></strong></article><article><small>单次专注设定</small><strong>{Math.max(1, Math.round(duration / 60))} <em>分钟</em></strong></article></div>
    </section>
  </div>;
}

function AttachmentList({ attachments = [], removable = false, onRemove }) {
  if (!attachments.length) return null;
  return (
    <div className={`chat-attachments ${removable ? "pending" : ""}`}>
      {attachments.map((attachment) => (
        <div className={`chat-attachment ${attachment.kind}`} key={attachment.id}>
          {attachment.kind === "image"
            ? <img src={attachment.data_url} alt={attachment.name} />
            : <span><FileText /></span>}
          <div><strong>{attachment.name}</strong><small>{attachment.kind === "text" ? "文本附件" : attachment.kind === "pdf" ? "PDF 文档" : formatFileSize(attachment.size)}</small></div>
          {removable && <button type="button" onClick={() => onRemove(attachment.id)} title="移除附件"><X /></button>}
        </div>
      ))}
    </div>
  );
}

function AssistantPage({ data, commit, flash }) {
  const settings = data.settings;
  const activeProvider = getActiveAIProvider(settings);
  const conversations = useMemo(
    () => [...(data.ai_conversations || [])].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
    [data.ai_conversations],
  );
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const messageListRef = useRef(null);
  const activeConversation = conversations.find((conversation) => conversation.id === selectedId);

  useEffect(() => {
    if (selectedId === null) setSelectedId(conversations[0]?.id || "new");
    else if (selectedId !== "new" && !conversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(conversations[0]?.id || "new");
    }
  }, [conversations, selectedId]);

  useEffect(() => {
    if (loading) return;
    setMessages(selectedId === "new" ? [] : activeConversation?.messages || []);
  }, [selectedId, activeConversation?.updated_at, loading]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: loading ? "auto" : "smooth" });
  }, [messages, loading]);

  const startNewConversation = () => {
    if (loading) return;
    setSelectedId("new");
    setMessages([]);
    setInput("");
    setAttachments([]);
  };

  const selectConversation = (id) => {
    if (loading || id === selectedId) return;
    setSelectedId(id);
    setInput("");
    setAttachments([]);
  };

  const deleteConversation = async (event, id) => {
    event.stopPropagation();
    if (loading) return;
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    if (selectedId === id) setSelectedId(remaining[0]?.id || "new");
    await commit({ ...data, ai_conversations: remaining }, "历史对话已删除");
  };

  const attachFiles = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    if (attachments.length + files.length > MAX_ATTACHMENT_COUNT) return flash(`单次最多上传 ${MAX_ATTACHMENT_COUNT} 个附件`);
    if (files.some((file) => file.size > MAX_ATTACHMENT_SIZE)) return flash("单个附件不能超过 10 MB");
    if (attachments.reduce((sum, item) => sum + item.size, 0) + files.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) {
      return flash("单次附件总大小不能超过 20 MB");
    }
    try {
      const next = await Promise.all(files.map(createAttachment));
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      flash(error.message);
    }
  };

  const send = async (event) => {
    event.preventDefault();
    const text = input.trim();
    if ((!text && !attachments.length) || loading) return;

    const now = new Date().toISOString();
    const userMessage = { id: uid(), role: "user", content: text, attachments, created_at: now };
    const requestMessages = [...messages, userMessage];
    const assistantId = uid();
    const assistantMessage = { id: assistantId, role: "assistant", content: "", attachments: [], created_at: now };
    setMessages([...requestMessages, assistantMessage]);
    setInput("");
    setAttachments([]);
    setLoading(true);

    let answer = "";
    try {
      answer = await askAI(requestMessages, settings, (content) => {
        answer = content;
        setMessages([...requestMessages, { ...assistantMessage, content }]);
      });
      if (!answer.trim()) {
        answer = "模型没有返回可显示的内容，请重新发送或检查当前服务配置。";
        setMessages([...requestMessages, { ...assistantMessage, content: answer }]);
      }
    } catch (error) {
      answer = `暂时无法回答：${error.message}`;
      setMessages([...requestMessages, { ...assistantMessage, content: answer }]);
    }

    const conversationId = activeConversation?.id || uid();
    const titleSeed = text || attachments[0]?.name || "附件对话";
    const conversation = {
      id: conversationId,
      title: activeConversation?.messages?.length ? activeConversation.title : titleSeed.replace(/\s+/g, " ").slice(0, 32),
      created_at: activeConversation?.created_at || now,
      updated_at: new Date().toISOString(),
      messages: [...requestMessages, { ...assistantMessage, content: answer }],
    };
    const exists = (data.ai_conversations || []).some((item) => item.id === conversationId);
    const nextConversations = exists
      ? (data.ai_conversations || []).map((item) => item.id === conversationId ? conversation : item)
      : [conversation, ...(data.ai_conversations || [])];
    try {
      await commit({ ...data, ai_conversations: nextConversations });
      setSelectedId(conversationId);
    } catch (error) {
      flash(`对话保存失败：${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="assistant-workspace">
      <aside className="panel conversation-history">
        <div className="history-head"><div><span className="eyebrow">CONVERSATIONS</span><h2>历史对话</h2></div><button className="icon-button filled" onClick={startNewConversation} disabled={loading} title="新对话"><MessageSquarePlus /></button></div>
        <button className={`new-chat-button ${selectedId === "new" ? "active" : ""}`} onClick={startNewConversation} disabled={loading}><Plus />新对话</button>
        <div className="history-list">
          {conversations.map((conversation) => (
            <div className={`history-item ${conversation.id === selectedId ? "active" : ""}`} key={conversation.id}>
              <button className="history-select" onClick={() => selectConversation(conversation.id)} disabled={loading}>
                <MessageCircleMore />
                <span><strong>{conversation.title || "新对话"}</strong><small>{conversation.messages.length} 条消息 · {conversationTime(conversation.updated_at)}</small></span>
              </button>
              <button className="history-delete" title="删除对话" onClick={(event) => deleteConversation(event, conversation.id)} disabled={loading}><Trash2 /></button>
            </div>
          ))}
          {!conversations.length && <div className="history-empty"><MessageCircleMore /><span>对话会自动保存在本机</span></div>}
        </div>
      </aside>

      <section className="panel assistant-page">
        <div className="assistant-head">
          <span className="ai-orb"><Sparkles /></span>
          <div><h2>{activeConversation?.title || "新对话"}</h2><p>{activeProvider?.api_key ? `${activeProvider.name} · ${activeProvider.model_id}` : "尚未配置当前 AI 服务的 API Key"}</p></div>
          <button className="ghost-button assistant-new-button" onClick={startNewConversation} disabled={loading}><MessageSquarePlus />新对话</button>
        </div>

        <div className="message-list" ref={messageListRef}>
          {!messages.length && (
            <div className="assistant-empty">
              <span className="ai-orb"><Sparkles /></span>
              <h3>今天想一起完成什么？</h3>
              <p>可以直接提问，也可以上传图片、PDF、文本或代码文件作为上下文。</p>
              <div><button onClick={() => setInput("帮我梳理今天最重要的三件事")}>梳理今日计划</button><button onClick={() => setInput("请总结我接下来上传的内容")}>总结附件</button></div>
            </div>
          )}
          {messages.map((message) => (
            <article className={message.role} key={message.id}>
              <span>{message.role === "assistant" ? <Sparkles /> : "你"}</span>
              <div className="message-column">
                <AttachmentList attachments={message.attachments} />
                <div className="message-bubble">{message.content ? <MarkdownMessage content={message.content} /> : <i className="typing" />}</div>
                {message.role === "assistant" && message.content && <button className="message-copy" onClick={() => { navigator.clipboard.writeText(message.content); flash("回答已复制"); }}><Copy />复制回答</button>}
              </div>
            </article>
          ))}
        </div>

        <form className="chat-composer" onSubmit={send}>
          <AttachmentList attachments={attachments} removable onRemove={(id) => setAttachments((current) => current.filter((item) => item.id !== id))} />
          <div className="composer-row">
            <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.html,.css,.xml,.yaml,.yml,.log" onChange={attachFiles} hidden />
            <button className="attach-button" type="button" onClick={() => fileInputRef.current?.click()} disabled={loading || attachments.length >= MAX_ATTACHMENT_COUNT} title="上传图片或附件"><Paperclip /></button>
            <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="输入问题，Shift + Enter 换行…" rows={1} />
            <button className="send-button" disabled={(!input.trim() && !attachments.length) || loading}>{loading ? <i className="typing" /> : <><Send />发送</>}</button>
          </div>
          <small>支持图片、PDF、文本和代码附件 · 内容仅发送给当前配置的 AI 服务</small>
        </form>
      </section>
    </div>
  );
}

function SettingsPage({ data, commit, importRef, flash }) {
  const settings = data.settings;
  const [section, setSection] = useState("general");
  const [miniWidgetStates, setMiniWidgetStates] = useState({});
  const [miniWidgetPending, setMiniWidgetPending] = useState(null);
  const [systemFonts, setSystemFonts] = useState(FALLBACK_SYSTEM_FONTS);
  const [memoryStatus, setMemoryStatus] = useState(null);
  const [weatherCityInput, setWeatherCityInput] = useState(settings.weather_city || "");
  const [weatherCityPending, setWeatherCityPending] = useState(false);
  const settingsDetailRef = useRef(null);
  useEffect(() => {
    callCommand("get_mini_widget_states").then((states) => setMiniWidgetStates(states || {}));
    callCommand("get_system_fonts").then((fonts) => {
      if (Array.isArray(fonts) && fonts.length) setSystemFonts(fonts);
    });
    callCommand("install_desktop_context_menu").catch(() => {});
  }, []);
  useEffect(() => {
    settingsDetailRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [section]);
  useEffect(() => {
    setWeatherCityInput(settings.weather_city || "");
  }, [settings.weather_city]);
  useEffect(() => {
    if (section !== "about") return undefined;
    let active = true;
    const refresh = async () => {
      try {
        const status = await callCommand("get_process_memory");
        if (active && status) setMemoryStatus(status);
      } catch {
        if (active) setMemoryStatus(null);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => { active = false; window.clearInterval(timer); };
  }, [section]);
  const toggleMiniWidget = async (kind) => {
    if (miniWidgetPending) return;
    const visible = !miniWidgetStates[kind];
    const item = MINI_WIDGETS.find((widget) => widget.id === kind);
    setMiniWidgetPending(kind);
    try {
      const actualVisible = await callCommand("set_mini_widget_visibility", { kind, visible });
      setMiniWidgetStates((current) => ({ ...current, [kind]: Boolean(actualVisible) }));
      flash(actualVisible ? `${item.name}已添加到桌面` : `${item.name}已从桌面隐藏`);
    } catch (error) {
      flash(`${item.name}${visible ? "添加" : "隐藏"}失败：${error?.message || error}`);
    } finally {
      setMiniWidgetPending(null);
    }
  };
  const update = async (patch, message) => {
    const nextSettings = { ...settings, ...patch };
    if (Object.hasOwn(patch, "autostart")) await callCommand("set_autostart", { enable: patch.autostart });
    await commit({ ...data, settings: nextSettings }, message);
  };
  const saveWeatherCity = async () => {
    if (weatherCityPending) return;
    const query = weatherCityInput.trim();
    if (query.length < 2) return flash("请输入至少 2 个字符的城市或地区名称");
    setWeatherCityPending(true);
    try {
      const location = await lookupWeatherLocation(query);
      await verifyWeatherLocation(location);
      await update({
        weather_city: location.name,
        weather_lat: location.latitude,
        weather_lon: location.longitude,
      });
      setWeatherCityInput(location.name);
      const region = location.admin1 && location.admin1 !== location.name ? `（${location.admin1}）` : "";
      flash(`天气城市已保存：${location.name}${region}`);
    } catch (error) {
      flash(error?.message || "天气城市保存失败，请检查网络后重试");
    } finally {
      setWeatherCityPending(false);
    }
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try { await commit(await readBackup(file), "数据已恢复"); } catch (error) { flash(error.message); }
    event.target.value = "";
  };
  const copyDataPath = async () => {
    await callCommand("clean_paste", { text: "%APPDATA%\\yzai-desk\\data.json" });
    if (!window.__TAURI_INTERNALS__) await navigator.clipboard?.writeText("%APPDATA%\\yzai-desk\\data.json");
    flash("本地数据路径已复制");
  };
  const memoryMb = Number(memoryStatus?.working_set_mb || 0);
  const memoryLevel = memoryMb < 200 ? "运行良好" : memoryMb < 400 ? "占用适中" : "占用较高";
  const memoryPercent = Math.min(100, memoryMb / 512 * 100);
  const openWebsite = async () => {
    if (window.__TAURI_INTERNALS__) await openUrl("https://yzai.eu.cc");
    else window.open("https://yzai.eu.cc", "_blank", "noopener,noreferrer");
  };

  return <div className="settings-workspace">
    <aside className="panel settings-subnav">
      <div><span className="eyebrow">PREFERENCES</span><h2>设置中心</h2><p>管理桌面体验与服务连接。</p></div>
      <nav>{SETTINGS_NAV.map(([key, label, Icon]) => <button key={key} className={section === key ? "active" : ""} onClick={() => setSection(key)}><Icon /><span>{label}</span><ChevronRight /></button>)}</nav>
    </aside>
    <div className="settings-detail" ref={settingsDetailRef}>
      {section === "general" && <div className="settings-stack">
        <SettingsCard title="启动与后台" description="控制应用的启动方式和后台行为。">
          <SettingRow title="开机自动启动" description="登录 Windows 后自动在后台运行"><Toggle checked={settings.autostart} onChange={(value) => update({ autostart: value }, "启动设置已保存")} /></SettingRow>
          <SettingRow title="敏感内容自动清理" description="敏感剪贴板内容保留 3 分钟后自动清空"><Toggle checked={settings.sensitive_auto_clear} onChange={(value) => update({ sensitive_auto_clear: value }, "隐私设置已保存")} /></SettingRow>
        </SettingsCard>
        <SettingsCard title="效率偏好" description="设置日常专注和天气信息。">
          <SettingRow title="番茄钟时长" description="新专注会话使用的默认时长"><select value={settings.pomo_duration} onChange={(e) => update({ pomo_duration: Number(e.target.value) }, "专注时长已保存")}><option value="15">15 分钟</option><option value="25">25 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option></select></SettingRow>
          <SettingRow title="天气城市" description={weatherCityPending ? "正在查询地区并更新天气坐标…" : "输入地区后按回车保存 · 数据由 Open-Meteo 提供"}><input className="compact-input wide" value={weatherCityInput} disabled={weatherCityPending} placeholder="例如：深圳、杭州" aria-label="天气城市" onChange={(event) => setWeatherCityInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveWeatherCity(); } }} /></SettingRow>
        </SettingsCard>
      </div>}

      {section === "appearance" && <div className="settings-stack">
        <SettingsCard title="主题风格" description="选择适合当前工作环境的界面配色。">
          <div className="theme-grid">{THEMES.map((theme) => <button key={theme.id} className={`theme-card ${settings.theme === theme.id ? "active" : ""}`} onClick={() => update({ theme: theme.id }, `已切换为${theme.name}`)}><span className="theme-preview">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span><strong>{theme.name}</strong><small>{theme.description}</small>{settings.theme === theme.id && <Check />}</button>)}</div>
        </SettingsCard>
        <SettingsCard title="系统字体" description="从当前电脑已安装的字体中选择界面字体，并调整全局文字大小。">
          <SettingRow title="界面字体" description={`已从 Windows 加载 ${systemFonts.length} 种可用字体`}><select className="font-family-select" value={settings.system_font || "system"} onChange={(event) => update({ system_font: event.target.value }, "界面字体已更新")}><option value="system">跟随系统默认</option>{systemFonts.map((font) => <option key={font} value={font} style={{ fontFamily: `"${font}"` }}>{font}</option>)}</select></SettingRow>
          <RangeRow label="界面字号" value={Number(settings.font_size || 100)} min="85" max="125" step="5" onChange={(value) => update({ font_size: value })} />
          <div className="font-preview" style={{ fontFamily: settings.system_font && settings.system_font !== "system" ? `"${settings.system_font}"` : undefined }}><span>字体预览</span><strong>咏智桌面，让日常工作更专注。</strong><small>YZai Desk · 0123456789</small></div>
        </SettingsCard>
      </div>}

      {section === "widgets" && <div className="settings-stack">
        <SettingsCard title="独立桌面挂件" description="按需添加日历、便签、番茄钟和天气；每个挂件都能独立拖动与缩放。">
          <div className="widget-catalog">{MINI_WIDGETS.map((widget) => { const WidgetIcon = widget.icon; const visible = Boolean(miniWidgetStates[widget.id]); const pending = miniWidgetPending === widget.id; return <article key={widget.id} className={visible ? "active" : ""}><span><WidgetIcon /></span><div><strong>{widget.name}</strong><small>{widget.description}</small></div><button className={visible ? "ghost-button" : "primary-button"} disabled={Boolean(miniWidgetPending)} onClick={() => toggleMiniWidget(widget.id)}>{pending ? "处理中…" : visible ? "隐藏" : "添加"}</button></article>; })}</div>
          <div className="desktop-menu-tip"><MoreHorizontal /><p><strong>桌面右键快捷添加</strong>在 Windows 桌面空白处点击右键，选择“咏智桌面挂件”，即可直接添加任一挂件。</p></div>
        </SettingsCard>
        <SettingsCard title="挂件外观与兼容性" description="统一调整日历、便签、番茄钟和天气四个独立挂件的显示效果。">
          <SettingRow title="挂件兼容模式" description="关闭高开销背景模糊，适合 Windows 11 24H2/25H2 或集成显卡电脑"><Toggle checked={settings.widget_compatibility_mode !== false} onChange={(value) => update({ widget_compatibility_mode: value }, value ? "已启用挂件兼容模式" : "已启用完整视觉效果")} /></SettingRow>
          <RangeRow label="不透明度" value={settings.opacity} min="55" max="100" onChange={(value) => update({ opacity: value })} />
          <RangeRow label="背景模糊" value={settings.blur} min="0" max="36" suffix=" px" onChange={(value) => update({ blur: value })} />
        </SettingsCard>
      </div>}

      {section === "ai" && <AISettingsPanel settings={settings} update={update} flash={flash} />}

      {section === "data" && <div className="settings-stack">
        <NotePasswordSettings data={data} commit={commit} flash={flash} />
        <SettingsCard title="本地数据备份" description="导出日程、便签、剪贴板记录和全部设置。">
          <div className="backup-actions"><button className="ghost-button" onClick={() => importRef.current?.click()}><Upload size={16} /> 导入备份</button><button className="primary-button" onClick={() => exportBackup(data)}><Download size={16} /> 导出 JSON</button><input ref={importRef} type="file" hidden accept="application/json" onChange={importFile} /></div>
        </SettingsCard>
        <SettingsCard title="本地存储" description="所有核心数据默认保存在当前 Windows 用户目录。">
          <div className="data-location"><Database /><div><strong>%APPDATA%\yzai-desk\data.json</strong><span>包含设置、日程、便签、统计与剪贴板历史</span></div><button className="ghost-button" onClick={copyDataPath}><Copy size={14} />复制路径</button></div>
          <div className="privacy-note"><ShieldCheck /><p><strong>本地优先</strong>除天气和你主动配置的 AI 服务外，应用不会把本地数据发送到其他服务器。</p></div>
        </SettingsCard>
      </div>}

      {section === "about" && <div className="settings-stack">
        <section className="panel about-hero"><span className="brand-mark"><Sparkles /></span><div><small>YZAI DESK</small><h2>咏智桌面工具</h2><p>把日程、速记、剪贴板与 AI 助手留在一个轻量桌面工作台里。</p></div><span className="version-pill">v{APP_VERSION}</span></section>
        <SettingsCard title="版本信息" description="当前应用与运行环境。">
          <div className="about-list"><div><span>应用版本</span><strong>{APP_VERSION} 测试版</strong></div><div><span>桌面框架</span><strong>Tauri 2 + React 19</strong></div><div><span>数据位置</span><strong>Windows 用户本地目录</strong></div><div><span>更新方式</span><strong>当前为手动更新</strong></div></div>
        </SettingsCard>
        <SettingsCard title="开发信息" description="咏智桌面工具的开发与维护团队。">
          <div className="developer-info"><span className="brand-mark"><Sparkles /></span><div><small>开发作者</small><strong>无忧AI</strong></div><div><small>开发团队</small><strong>咏智AI团队</strong></div><button className="ghost-button" onClick={openWebsite}><ExternalLink />yzai.eu.cc</button></div>
        </SettingsCard>
        <SettingsCard title="系统占用状态" description="显示当前咏智桌面进程的实时内存工作集，每 5 秒刷新。">
          <div className="memory-status"><span><MemoryStick /></span><div><small>当前应用内存</small><strong>{memoryMb ? `${memoryMb.toFixed(1)} MB` : "正在读取…"}</strong><em className={memoryMb >= 400 ? "high" : memoryMb >= 200 ? "medium" : ""}>{memoryMb ? memoryLevel : "桌面端实时统计"}</em></div><div className="memory-meter"><i style={{ width: `${memoryPercent}%` }} /></div></div>
        </SettingsCard>
        <SettingsCard title="隐私与协议" description="当前版本的能力边界。">
          <div className="about-copy"><p>便签可使用 AES-256-GCM 加密；主密码不会写入本地文件。</p><p>自定义 AI 服务的 API Key 当前随本地设置保存，请只在受信任的电脑上使用。</p><p>本项目仍处于内部测试阶段，安装器、自动更新与代码签名尚未发布。</p></div>
        </SettingsCard>
      </div>}
    </div>
  </div>;
}

function SettingsCard({ title, description, action, children }) {
  return <section className="panel settings-card"><div className="settings-card-head"><div><h2>{title}</h2><p>{description}</p></div>{action}</div>{children}</section>;
}

function NotePasswordSettings({ data, commit, flash }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const config = data.settings.note_password_config;
  const encryptedCount = data.notes.filter((note) => note.encrypted).length;
  const needsCurrent = Boolean(config || encryptedCount);

  const savePassword = async (event) => {
    event.preventDefault();
    if (newPassword.length < 6) return flash("统一便签密码至少需要 6 位");
    if (newPassword !== confirmPassword) return flash("两次输入的新密码不一致");
    if (needsCurrent && !currentPassword) return flash(config ? "请输入当前统一密码" : "请输入旧加密便签的密码");
    setBusy(true);
    try {
      if (config && !await verifyNotePassword(currentPassword, config)) {
        throw new Error("当前统一密码不正确");
      }
      const notes = [];
      for (const note of data.notes) {
        if (!note.encrypted) {
          notes.push(note);
          continue;
        }
        const content = await decryptNote(note, currentPassword);
        const encrypted = await encryptNote(content, newPassword);
        notes.push({ ...note, content: "", ...encrypted });
      }
      const notePasswordConfig = await createNotePasswordConfig(newPassword);
      await commit({ ...data, notes, settings: { ...data.settings, note_password_config: notePasswordConfig } }, config ? "统一便签密码已更新" : "统一便签密码已设置");
      setCachedNotePassword(newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      flash(error.message === "密码不正确，无法解锁这条便签" ? "旧密码无法解锁已有加密便签，未修改任何数据" : error.message);
    } finally {
      setBusy(false);
    }
  };

  return <SettingsCard title="便签锁定密码" description="为所有便签设置统一的锁定与解锁密码。密码只在当前运行会话中短暂缓存，不保存明文。" action={<span className={`password-status ${config ? "configured" : ""}`}>{config ? "已设置" : "未设置"}</span>}>
    <form className="password-settings" onSubmit={savePassword}>
      {needsCurrent && <label className="full"><span>{config ? "当前统一密码" : "旧加密便签密码"}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={config ? "用于验证身份和迁移已有便签" : "用于迁移旧版加密便签"} /></label>}
      <label><span>{config ? "新的统一密码" : "统一便签密码"}</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="至少 6 位" /></label>
      <label><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="再次输入新密码" /></label>
      <div className="password-note"><ShieldCheck /><p>{encryptedCount ? `保存后会使用新密码重新加密 ${encryptedCount} 条已锁定便签。` : "设置后，点击便签工具栏的锁图标即可使用统一密码锁定。"}</p></div>
      <button className="primary-button" disabled={busy}>{busy ? "正在安全迁移…" : config ? "更新统一密码" : "设置统一密码"}</button>
    </form>
  </SettingsCard>;
}

function AISettingsPanel({ settings, update, flash }) {
  const providers = settings.ai_providers || [];
  const [selectedId, setSelectedId] = useState(settings.active_ai_provider_id || providers[0]?.id);
  const selected = providers.find((provider) => provider.id === selectedId) || null;
  const [draft, setDraft] = useState(selected || null);
  const isNew = Boolean(draft && !providers.some((provider) => provider.id === draft.id));
  const displayedProviders = isNew ? [...providers, draft] : providers;

  useEffect(() => { if (selected) setDraft({ ...selected }); }, [selectedId, selected]);

  const addProvider = () => {
    const provider = { id: uid(), name: `自定义服务 ${providers.length + 1}`, protocol: "openai", base_url: "", model_id: "", api_key: "" };
    setDraft(provider);
    setSelectedId(provider.id);
  };
  const saveProvider = async () => {
    if (!draft.name.trim()) return flash("请填写服务名称");
    if (!draft.base_url.trim()) return flash("请填写 Base URL");
    if (!draft.model_id.trim()) return flash("请填写模型 ID");
    const saved = { ...draft, base_url: draft.base_url.replace(/\/$/, "") };
    const next = isNew ? [...providers, saved] : providers.map((provider) => provider.id === draft.id ? saved : provider);
    await update({ ai_providers: next, active_ai_provider_id: settings.active_ai_provider_id || saved.id }, "AI 服务已保存");
    setSelectedId(saved.id);
  };
  const removeProvider = async () => {
    if (isNew) {
      const fallback = providers.find((provider) => provider.id === settings.active_ai_provider_id) || providers[0];
      setSelectedId(fallback?.id);
      setDraft(fallback ? { ...fallback } : null);
      return;
    }
    if (providers.length <= 1) return flash("至少需要保留一个 AI 服务");
    const next = providers.filter((provider) => provider.id !== draft.id);
    const activeId = settings.active_ai_provider_id === draft.id ? next[0].id : settings.active_ai_provider_id;
    await update({ ai_providers: next, active_ai_provider_id: activeId }, "AI 服务已删除");
    setSelectedId(activeId);
  };
  const activateProvider = () => update({ active_ai_provider_id: draft.id }, `已启用 ${draft.name}`);

  return <div className="ai-settings-layout">
    <aside className="panel provider-list"><div className="provider-list-head"><div><span className="eyebrow">MODEL ENDPOINTS</span><h2>AI 服务</h2></div><button className="icon-button filled" onClick={addProvider} title="添加自定义服务"><Plus /></button></div><div>{displayedProviders.map((provider) => <button key={provider.id} className={provider.id === draft?.id ? "active" : ""} onClick={() => setSelectedId(provider.id)}><span className={`provider-icon ${provider.protocol}`}><Server /></span><div><strong>{provider.name}</strong><small>{provider.model_id || "未填写模型 ID"}</small></div>{provider.id === settings.active_ai_provider_id && <i>使用中</i>}</button>)}</div></aside>
    {draft && <section className="panel provider-editor"><div className="settings-card-head"><div><span className="eyebrow">CONNECTION</span><h2>{draft.name}</h2><p>配置兼容的模型接口；Base URL 无需填写最后的具体请求路径。</p></div><span className={`connection-badge ${draft.api_key ? "online" : ""}`}>{draft.api_key ? "已配置" : "缺少 Key"}</span></div>
      <div className="protocol-switch"><button className={draft.protocol === "openai" ? "active" : ""} onClick={() => setDraft({ ...draft, protocol: "openai" })}><strong>OpenAI 兼容</strong><span>/v1/chat/completions</span></button><button className={draft.protocol === "anthropic" ? "active" : ""} onClick={() => setDraft({ ...draft, protocol: "anthropic" })}><strong>Anthropic</strong><span>/v1/messages</span></button></div>
      <div className="provider-form"><label><span>服务名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：公司模型网关" /></label><label><span>协议类型</span><select value={draft.protocol} onChange={(event) => setDraft({ ...draft, protocol: event.target.value })}><option value="openai">OpenAI Chat Completions</option><option value="anthropic">Anthropic Messages</option></select></label><label className="full"><span>Base URL</span><input value={draft.base_url} onChange={(event) => setDraft({ ...draft, base_url: event.target.value })} placeholder={draft.protocol === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"} /></label><label><span>模型 ID</span><input value={draft.model_id} onChange={(event) => setDraft({ ...draft, model_id: event.target.value })} placeholder={draft.protocol === "anthropic" ? "claude-sonnet-4-5" : "gpt-4.1-mini"} /></label><label><span>API Key</span><input type="password" value={draft.api_key} onChange={(event) => setDraft({ ...draft, api_key: event.target.value })} placeholder="输入服务密钥" /></label></div>
      <div className="provider-tip"><ShieldCheck /><p>密钥保存在当前电脑的本地设置中。自定义服务需要允许桌面 WebView 发起跨域请求。</p></div>
      <div className="provider-actions"><button className={`ghost-button ${isNew ? "" : "danger"}`} onClick={removeProvider}><Trash2 size={15} />{isNew ? "取消添加" : "删除服务"}</button><span /><button className="ghost-button" disabled={isNew || draft.id === settings.active_ai_provider_id} onClick={activateProvider}>{draft.id === settings.active_ai_provider_id ? "当前使用中" : "设为当前服务"}</button><button className="primary-button" onClick={saveProvider}>保存配置</button></div>
    </section>}
  </div>;
}

function EventModal({ draft, setDraft, onSave, onClose }) {
  const type = getEventType(draft);
  const changeType = (kind) => setDraft({
    ...draft,
    kind,
    remind: kind === "reminder" ? true : kind === "memo" ? false : draft.remind !== false,
    recurring: kind === "memo" ? "none" : draft.recurring,
  });
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="event-modal" onSubmit={(event) => { event.preventDefault(); onSave(draft); }}>
      <div className="modal-head"><div><span className="eyebrow">CALENDAR ITEM</span><h2>{draft.id ? `编辑${type.label}` : "新建事项"}</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div>
      <div className="event-type-switch">{Object.entries(EVENT_TYPES).map(([kind, item]) => { const TypeIcon = item.icon; return <button type="button" key={kind} className={(draft.kind || "schedule") === kind ? "active" : ""} onClick={() => changeType(kind)}><TypeIcon /><span><strong>{item.label}</strong><small>{item.description}</small></span></button>; })}</div>
      <label><span>{type.label}名称</span><input autoFocus value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder={draft.kind === "memo" ? "需要记住什么？" : draft.kind === "reminder" ? "需要提醒什么？" : "准备做什么？"} /></label>
      <label><span>{draft.kind === "memo" ? "记录日期" : draft.kind === "reminder" ? "提醒时间" : "开始时间"}</span><input type="datetime-local" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></label>
      <label><span>补充说明</span><textarea value={draft.notes || ""} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="添加地点、联系人或需要留意的信息（可选）" /></label>
      {draft.kind === "schedule" && <div className="reminder-option"><div><BellRing /><span><strong>到点提醒</strong><small>在日程开始时弹出桌面提醒</small></span></div><button type="button" className={`toggle ${draft.remind !== false ? "on" : ""}`} onClick={() => setDraft({ ...draft, remind: draft.remind === false })}><i /></button></div>}
      {draft.kind === "reminder" && <div className="event-type-tip reminder"><BellRing /><span>到达设定时间后会弹出提醒，可选择 5 分钟后再次提醒。</span></div>}
      {draft.kind === "memo" && <div className="event-type-tip memo"><StickyNote /><span>备忘会显示在日历中，但不会自动弹出提醒或到期完成。</span></div>}
      {draft.kind !== "memo" && <label><span>重复</span><select value={draft.recurring} onChange={(event) => setDraft({ ...draft, recurring: event.target.value })}><option value="none">不重复</option><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option><option value="yearly">每年</option></select></label>}
      <div className="modal-actions"><button type="button" className="ghost-button" onClick={onClose}>取消</button><button className="primary-button">保存{type.label}</button></div>
    </form>
  </div>;
}

function PanelHead({ title, action, onClick }) { return <div className="panel-head"><h2>{title}</h2>{action && <button onClick={onClick}>{action}<ChevronRight size={15} /></button>}</div>; }
function EmptyState({ icon: Icon, text, action, onClick }) { return <div className="empty-state"><span><Icon /></span><p>{text}</p>{action && <button onClick={onClick}>{action}</button>}</div>; }
function Toggle({ checked, onChange }) { return <button className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i /></button>; }
function SettingRow({ title, description, children }) { return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div>{children}</div>; }
function RangeRow({ label, value, min, max, step = "1", suffix = "%", onChange }) { return <div className="range-row"><div><strong>{label}</strong><span>{value}{suffix}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></div>; }

export default SettingsDashboard;
