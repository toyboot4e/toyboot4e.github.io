/* Theme switcher */
(function() {
  var STORAGE_KEY = "toybeam-theme";

  function getPreferredTheme() {
    // iOS Safari/Chrome throws on localStorage *access* (not just writes) when
    // storage is blocked ("Block All Cookies", some private/lockdown contexts).
    // An unguarded throw here would abort this IIFE before toggleTheme is
    // defined, breaking the button entirely — so swallow it and fall back to
    // the OS preference.
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      return null;
    }
  }

  function applyTheme(theme) {
    // Set/clear `data-theme` on <html>; CSS keys off it (Shiki code colours,
    // disco palette, simple.css). No stylesheet juggling needed -- Shiki's
    // dual-theme colours are inline CSS vars switched by the `[data-theme]`
    // selectors in style.css (the old Prism dark/light <link> toggle is gone).
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  // Apply saved theme immediately (before body renders) to prevent FOUC
  applyTheme(getPreferredTheme());

  // Global toggle function called by button onclick
  window.toggleTheme = function() {
    var current = getPreferredTheme();
    var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var effective = current || (prefersDark ? "dark" : "light");
    var next = effective === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch(e) {}
    // Apply directly if the View Transitions API is missing or throws (older
    // WebKit), so the toggle always works even without the animation.
    // Skip the View Transition on the disco page: it would snapshot the
    // full-screen WebGL canvas + animated light layers, a very expensive capture
    // that wrecks Interaction-to-Next-Paint. The disco's own opacity transitions
    // (and the card/header fades) keep the switch smooth without it.
    var hasDisco = document.getElementById("disco-canvas");
    try {
      if (document.startViewTransition && !hasDisco) {
        document.startViewTransition(function() { applyTheme(next); });
      } else {
        applyTheme(next);
      }
    } catch (e) {
      applyTheme(next);
    }
  };

  // Keep every tab in sync with the stored value. The `storage` event fires in
  // *other* same-origin tabs whenever localStorage changes (toggling here, or an
  // external edit), so the view never drifts from the stored theme. `e.key` is
  // null on clear(); re-read and re-apply (a removed value falls back to the OS).
  window.addEventListener("storage", function(e) {
    if (e.key === STORAGE_KEY || e.key === null) {
      applyTheme(getPreferredTheme());
    }
  });
})();

/* org-mode code ref feature supoprt */

function CodeHighlightOn(elem, id) {
  var target = document.getElementById(id);
  if(target !== null) {
    elem.cacheClassElem = elem.className;
    elem.cacheClassTarget = target.className;
    target.className = "code-highlighted";
    elem.className   = "code-highlighted";
  }
}

function CodeHighlightOff(elem, id) {
  var target = document.getElementById(id);
  if(elem.cacheClassElem) {
    elem.className = elem.cacheClassElem;
  } if(elem.cacheClassTarget) {
    target.className = elem.cacheClassTarget;
  }
}

