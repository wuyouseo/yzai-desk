import { useEffect, useState } from "react";
import { BellRing, Check, Clock3 } from "lucide-react";
import { callCommand, isTauri, subscribe } from "../lib/deskApi";

function NotificationView() {
  const [notice, setNotice] = useState({ type: "event", message: "该准备下一项安排了" });
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const off = subscribe("trigger-alarm", (payload) => {
      setNotice(payload);
      setClosing(false);
      setVisible(true);
    });
    off.then(() => { if (isTauri()) callCommand("notification_ready").catch(() => {}); });
    return () => { off.then((cleanup) => cleanup()); };
  }, []);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    try {
      if (isTauri()) await callCommand("hide_notification");
      if (!isTauri()) setVisible(false);
    } catch (error) {
      console.error("隐藏提醒窗口失败", error);
      setClosing(false);
    }
  };

  const snooze = async () => {
    if (closing) return;
    setClosing(true);
    try {
      await callCommand("snooze_notification", {
        notifType: notice.type,
        message: notice.message,
        minutes: 5,
      });
      if (isTauri()) await callCommand("hide_notification");
      if (!isTauri()) setVisible(false);
    } catch (error) {
      console.error("稍后提醒设置失败", error);
      setClosing(false);
    }
  };

  if (!visible) return null;

  const isPomo = notice.type === "pomo";
  const title = isPomo ? "番茄时间完成" : notice.type === "reminder" ? "提醒事项" : "日程提醒";

  return (
    <main className="notification-root" role="alertdialog" aria-label={title}>
      <span className={`notice-icon ${isPomo ? "pomo" : ""}`} aria-hidden="true">
        {isPomo ? <span className="tomato-icon">🍅</span> : <BellRing />}
      </span>
      <div className="notice-content">
        <small>{title}</small>
        <strong title={notice.message}>{notice.message}</strong>
        <p>现在处理，还是稍后提醒？</p>
      </div>
      <section>
        <button type="button" onClick={snooze} disabled={closing}><Clock3 />5 分钟后</button>
        <button type="button" className="dismiss" onClick={close} disabled={closing}><Check />知道了</button>
      </section>
    </main>
  );
}

export default NotificationView;
