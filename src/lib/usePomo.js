import { useCallback, useEffect, useRef, useState } from "react";
import { callCommand, isTauri, loadData, saveData, subscribe } from "./deskApi";
import { parsePomoMinutes, secondsForStart } from "./pomo";

export function usePomo(defaultMinutes, label, enabled = true) {
  const defaultSeconds = Number(defaultMinutes || 15) * 60;
  const [seconds, setSeconds] = useState(defaultSeconds);
  const [total, setTotal] = useState(defaultSeconds);
  const [running, setRunning] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [error, setError] = useState("");
  const target = useRef(null);
  const activeSession = useRef(false);
  const applySession = useCallback((session) => {
    if (!session) { target.current = null; activeSession.current = false; setRunning(false); setHasSession(false); setSeconds(defaultSeconds); setTotal(defaultSeconds); return; }
    activeSession.current = true;
    setHasSession(true);
    const end = session.running ? Date.parse(session.target_time) : null;
    target.current = Number.isFinite(end) ? end : null;
    setSeconds(session.running && target.current ? Math.max(0, Math.ceil((target.current - Date.now()) / 1000)) : Number(session.remaining_seconds || 0));
    setTotal(Number(session.duration_mins || defaultMinutes || 15) * 60);
    setRunning(Boolean(session.running && target.current && target.current > Date.now()));
  }, [defaultMinutes, defaultSeconds]);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const refresh = () => {
      if (isTauri()) callCommand("get_active_pomo").then((session) => { if (alive) applySession(session); }).catch(() => {});
      else if (!activeSession.current) applySession(null);
    };
    refresh();
    const off = subscribe("pomo-changed", applySession);
    const finished = subscribe("pomo-finished", () => { target.current = null; activeSession.current = false; setRunning(false); setHasSession(false); setSeconds(0); });
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => { alive = false; document.removeEventListener("visibilitychange", visible); off.then((f) => f()); finished.then((f) => f()); };
  }, [applySession, enabled]);
  useEffect(() => {
    if (!enabled || !running) return undefined;
    const tick = () => { if (target.current) { const left = Math.max(0, Math.ceil((target.current - Date.now()) / 1000)); setSeconds(left); if (!left) setRunning(false); } };
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [enabled, running]);
  const perform = async (action) => {
    try { setError(""); return await action(); }
    catch (reason) { setError(String(reason?.message || reason)); return false; }
  };
  const setDuration = (value) => perform(async () => {
    const minutes = parsePomoMinutes(value);
    if (hasSession) throw new Error("请先重置当前专注，再更改时长");
    if (isTauri()) await callCommand("set_pomo_duration", { minutes });
    else {
      const latest = await loadData();
      await saveData({ ...latest, settings: { ...latest.settings, pomo_duration: minutes } }, ["settings"], latest);
    }
    target.current = null;
    setSeconds(minutes * 60);
    setTotal(minutes * 60);
    return true;
  });
  const start = () => perform(async () => {
    const duration = Math.max(1, Math.ceil(total / 60));
    const startSeconds = secondsForStart(seconds, total);
    const session = await callCommand("start_pomo", { seconds: startSeconds, durationMins: duration, label });
    applySession(session || { running: true, target_time: new Date(Date.now() + startSeconds * 1000).toISOString(), duration_mins: duration });
    return true;
  });
  const pause = () => perform(async () => {
    const session = await callCommand("pause_pomo");
    applySession(session || { running: false, remaining_seconds: seconds, duration_mins: total / 60 });
    return true;
  });
  const reset = () => perform(async () => { await callCommand("stop_pomo"); applySession(null); return true; });
  return { seconds, total, running, hasSession, error, setDuration, start, pause, reset };
}
