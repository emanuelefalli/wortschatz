import { useOnline } from "./hooks";
import { useRoute } from "./router";
import { Browser } from "./screens/Browser";
import { Dashboard } from "./screens/Dashboard";
import { Placement } from "./screens/Placement";
import { Session } from "./screens/Session";
import { SessionSetup } from "./screens/SessionSetup";
import { SettingsScreen } from "./screens/Settings";
import { Stats } from "./screens/Stats";

const TABS: { href: string; name: string; label: string; ico: string }[] = [
  { href: "#/", name: "dashboard", label: "Home", ico: "🏠" },
  { href: "#/setup", name: "setup", label: "Learn", ico: "🎓" },
  { href: "#/browse", name: "browse", label: "Words", ico: "📖" },
  { href: "#/stats", name: "stats", label: "Stats", ico: "📈" },
  { href: "#/settings", name: "settings", label: "Settings", ico: "⚙️" }
];

export function App() {
  const route = useRoute();
  const online = useOnline();
  const inSession = route.name === "session";
  return (
    <div className="app">
      <header className="app-header">
        <a className="brand" href="#/">
          <img className="logo" src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" />
          Wortschatz
        </a>
        {!online && <span className="offline-badge">offline</span>}
      </header>
      {!inSession && (
        <nav className="tabbar" aria-label="Main">
          {TABS.map((t) => (
            <a key={t.name} href={t.href} aria-current={route.name === t.name || (t.name === "setup" && inSession) ? "page" : undefined}>
              <span className="ico" aria-hidden="true">
                {t.ico}
              </span>
              {t.label}
            </a>
          ))}
        </nav>
      )}
      <main className="content">
        {route.name === "dashboard" && <Dashboard />}
        {route.name === "setup" && <SessionSetup />}
        {route.name === "session" && <Session resume={route.resume} preset={route.preset} />}
        {route.name === "browse" && <Browser initialWordId={route.wordId} />}
        {route.name === "stats" && <Stats />}
        {route.name === "placement" && <Placement />}
        {route.name === "settings" && <SettingsScreen />}
      </main>
    </div>
  );
}
