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

/* Keyboard access to horizontally scrolling code blocks (WCAG 2.1.1 Keyboard).
 * A `<pre>` wider than its box can only be scrolled by dragging it, so a
 * keyboard-only user simply cannot read past the right edge. Giving it a tab
 * stop makes the arrow keys scroll it.
 *
 * Only blocks that ACTUALLY overflow get one: an article here can carry 40+ code
 * blocks, and a tab stop on every one would be a worse barrier than the bug.
 * That is a measurement, not something markup can express, so it happens here
 * rather than at build time — and is re-run on resize, since a narrower viewport
 * makes more blocks overflow.
 *
 * Deliberately no `role`: `role="region"` would add dozens of landmarks to a
 * screen reader's landmark menu, and any explicit role overrides <pre>'s own
 * "preformatted text" semantics. A bare tab stop reads the code out normally. */
(function () {
  function markScrollable() {
    var pres = document.getElementsByTagName("pre");
    for (var i = 0; i < pres.length; i++) {
      var el = pres[i];
      // +1 absorbs sub-pixel rounding on fractional zoom levels.
      if (el.scrollWidth > el.clientWidth + 1) {
        el.setAttribute("tabindex", "0");
      } else if (el.getAttribute("tabindex") === "0") {
        el.removeAttribute("tabindex");
      }
    }
  }

  function onReady() {
    markScrollable();
    var pending;
    window.addEventListener("resize", function () {
      clearTimeout(pending);
      pending = setTimeout(markScrollable, 150);
    });
  }

  // This script runs in <head> (un-deferred, to set the theme before paint), so
  // the code blocks do not exist yet.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }
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

