// Theme switcher. Loaded as a plain blocking script in <head> (no `defer`), so
// the stored theme is applied before first paint (no flash of the wrong theme).

const STORAGE_KEY = "toybeam-theme";
type Theme = "light" | "dark";

// iOS Safari/Chrome throws on localStorage *access* (not just writes) when
// storage is blocked ("Block All Cookies", some private/lockdown contexts). An
// unguarded throw here would abort the script before toggleTheme is defined,
// breaking the button entirely -- so swallow it and fall back to the OS
// preference.
function preferredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

// Set/clear `data-theme` on <html>; CSS keys off it (code colours, disco
// palette, simple.css).
function applyTheme(theme: Theme | null): void {
  if (theme === null) {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = theme;
  }
}

applyTheme(preferredTheme());

// called by the header button's onclick
function toggleTheme(): void {
  const prefersDark = globalThis.matchMedia("(prefers-color-scheme: dark)").matches;
  const effective = preferredTheme() ?? (prefersDark ? "dark" : "light");
  const next: Theme = effective === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage blocked: still switch for this page */
  }
  // Skip the View Transition on the disco page: it would snapshot the
  // full-screen WebGL canvas + animated light layers, a very expensive capture
  // that wrecks Interaction-to-Next-Paint. The disco's own opacity transitions
  // keep the switch smooth without it. Apply directly where the API is missing
  // or throws (older WebKit), so the toggle always works.
  const hasDisco = document.querySelector("#disco-canvas") !== null;
  try {
    if (!hasDisco && "startViewTransition" in document) {
      document.startViewTransition(() => {
        applyTheme(next);
      });
    } else {
      applyTheme(next);
    }
  } catch {
    applyTheme(next);
  }
}
Object.assign(globalThis, { toggleTheme });

// Keep every tab in sync with the stored value: `storage` fires in *other*
// same-origin tabs whenever localStorage changes. `e.key` is null on clear();
// re-read and re-apply (a removed value falls back to the OS).
globalThis.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY || e.key === null) {
    applyTheme(preferredTheme());
  }
});
