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
    if (theme) {
      document.documentElement.setAttribute("data-theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }

    // Update Prism.js stylesheets
    var dark = document.getElementById("prism-dark");
    var light = document.getElementById("prism-light");
    if (dark && light) {
      if (theme === "dark") {
        dark.media = "all";
        light.media = "not all";
      } else if (theme === "light") {
        dark.media = "not all";
        light.media = "all";
      } else {
        dark.media = "(prefers-color-scheme: dark)";
        light.media = "(prefers-color-scheme: light)";
      }
    }

    // iOS Safari can leave the page background — the body background propagated to
    // the viewport, behind the fixed disco canvas's compositing layer —
    // unrepainted when the theme changes only via CSS variables; the transparent
    // light-theme canvas then shows the stale colour. Force a repaint by
    // re-asserting body's background for a frame. (Nudge body, not html: an html
    // background would stop the propagation and the opaque body box would paint
    // over the canvas, hiding the ball.)
    if (document.body) {
      try {
        document.body.style.backgroundColor = getComputedStyle(document.body).backgroundColor;
        requestAnimationFrame(function () {
          document.body.style.backgroundColor = "";
        });
      } catch (e) {}
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

