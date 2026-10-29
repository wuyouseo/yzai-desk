import { useEffect, useRef, useState } from "react";
import { callCommand, isTauri } from "./deskApi";

export const WIDGET_SIZE_LABELS = { small: "紧凑", medium: "标准", large: "展开" };

export function useWidgetLayout(kind, locked) {
  const [guide, setGuide] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const gesture = useRef(null);
  const frame = useRef(0);
  const inFlight = useRef(null);
  const startPromise = useRef(null);
  const report = (reason) => setError(String(reason?.message || reason));
  const finish = async (cancel = false) => {
    const state = gesture.current;
    if (!state || state.ending) return;
    state.ending = true; cancelAnimationFrame(frame.current);
    try {
      await startPromise.current; await inFlight.current;
      if (!cancel) await callCommand("update_widget_gesture");
      await callCommand("end_widget_gesture", { cancel });
    } catch (reason) {
      report(reason);
      await callCommand("end_widget_gesture", { cancel: true }).catch(() => {});
    } finally { gesture.current = null; setGuide(null); setBusy(false); }
  };
  const begin = (event, mode = "move") => {
    if (event.button !== 0 || locked || gesture.current || event.target.closest("button, input, textarea, select")) return;
    if (!isTauri()) return;
    event.preventDefault(); setError("");
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { ending: false }; setBusy(true);
    startPromise.current = callCommand("begin_widget_gesture", { mode, grabX: event.clientX, grabY: event.clientY });
    startPromise.current.catch(report);
  };
  const move = () => {
    if (!gesture.current || gesture.current.ending || inFlight.current) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (!gesture.current || gesture.current.ending) return;
      inFlight.current = (async () => {
        try { await startPromise.current; const next = await callCommand("update_widget_gesture"); if (gesture.current && !gesture.current.ending) setGuide(next); }
        catch (reason) { report(reason); }
        finally { inFlight.current = null; }
      })();
    });
  };
  useEffect(() => {
    const key = (event) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); finish(true); } };
    const blur = () => { if (gesture.current) finish(false); };
    window.addEventListener("keydown", key); window.addEventListener("blur", blur);
    return () => { cancelAnimationFrame(frame.current); if (gesture.current) callCommand("end_widget_gesture", { cancel: true }).catch(() => {}); window.removeEventListener("keydown", key); window.removeEventListener("blur", blur); };
  }, []);
  const action = async (value) => {
    if (busy) return;
    if (!isTauri()) { setError("请在桌面版中调整挂件布局"); return; }
    setBusy(true); setError("");
    try { await callCommand("widget_action", { kind, action: value }); }
    catch (reason) { report(reason); }
    finally { setBusy(false); }
  };
  const keyboard = (event) => {
    if (locked || event.target !== event.currentTarget) return;
    const direction = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" }[event.key];
    if (direction) { event.preventDefault(); action(`${direction}${event.shiftKey ? "-fast" : ""}`); }
  };
  return { guide, error, clearError: () => setError(""), busy, action, keyboard, begin, pointer: { onPointerMove: move, onPointerUp: () => finish(), onPointerCancel: () => finish(true), onLostPointerCapture: () => finish() } };
}
