import { useEffect, useState } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "setup" }
  | { name: "session"; resume?: boolean; preset?: "weak" }
  | { name: "browse"; wordId?: string }
  | { name: "stats" }
  | { name: "placement" }
  | { name: "settings" };

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const [path, query] = h.split("?");
  const params = new URLSearchParams(query ?? "");
  switch (path) {
    case "setup":
      return { name: "setup" };
    case "session":
      return { name: "session", resume: params.get("resume") === "1", preset: params.get("preset") === "weak" ? "weak" : undefined };
    case "browse":
      return { name: "browse", wordId: params.get("word") ?? undefined };
    case "stats":
      return { name: "stats" };
    case "placement":
      return { name: "placement" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "dashboard" };
  }
}

export function navigate(path: string) {
  window.location.hash = path.startsWith("#") ? path : `#/${path.replace(/^\//, "")}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
