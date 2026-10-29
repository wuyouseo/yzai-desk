import { useEffect, useState } from "react";
import { parsePomoMinutes } from "../lib/pomo";

export default function FocusDurationPicker({ minutes, disabled, onSelect, compact = false }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(String(minutes));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!customOpen) setCustom(String(minutes)); }, [minutes, customOpen]);
  const choose = async (value) => {
    setError("");
    let parsed;
    try { parsed = parsePomoMinutes(value); } catch (reason) { setError(reason.message); return; }
    setPending(true);
    try { if (await onSelect(parsed)) setCustomOpen(false); }
    finally { setPending(false); }
  };
  const isCustom = minutes !== 15 && minutes !== 30;
  return <div className={`focus-duration ${compact ? "focus-duration-compact" : ""}`}>
    <div className="focus-duration-options" role="group" aria-label="专注时长" title={disabled ? "请先重置当前专注，再更改时长" : undefined}>
      {[15, 30].map((value) => <button key={value} type="button" className={minutes === value && !customOpen ? "active" : ""} aria-pressed={minutes === value && !customOpen} disabled={disabled || pending} onClick={() => { setCustomOpen(false); choose(value); }}>{value} 分钟</button>)}
      <button type="button" className={customOpen || isCustom ? "active" : ""} aria-pressed={customOpen || isCustom} disabled={disabled || pending} onClick={() => { setError(""); setCustomOpen(true); }}>自定义</button>
    </div>
    {customOpen && <form className="focus-duration-custom" noValidate onSubmit={(event) => { event.preventDefault(); choose(custom); }}>
      <input type="number" min="1" max="240" step="1" value={custom} aria-label="自定义专注分钟数" onChange={(event) => { setCustom(event.target.value); setError(""); }} disabled={disabled || pending} />
      <span>分钟</span><button type="submit" disabled={disabled || pending}>确定</button>
      <button type="button" disabled={pending} onClick={() => { setCustomOpen(false); setError(""); }}>取消</button>
    </form>}
    {error && <small className="focus-duration-error" role="alert">{error}</small>}
  </div>;
}
