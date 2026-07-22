import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudSun,
  Grip,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  Settings,
  TimerReset,
  X,
} from "lucide-react";
import { callCommand, loadData, saveData, subscribe } from "../lib/deskApi";

const pad = (value) => String(value).padStart(2, "0");
const dateKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const LABELS = { calendar: "桌面日历", note: "桌面便签", focus: "番茄时间", weather: "实时天气" };
const ICONS = { calendar: CalendarDays, note: NotebookPen, focus: TimerReset, weather: CloudSun };

function MiniWidgetView({ kind }) {
  const [data, setData] = useState(null);
  const [now, setNow] = useState(new Date());
  const [month, setMonth] = useState(new Date());
  const [weather, setWeather] = useState(null);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [seconds, setSeconds] = useState(25 * 60);
  const [sessionTotal, setSessionTotal] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState !== "hidden");
  const noteReady = useRef(false);
  const Icon = ICONS[kind] || CalendarDays;

  useEffect(() => {
    let cancelled = false;
    loadData().then(async (loaded) => {
      if (cancelled) return;
      setData(loaded);
      document.documentElement.dataset.theme = loaded.settings.theme || "obsidian";
      const quickNote = loaded.notes.find((item) => item.id === "desktop-quick-note");
      setNote(quickNote?.content || "");
      setTimeout(() => { noteReady.current = true; }, 0);

      const defaultSeconds = Number(loaded.settings.pomo_duration || 25) * 60;
      setSeconds(defaultSeconds);
      setSessionTotal(defaultSeconds);
      if (kind === "focus") {
        const activePomo = await callCommand("get_active_pomo");
        if (activePomo && !cancelled) {
          const remaining = activePomo.running
            ? Math.max(0, Math.ceil((new Date(activePomo.target_time).getTime() - Date.now()) / 1000))
            : Number(activePomo.remaining_seconds || 0);
          setSeconds(remaining);
          setSessionTotal(Number(activePomo.duration_mins || loaded.settings.pomo_duration || 25) * 60);
          setRunning(Boolean(activePomo.running && remaining > 0));
        }
      }
    });
    const offPomo = subscribe("pomo-finished", () => { setRunning(false); setSeconds(0); });
    return () => {
      cancelled = true;
      offPomo.then((cleanup) => cleanup());
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
    const clock = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(clock);
  }, [pageVisible]);

  useEffect(() => {
    if (kind !== "weather" || !data || !pageVisible) return undefined;
    let cancelled = false;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${data.settings.weather_lat}&longitude=${data.settings.weather_lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&timezone=auto`)
      .then((response) => response.json())
      .then((result) => { if (!cancelled) setWeather(result.current); })
      .catch(() => { if (!cancelled) setWeather(null); });
    return () => { cancelled = true; };
  }, [data, kind, pageVisible]);

  useEffect(() => {
    if (!running || !pageVisible) return undefined;
    const timer = setInterval(() => setSeconds((value) => value > 0 ? value - 1 : 0), 1_000);
    return () => clearInterval(timer);
  }, [pageVisible, running]);

  useEffect(() => {
    if (kind !== "note" || !noteReady.current) return undefined;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const latest = await loadData();
        const updatedAt = new Date().toISOString();
        const exists = latest.notes.some((item) => item.id === "desktop-quick-note");
        const notes = exists
          ? latest.notes.map((item) => item.id === "desktop-quick-note" ? { ...item, content: note, updated_at: updatedAt } : item)
          : [{ id: "desktop-quick-note", title: "桌面速记", content: note, category: "随记", updated_at: updatedAt, encrypted: false }, ...latest.notes];
        const savedData = await saveData({ ...latest, notes }, ["notes"]);
        setData(savedData);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [kind, note]);

  useEffect(() => { if (seconds === 0) setRunning(false); }, [seconds]);

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
  const startTimer = async () => {
    if (running) {
      const paused = await callCommand("pause_pomo");
      setSeconds(Number(paused?.remaining_seconds ?? seconds));
      setRunning(false);
    } else {
      await callCommand("start_pomo", {
        seconds: Math.max(1, seconds),
        durationMins: Math.max(1, Math.ceil(sessionTotal / 60)),
        label: "桌面专注",
      });
      setRunning(true);
    }
  };
  const resetTimer = async () => {
    const total = Number(data?.settings.pomo_duration || 25) * 60;
    await callCommand("stop_pomo");
    setRunning(false);
    setSeconds(total);
    setSessionTotal(total);
  };
  const startDragging = (event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    callCommand("start_window_drag").catch(() => {});
  };

  if (!data) return <div className="mini-widget-loading"><Icon /></div>;
  const todayEvents = data.events.filter((event) => dateKey(new Date(event.time)) === dateKey(now) && !event.done);
  const total = Math.max(1, sessionTotal);

  return <main
    className={`mini-widget-root mini-widget-${kind} ${data.settings.widget_compatibility_mode !== false ? "widget-compat-mode" : ""}`}
    style={{ "--widget-opacity": data.settings.opacity / 100, "--widget-alpha": `${data.settings.opacity}%`, "--widget-blur": `${data.settings.blur}px` }}
    onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY }); }}
    onClick={() => contextMenu && setContextMenu(null)}
  >
    <header className="mini-widget-header" onPointerDown={startDragging}>
      <span className="mini-widget-grip"><Grip /></span>
      <div><Icon /><strong>{LABELS[kind]}</strong></div>
      <button title="隐藏挂件" onClick={hideWidget}><X /></button>
    </header>

    {kind === "calendar" && <section className="standalone-calendar">
      <div className="standalone-date"><div><strong>{now.getDate()}</strong><span>{now.toLocaleDateString("zh-CN", { weekday: "long" })}</span></div><p>{todayEvents.length ? `今天还有 ${todayEvents.length} 项安排` : "今天暂无待办日程"}</p></div>
      <div className="mini-calendar-toolbar"><strong>{calendar.year} 年 {calendar.index + 1} 月</strong><div><button className="mini-today-button" onClick={() => setMonth(new Date())}>今日</button><button title="上个月" onClick={() => setMonth(new Date(calendar.year, calendar.index - 1, 1))}><ChevronLeft /></button><button title="下个月" onClick={() => setMonth(new Date(calendar.year, calendar.index + 1, 1))}><ChevronRight /></button></div></div>
      <div className="mini-calendar-week">{"日一二三四五六".split("").map((day) => <span key={day}>{day}</span>)}</div>
      <div className="mini-calendar-grid">{Array.from({ length: calendar.blanks }).map((_, index) => <i key={`blank-${index}`} />)}{Array.from({ length: calendar.days }, (_, index) => { const value = new Date(calendar.year, calendar.index, index + 1); const hasEvent = data.events.some((event) => dateKey(new Date(event.time)) === dateKey(value)); return <button className={dateKey(value) === dateKey(now) ? "today" : ""} key={index}>{index + 1}{hasEvent && <em />}</button>; })}</div>
    </section>}

    {kind === "note" && <section className="standalone-note">
      <div><strong>桌面速记</strong><span className={saveState}><Check />{saveState === "saved" ? "已保存" : saveState === "error" ? "保存失败，请重试" : "保存中"}</span></div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="随手记下灵感、任务或临时信息……" autoFocus />
      <small>{note.length} 个字符 · 自动保存在本机</small>
    </section>}

    {kind === "focus" && <section className="standalone-focus">
      <div className="standalone-focus-ring" style={{ "--angle": `${seconds / total * 360}deg` }}><div><strong>{pad(Math.floor(seconds / 60))}:{pad(seconds % 60)}</strong><span>{running ? "专注进行中" : "准备专注"}</span></div></div>
      <p>{todayEvents.length ? `完成专注后，继续处理 ${todayEvents[0].title}` : "给自己一段不被打扰的时间"}</p>
      <div><button className="mini-primary" onClick={startTimer}>{running ? <Pause /> : <Play />}{running ? "暂停" : "开始专注"}</button><button onClick={resetTimer} title="重置"><RotateCcw /></button></div>
    </section>}

    {kind === "weather" && <section className="standalone-weather">
      <div className="weather-main"><span><CloudSun /></span><div><strong>{weather ? `${Math.round(weather.temperature_2m)}°` : "--°"}</strong><p>{data.settings.weather_city} · {weather ? "实时更新" : "暂时无法获取"}</p></div></div>
      <div className="weather-details"><span>体感 <strong>{weather ? `${Math.round(weather.apparent_temperature)}°` : "--"}</strong></span><span>风速 <strong>{weather ? `${Math.round(weather.wind_speed_10m)} km/h` : "--"}</strong></span></div>
      <time>{now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time>
    </section>}

    {contextMenu && <div className="mini-widget-context" style={{ left: Math.min(contextMenu.x, 150), top: Math.min(contextMenu.y, 130) }} onClick={(event) => event.stopPropagation()}>
      <button onClick={openSettings}><Settings />打开挂件管理</button>
      <button onClick={hideWidget}><X />从桌面隐藏</button>
    </div>}
  </main>;
}

export default MiniWidgetView;
