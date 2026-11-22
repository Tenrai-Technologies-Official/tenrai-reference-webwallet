import { useEffect, useState } from "react";

const isLight = () => document.documentElement.dataset.theme === "light";

/** The button for the light design; public/theme.js switches the page and remembers the choice. */
export function ThemeToggle() {
  const [light, setLight] = useState(isLight);
  useEffect(() => {
    const follow = () => setLight(isLight());
    window.addEventListener("tenrai:theme", follow);
    return () => window.removeEventListener("tenrai:theme", follow);
  }, []);
  return (
    <button type="button" className="theme-toggle" data-theme-toggle aria-pressed={light} aria-label="Light design" title="Light design">
      <svg className="theme-toggle__moon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.6A8.2 8.2 0 0 1 9.4 4 8.2 8.2 0 1 0 20 14.6Z" />
      </svg>
      <svg className="theme-toggle__sun" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
      </svg>
    </button>
  );
}
