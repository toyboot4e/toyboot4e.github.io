/* Theme switcher */
(function() {
  var STORAGE_KEY = "toybeam-theme";

  function getPreferredTheme() {
    return localStorage.getItem(STORAGE_KEY);
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
  }

  // Apply saved theme immediately (before body renders) to prevent FOUC
  applyTheme(getPreferredTheme());

  // Global toggle function called by button onclick
  window.toggleTheme = function() {
    var current = getPreferredTheme();
    var effective = current || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = effective === "dark" ? "light" : "dark";
    try { localStorage.setItem(STORAGE_KEY, next); } catch(e) {}
    if (document.startViewTransition) {
      document.startViewTransition(function() {
        applyTheme(next);
      });
    } else {
      applyTheme(next);
    }
  };
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

