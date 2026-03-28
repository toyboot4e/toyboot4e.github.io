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

    updateToggleButton(theme);
  }

  function getEffectiveTheme(theme) {
    if (theme) return theme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function updateToggleButton(theme) {
    var btns = document.querySelectorAll("#theme-toggle");
    var effective = getEffectiveTheme(theme);
    var icon = effective === "dark" ? "\u263D" : "\u2600";
    for (var i = 0; i < btns.length; i++) {
      btns[i].textContent = icon;
    }
  }

  // Apply saved theme immediately (before body renders) to prevent FOUC
  var saved = getPreferredTheme();
  applyTheme(saved);

  // Update button once DOM is ready
  document.addEventListener("DOMContentLoaded", function() {
    updateToggleButton(saved);
  });

  // Listen for OS theme changes
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function() {
    if (!getPreferredTheme()) {
      updateToggleButton(null);
    }
  });

  // Global toggle function called by button onclick
  window.toggleTheme = function() {
    var current = getPreferredTheme();
    var effective = getEffectiveTheme(current);
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

function CodeHighlightOn(elem, id)
{
  var target = document.getElementById(id);
  if(null != target) {
    elem.cacheClassElem = elem.className;
    elem.cacheClassTarget = target.className;
    target.className = "code-highlighted";
    elem.className   = "code-highlighted";
  }
}

function CodeHighlightOff(elem, id)
{
  var target = document.getElementById(id);
  if(elem.cacheClassElem)
    elem.className = elem.cacheClassElem;
  if(elem.cacheClassTarget)
    target.className = elem.cacheClassTarget;
}

