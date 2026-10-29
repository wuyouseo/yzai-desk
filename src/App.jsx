import { useEffect, useState } from "react";
import "./App.css";
import SettingsDashboard from "./views/SettingsDashboard";
import QuickPanel from "./views/QuickPanel";
import NotificationView from "./views/NotificationView";
import MiniWidgetView from "./views/MiniWidgetView";
import { applyAppearance, loadData, subscribe } from "./lib/deskApi";
import "./Widget.css";

function App() {
  const getRoute = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const syncRoute = () => setRoute(getRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    let currentSettings = null;
    let resizeFrame = 0;
    const syncAppearance = (settings) => {
      currentSettings = settings;
      applyAppearance(settings);
    };
    loadData().then((data) => syncAppearance(data.settings)).catch((error) => console.error("无法读取外观设置", error));
    const off = subscribe("settings-changed", syncAppearance);
    const handleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        if (currentSettings) applyAppearance(currentSettings);
      });
    };
    const systemTheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    const handleSystemTheme = () => { if (currentSettings?.theme === "system") applyAppearance(currentSettings); };
    systemTheme?.addEventListener("change", handleSystemTheme);
    window.addEventListener("resize", handleResize);
    return () => {
      systemTheme?.removeEventListener("change", handleSystemTheme);
      window.removeEventListener("resize", handleResize);
      window.cancelAnimationFrame(resizeFrame);
      off.then((cleanup) => cleanup());
    };
  }, []);

  if (route.startsWith("mini-widget/")) return <MiniWidgetView kind={route.split("/")[1]} />;
  if (route === "quick-panel") return <QuickPanel />;
  if (route === "notification") return <NotificationView />;
  return <SettingsDashboard />;
}

export default App;
