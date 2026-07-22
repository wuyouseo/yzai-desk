import { useEffect, useState } from "react";
import { BellRing, Check, Clock3, Flame } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { callCommand, isTauri, subscribe } from "../lib/deskApi";

function NotificationView() {
  const [notice, setNotice] = useState({ type: "event", message: "该准备下一项安排了" });
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const off = subscribe("trigger-alarm", (payload) => { setNotice(payload); setVisible(true); });
    return () => { off.then((cleanup) => cleanup()); };
  }, []);
  const close = async () => {
    setVisible(false);
    if (isTauri()) await getCurrentWindow().hide().catch(() => {});
  };
  const snooze = async () => {
    await callCommand("snooze_notification", {
      notifType: notice.type,
      message: notice.message,
      minutes: 5,
    });
    await close();
  };
  if (!visible) return null;
  return <main className="notification-root"><span className={`notice-icon ${notice.type === "pomo" ? "pomo" : ""}`}>{notice.type === "pomo" ? <Flame /> : <BellRing />}</span><div><small>{notice.type === "pomo" ? "专注完成" : notice.type === "reminder" ? "提醒事项" : "日程提醒"}</small><strong>{notice.message}</strong><p>现在处理，还是稍后提醒？</p></div><section><button onClick={snooze}><Clock3 />5 分钟后</button><button className="dismiss" onClick={close}><Check />知道了</button></section></main>;
}

export default NotificationView;
