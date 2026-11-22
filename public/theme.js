(() => {
  "use strict";

  const KEY = "tenrai-theme";
  const root = document.documentElement;

  function stored() {
    try {
      return localStorage.getItem(KEY) === "light";
    } catch {
      return false;
    }
  }

  function remember(light) {
    try {
      if (light) localStorage.setItem(KEY, "light");
      else localStorage.removeItem(KEY);
    } catch {
      return;
    }
  }

  function show(light) {
    if (light) root.dataset.theme = "light";
    else delete root.dataset.theme;
    document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", light ? "light" : "dark");
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", light ? "#ffffff" : "#000000");
    for (const control of document.querySelectorAll("[data-theme-toggle]")) {
      if (control instanceof HTMLInputElement) control.checked = light;
      else control.setAttribute("aria-pressed", String(light));
    }
  }

  function change(light) {
    show(light);
    window.dispatchEvent(new CustomEvent("tenrai:theme", { detail: { light } }));
  }

  show(stored());
  document.addEventListener("DOMContentLoaded", () => show(root.dataset.theme === "light"));
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest("[data-theme-toggle]")) return;
    const light = root.dataset.theme !== "light";
    remember(light);
    change(light);
  });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY) change(stored());
  });
})();
