import { useEffect, useState } from "react";
import "./App.css";
import SettingsDashboard from "./views/SettingsDashboard";
import QuickPanel from "./views/QuickPanel";
import NotificationView from "./views/NotificationView";
import MiniWidgetView from "./views/MiniWidgetView";
import { applyAppearance, loadData, subscribe } from "./lib/deskApi";

function App() {
  const getRoute = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const syncRoute = () => setRoute(getRoute());
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, []);

  useEffect(() => {
    loadData().then((data) => applyAppearance(data.settings));
    const off = subscribe("settings-changed", (settings) => applyAppearance(settings));
    return () => { off.then((cleanup) => cleanup()); };
  }, []);

  if (route.startsWith("mini-widget/")) return <MiniWidgetView kind={route.split("/")[1]} />;
  if (route === "quick-panel") return <QuickPanel />;
  if (route === "notification") return <NotificationView />;
  return <SettingsDashboard />;
}

export default App;
