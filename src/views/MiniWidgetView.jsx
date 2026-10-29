import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudFog,
  Sun,
  Grip,
  LockKeyhole,
  MoreHorizontal,
  NotebookPen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  TimerReset,
  X,
} from "lucide-react";
import { callCommand, loadData, saveData, subscribe } from "../lib/deskApi";
import { usePomo } from "../lib/usePomo";
import FocusDurationPicker from "../components/FocusDurationPicker";
import { useWidgetLayout, WIDGET_SIZE_LABELS } from "../lib/useWidgetLayout";

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateTimeTitle = (date) => `${dateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
const DESKTOP_NOTE_ID = "desktop-quick-note";
const noteUid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const findDesktopNote = (notes) => notes.find((item) => !item.encrypted && (item.source === "desktop-widget" || item.id === DESKTOP_NOTE_ID));
const LABELS = { calendar: "日历", note: "随手记", focus: "专注时间", weather: "天气" };
const weatherIcon = (code) => {
  if (code === 0) return Sun;
  if ([1, 2, 3].includes(code)) return CloudSun;
  if ([45, 48].includes(code)) return CloudFog;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow;
  if (code >= 51) return CloudRain;
  return Cloud;
};
const ICONS = { calendar: CalendarDays, note: NotebookPen, focus: TimerReset, weather: CloudSun };

function MiniWidgetView({ kind }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [month, setMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [weatherUpdatedAt, setWeatherUpdatedAt] = useState(null);
  const [weather, setWeather] = useState(null);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [noteCreating, setNoteCreating] = useState(false);
  const { seconds, total: sessionTotal, running, hasSession, error: pomoError, setDuration, start, pause, reset } = usePomo(data?.settings?.pomo_duration, "桌面专注", kind === "focus");
  const [contextMenu, setContextMenu] = useState(null);
  const widgetState = data?.settings?.mini_widgets?.[kind] || {};
  const locked = Boolean(widgetState.locked);
  const layout = useWidgetLayout(kind, locked);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize); return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    const close = (event) => { if (event.key === "Escape") { setContextMenu(null); layout.clearError(); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const noteReady = useRef(false);
  const noteIdRef = useRef("");
  const noteSaveToken = useRef(0);
  const noteTextareaRef = useRef(null);
  const Icon = ICONS[kind] || CalendarDays;

  const loadDesktopNote = (selectedNote) => {
    noteReady.current = false;
    noteIdRef.current = selectedNote?.id || "";
    setNote(selectedNote?.content || "");
    setTimeout(() => { noteReady.current = true; }, 0);
  };

  useEffect(() => {
    let cancelled = false;
    loadData().then(async (loaded) => {
      if (cancelled) return;
      setData(loaded);
      const quickNote = findDesktopNote(loaded.notes);
      loadDesktopNote(quickNote);

    });
    const offData = subscribe("data-changed", (nextData) => {
      setData(nextData);
      if (kind !== "note") return;
      const activeNote = nextData.notes.find((item) => item.id === noteIdRef.current && !item.encrypted) || (!noteIdRef.current ? findDesktopNote(nextData.notes) : null);
      const editing = document.activeElement?.tagName === "TEXTAREA";
      if (activeNote && !editing) {
        setNote(activeNote.content || "");
      } else if (!activeNote && !editing) {
        loadDesktopNote(null);
      }
    });
    return () => {
      cancelled = true;
      offData.then((cleanup) => cleanup());
    };
  }, [kind]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    if (!pageVisible) return undefined;
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(clock);
  }, [pageVisible]);

  useEffect(() => {
    if (kind !== "weather" || !data || !pageVisible) return undefined;
    let cancelled = false;
    let controller;
    setWeather(null);
    setWeatherUpdatedAt(null);
    const refresh = async () => {
      controller?.abort(); controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${data.settings.weather_lat}&longitude=${data.settings.weather_lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`, { signal: controller.signal });
        if (!response.ok) throw new Error("天气服务不可用");
        const result = await response.json();
        if (!cancelled && result.current) { setWeather(result.current); setWeatherUpdatedAt(new Date()); }
      } catch { /* Keep the last successful reading and its timestamp. */ }
      finally { clearTimeout(timeout); }
    };
    refresh();
    const timer = setInterval(refresh, 15 * 60 * 1000);
    return () => { cancelled = true; controller?.abort(); clearInterval(timer); };
  }, [data?.settings?.weather_lat, data?.settings?.weather_lon, kind, pageVisible]);

  useEffect(() => {
    if (kind !== "note" || !noteReady.current) return undefined;
    const token = ++noteSaveToken.current;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const latest = await loadData();
        if (token !== noteSaveToken.current) return;
        const existing = latest.notes.find((item) => item.id === noteIdRef.current && !item.encrypted) || (!noteIdRef.current ? findDesktopNote(latest.notes) : null);
        if (!existing && !note.trim()) {
          setSaveState("saved");
          return;
        }
        const updatedAt = new Date().toISOString();
        const idTaken = latest.notes.some((item) => item.id === DESKTOP_NOTE_ID);
        const targetId = existing?.id || (idTaken ? `${DESKTOP_NOTE_ID}-${Date.now()}` : DESKTOP_NOTE_ID);
        noteIdRef.current = targetId;
        const notes = existing
          ? latest.notes.map((item) => item.id === targetId ? { ...item, content: note, source: "desktop-widget", updated_at: updatedAt } : item)
          : [{ id: targetId, title: dateTimeTitle(new Date()), content: note, source: "desktop-widget", category: "随记", updated_at: updatedAt, encrypted: false, pinned: false }, ...latest.notes];
        if (token !== noteSaveToken.current) return;
        const savedData = await saveData({ ...latest, notes }, ["notes"], latest);
        if (token !== noteSaveToken.current) return;
        setData(savedData);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [kind, note]);


  const calendar = useMemo(() => {
    const year = month.getFullYear();
    const index = month.getMonth();
    return { year, index, blanks: new Date(year, index, 1).getDay(), days: new Date(year, index + 1, 0).getDate() };
  }, [month]);

  const hideWidget = () => callCommand("set_mini_widget_visibility", { kind, visible: false });
  const openSettings = async () => {
    setContextMenu(null);
    await callCommand("show_settings_window");
  };
  const startTimer = async () => { if (running) await pause(); else await start(); };
  const resetTimer = reset;
  const addDesktopNote = async () => {
    if (noteCreating) return;
    setNoteCreating(true);
    noteSaveToken.current += 1;
    noteReady.current = false;
    setSaveState("saving");
    try {
      const latest = await loadData();
      const updatedAt = new Date().toISOString();
      let notes = latest.notes;
      const current = notes.find((item) => item.id === noteIdRef.current && !item.encrypted);
      if (current) {
        notes = notes.map((item) => item.id === current.id ? { ...item, content: note, source: "desktop-widget", updated_at: updatedAt } : item);
      } else if (note.trim()) {
        const previousId = notes.some((item) => item.id === DESKTOP_NOTE_ID) ? `${DESKTOP_NOTE_ID}-${noteUid()}` : DESKTOP_NOTE_ID;
        notes = [{ id: previousId, title: dateTimeTitle(new Date()), content: note, source: "desktop-widget", category: "随记", updated_at: updatedAt, encrypted: false, pinned: false }, ...notes];
      }
      const createdAt = new Date();
      const newNote = { id: `${DESKTOP_NOTE_ID}-${noteUid()}`, title: dateTimeTitle(createdAt), content: "", source: "desktop-widget", category: "随记", updated_at: createdAt.toISOString(), encrypted: false, pinned: false };
      noteIdRef.current = newNote.id;
      const savedData = await saveData({ ...latest, notes: [newNote, ...notes] }, ["notes"], latest);
      setData(savedData);
      setNote("");
      setSaveState("saved");
      setTimeout(() => { noteReady.current = true; noteTextareaRef.current?.focus(); }, 0);
    } catch {
      setSaveState("error");
      noteReady.current = true;
    } finally {
      setNoteCreating(false);
    }
  };
  const menuAction = (action) => { setContextMenu(null); layout.action(action); };
  const openMenu = (x, y) => setContextMenu({ x: Math.max(10, Math.min(x, viewport.width - 214)), y: Math.max(10, Math.min(y, viewport.height - Math.min(362, viewport.height - 20))) });

  if (!data) return <div className="mini-widget-loading"><Icon /></div>;
  const selectedEvents = data.events.filter((event) => dateKey(new Date(event.time)) === dateKey(selectedDate) && !event.done);
  const total = Math.max(1, sessionTotal);
  const WeatherIcon = weather ? weatherIcon(weather.weather_code) : CloudSun;

  return <main
    className={`mini-widget-root mini-widget-${kind} ${locked ? "widget-locked" : ""} ${layout.busy ? "widget-adjusting" : ""} ${kind === "focus" && viewport.width >= 420 && viewport.width > viewport.height * 1.25 ? "focus-horizontal" : ""} ${data.settings.widget_compatibility_mode !== false ? "widget-compat-mode" : ""}`}
    style={{ "--widget-opacity": data.settings.opacity / 100, "--widget-alpha": `${data.settings.opacity}%`, "--widget-blur": `${data.settings.blur}px` }}
    onContextMenu={(event) => { if (event.target.closest("textarea,input")) return; event.preventDefault(); openMenu(event.clientX, event.clientY); }}
    onClick={() => contextMenu && setContextMenu(null)}
  >
    <header className="mini-widget-header" tabIndex={0} aria-label={locked ? "挂件位置已锁定" : "拖动标题栏移动，方向键微调，Shift 加速"} onKeyDown={layout.keyboard} onPointerDown={(event) => layout.begin(event)} {...layout.pointer}>
      <div className="mini-widget-title"><span className="mini-widget-icon"><Icon /></span><strong>{LABELS[kind]}</strong></div>
      <span className="mini-widget-grip" title={locked ? "位置已锁定" : "拖动挂件"}>{locked ? <LockKeyhole /> : <Grip />}</span>
      {kind === "note" && <button type="button" title="新建备忘录" aria-label="新建备忘录" disabled={noteCreating} onClick={addDesktopNote}><Plus /></button>}
      <button type="button" title="挂件菜单" aria-label="挂件菜单" aria-expanded={Boolean(contextMenu)} onClick={(event) => { event.stopPropagation(); contextMenu ? setContextMenu(null) : openMenu(viewport.width - 214, 48); }}><MoreHorizontal /></button>
      <button title="隐藏挂件" onClick={hideWidget}><X /></button>
    </header>

    {kind === "calendar" && <section className="standalone-calendar">
      <div className="standalone-date"><div><strong>{selectedDate.getDate()}</strong><span>{selectedDate.toLocaleDateString("zh-CN", { weekday: "long" })} · {selectedDate.getMonth() + 1}月</span></div><p title={selectedEvents.map((item) => item.title).join("、")}>{selectedEvents.length ? `${selectedEvents.length} 项安排` : "暂无安排"}</p></div>
      <div className="mini-calendar-toolbar"><strong>{calendar.year} 年 {calendar.index + 1} 月</strong><div><button className="mini-today-button" onClick={() => { setMonth(new Date()); setSelectedDate(new Date()); }}>今日</button><button title="上个月" onClick={() => setMonth(new Date(calendar.year, calendar.index - 1, 1))}><ChevronLeft /></button><button title="下个月" onClick={() => setMonth(new Date(calendar.year, calendar.index + 1, 1))}><ChevronRight /></button></div></div>
      <div className="mini-calendar-week">{"日一二三四五六".split("").map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mini-calendar-grid" style={{ "--calendar-rows": Math.ceil((calendar.blanks + calendar.days) / 7) }}>{Array.from({ length: calendar.blanks }).map((_, index) => <i key={`blank-${index}`} />)}{Array.from({ length: calendar.days }, (_, index) => { const value = new Date(calendar.year, calendar.index, index + 1); const hasEvent = data.events.some((event) => !event.done && dateKey(new Date(event.time)) === dateKey(value)); return <button className={`${dateKey(value) === dateKey(selectedDate) ? "selected" : ""} ${dateKey(value) === dateKey(now) ? "is-today" : ""}`} key={index} title={dateKey(value)} aria-pressed={dateKey(value) === dateKey(selectedDate)} onClick={() => setSelectedDate(value)}>{index + 1}{hasEvent && <em />}</button>; })}</div>
      {viewport.height >= 420 && <div className="mini-calendar-agenda" aria-label="选中日期的安排">{selectedEvents.length ? [...selectedEvents].sort((a, b) => new Date(a.time) - new Date(b.time)).map((event) => <div key={event.id}><time>{new Date(event.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time><span title={event.title}>{event.title}</span></div>) : <span>当天暂无安排</span>}</div>}
    </section>}

    {kind === "note" && <section className="standalone-note">
      <textarea ref={noteTextareaRef} value={note} onChange={(event) => setNote(event.target.value)} placeholder="随手记下灵感、任务或临时信息……" autoFocus />
      <small className={saveState}><span>{saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败" : "保存中"}</span><span>{note.length} 字符</span></small>
    </section>}

    {kind === "focus" && <section className="standalone-focus">
      <div className="standalone-focus-ring" style={{ "--angle": `${seconds / total * 360}deg` }}><div><strong>{pad(Math.floor(seconds / 60))}:{pad(seconds % 60)}</strong><span>{running ? "专注进行中" : seconds === 0 ? "本次完成" : hasSession ? "已暂停" : "准备专注"}</span></div></div>
      <FocusDurationPicker compact minutes={Math.round(total / 60)} disabled={hasSession} onSelect={setDuration} />
      {pomoError && <small className="focus-duration-error" role="alert">{pomoError}</small>}
      <div className="focus-widget-actions"><button className="mini-primary" onClick={startTimer}>{running ? <Pause /> : <Play />}{running ? "暂停" : seconds === 0 ? "再次开始" : hasSession ? "继续" : "开始专注"}</button><button onClick={resetTimer} title="重置专注" aria-label="重置专注"><RotateCcw /></button></div>
    </section>}

    {kind === "weather" && <section className="standalone-weather">
      <div className="weather-main"><span><WeatherIcon /></span><div><strong>{weather ? `${Math.round(weather.temperature_2m)}°` : "--°"}</strong><p title={data.settings.weather_city}>{data.settings.weather_city} · {weather ? "最近天气" : "暂时无法获取"}</p></div></div>
      <div className="weather-details"><span>体感 <strong>{weather ? `${Math.round(weather.apparent_temperature)}°` : "--"}</strong></span><span>风速 <strong>{weather ? `${Math.round(weather.wind_speed_10m)} km/h` : "--"}</strong></span></div>
      <time>{weatherUpdatedAt ? `更新于 ${weatherUpdatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "等待更新"}</time>
    </section>}

    {!locked && ["n", "ne", "e", "se", "s", "sw", "w", "nw"].map((edge) => <div key={edge} className={`widget-resize widget-resize-${edge}`} onPointerDown={(event) => layout.begin(event, edge)} {...layout.pointer} />)}
    {layout.guide && <div className="widget-placement-feedback" aria-hidden="true">{layout.guide.x != null && <i className="widget-guide-x" style={{ left: Math.max(1, Math.min(viewport.width - 2, layout.guide.x)) }} />}{layout.guide.y != null && <i className="widget-guide-y" style={{ top: Math.max(1, Math.min(viewport.height - 2, layout.guide.y)) }} />}<span>{layout.guide.width} × {layout.guide.height}</span></div>}
    {layout.error && <button className="widget-layout-error" role="alert" onClick={layout.clearError}>{layout.error}</button>}
    {contextMenu && <div className="mini-widget-context" role="menu" aria-label="挂件布局" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()}>
      <div className="widget-size-options">{Object.entries(WIDGET_SIZE_LABELS).map(([size, text]) => <button key={size} role="menuitem" disabled={layout.busy} onClick={() => menuAction(size)}>{text}</button>)}</div>
      <button role="menuitemcheckbox" aria-checked={locked} onClick={() => menuAction("lock")}><LockKeyhole />{locked ? "解锁位置" : "锁定位置"}</button>
      <button role="menuitemcheckbox" aria-checked={Boolean(widgetState.always_on_top)} onClick={() => menuAction("top")}><Plus />{widgetState.always_on_top ? "取消始终置顶" : "始终置顶"}</button>
      <button role="menuitem" onClick={() => menuAction("undo")}><RotateCcw />撤销上次移动或缩放</button>
      <button role="menuitem" onClick={() => menuAction("rescue")}><Grip />移回当前屏幕</button>
      <button role="menuitem" onClick={() => menuAction("reset")}><RotateCcw />恢复标准尺寸和位置</button>
      <button onClick={openSettings}><Settings />打开挂件管理</button>
      <button onClick={hideWidget}><X />从桌面隐藏</button>
    </div>}
  </main>;
}

export default MiniWidgetView;
