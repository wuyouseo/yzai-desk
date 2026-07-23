import { useEffect, useRef, useState } from "react";
import { ArrowUp, Command, LoaderCircle, Sparkles, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { askAI, getActiveAIProvider, isTauri, loadData } from "../lib/deskApi";
import brandLogo from "../../logo-1.png";

function QuickPanel() {
  const [settings, setSettings] = useState(null);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const activeProvider = settings ? getActiveAIProvider(settings) : null;

  useEffect(() => { loadData().then((data) => setSettings(data.settings)); inputRef.current?.focus(); }, []);
  useEffect(() => {
    const keydown = (event) => {
      if (event.key === "Escape") {
        if (answer || error) { setAnswer(""); setError(""); }
        else if (isTauri()) getCurrentWindow().hide().catch(() => {});
      }
    };
    window.addEventListener("keydown", keydown); return () => window.removeEventListener("keydown", keydown);
  }, [answer, error]);

  const submit = async (event) => {
    event.preventDefault();
    if (!query.trim() || loading || !settings) return;
    setAnswer(""); setError(""); setLoading(true);
    try { await askAI([{ role: "user", content: query.trim() }], settings, setAnswer); }
    catch (reason) { setError(reason.message); }
    finally { setLoading(false); }
  };

  return <main className={`quick-root ${answer || error ? "expanded" : ""}`}>
    <form onSubmit={submit} className="quick-input"><span className="quick-logo"><img src={brandLogo} alt="" /></span><input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="问点什么，或输入一个想法…" /><kbd><Command size={12} /> K</kbd>{query && <button type="button" onClick={() => { setQuery(""); setAnswer(""); setError(""); inputRef.current?.focus(); }}><X /></button>}<button className="quick-submit" disabled={!query.trim() || loading}>{loading ? <LoaderCircle className="spin" /> : <ArrowUp />}</button></form>
    {(answer || error || loading) && <section className="quick-answer"><div><Sparkles /></div><article>{error ? <p className="quick-error">{error}</p> : answer ? <p>{answer}</p> : <p className="thinking">正在思考<span>…</span></p>}</article></section>}
    <footer><span><kbd>Enter</kbd> 发送</span><span><kbd>Esc</kbd> {answer || error ? "收起回答" : "关闭"}</span><em>{activeProvider ? `${activeProvider.name} · ${activeProvider.model_id || "未配置模型"}` : "AI 服务加载中"}</em></footer>
  </main>;
}

export default QuickPanel;
