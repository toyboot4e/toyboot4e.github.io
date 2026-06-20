;; Build script
;;
;; Note that this source file is a mess.

;; TODO: Custom admonition filter

(setq make-backup-files nil)

(setq my-base-backend 'slimhtml)
;; (setq my-base-backend 'html)

;;; Preferences

(progn
  ;; Prefer hardbreaks
  (setq org-export-preserve-breaks t)

  ;; TODO: Evaluate code blocks with babel on export

  ;; TODO: prevent `org-export` from converting whitespaces to tabs
  (setq org-src-preserve-indentation t))

;;; Setup

(progn
  ;; The hermetic nix build provides `esxml'/`seq' on `load-path' via
  ;; `emacs.pkgs.withPackages', so the whole package.el bootstrap — including the
  ;; offline-fatal `package-refresh-contents' — is dead weight there (and runs in
  ;; every worker subprocess). Only fall back to package.el + the local
  ;; `.blog-build-packages' when `esxml' isn't already available (plain local
  ;; dev without nix).
  (unless (require 'esxml nil t)
    (require 'package)
    (setq package-user-dir (expand-file-name "./.blog-build-packages"))
    (setq package-archives '(("melpa" . "https://melpa.org/packages/")
                             ("elpa" . "https://elpa.gnu.org/packages/")))
    (package-initialize)
    (unless package-archive-contents
      (package-refresh-contents))
    (package-install 'esxml)
    (require 'esxml)))

(progn
  ;; `seq-*' functions
  (require 'seq)

  ;; Local package downloaded from: `https://github.com/balddotcat/ox-slimhtml'
  (add-to-list 'load-path (expand-file-name default-directory))
  (require 'ox-slimhtml)

  ;; Use `<br>' rather than `<br />'.
  (setq org-html-doctype "html5")

  ;; Prefer `<figure>' tag to <div>', etc.
  (setq org-html-html5-fancy t)

  (require 'ox-publish)

  ;; Store timestamps within this repository, not in global:
  (setq org-publish-timestamp-directory "./.org-timestamps/"))

;;; Ingredients

;; Creates final output
(defun my-sxml-to-xml (sxml)
  ;; NOTE: `pp' formats `<code>' tag contents, too.
  ;; (pp-esxml-to-xml (sxml-to-esxml sxml))
  ;; So I use `exml-to-xml' and run `tidy' after build.
  (esxml-to-xml (sxml-to-esxml sxml)))

;; Thanks: `http://sachachua.com/notebook/emacs/small-functions.el'
(defun my-strip-html (string)
  ;; suppress messages:
  (cl-letf (((symbol-function 'message) #'ignore))
    (with-temp-buffer
      (insert string)

      (widen)
      (goto-char (point-min))
      (while (re-search-forward "<[^<]*>" (point-max) t)
        (replace-match "\\1"))
      (goto-char (point-min))
      (replace-string "&copy;" "(c)")
      (goto-char (point-min))
      (replace-string "&amp;" "&")
      (goto-char (point-min))
      (replace-string "&lt;" "<")
      (goto-char (point-min))
      (replace-string "&gt;" ">")
      (goto-char (point-min))

      (buffer-substring-no-properties (point-min) (point-max)))))

;;; Project settings

;; Attributes for `org-publish-project-alist' below.
;; See also: `https://orgmode.org/org.html#Publishing-options'
(setq base-attrs
      ;; backquote and splice operator ,@: `https://www.gnu.org/software/emacs/manual/html_node/elisp/Backquote.html'
      `(
        :base-extension "org"
        ;; The default build is now uniorg/bun (`just build' -> `./out', what the
        ;; deploy ships). This Emacs path is the reference renderer, run via `just
        ;; build-emacs' which sets `$OUT_DIR' to `./out-emacs' so it never clobbers
        ;; the deployed output. Default to `./out-emacs' for the same reason.
        :publishing-directory ,(or (getenv "OUT_DIR") "./out-emacs")
        ;; :recursive t
        ;; Custom function defined below
        :publishing-function my-org-html-publish-to-html
        :section-numbers nil
        :with-author nil
        :with-creator nil
        :with-toc nil
        ;; Prefer manual `index.html' generation:
        :auto-sitemap nil))

(setq org-publish-project-alist
      `(
        ;; build targets:
        ("release" :components ("static" "release-posts"))
        ("draft" :components ("static" "release-posts"))

        ;; components:
        ("release-posts" ,@base-attrs
         :base-directory "./src/"
         :recursive t
         ;; :include ,(mapcar (lambda (x) (concat "./src/" x)) (directory-files "./src" nil "\\.org$"))
         )

        ("static"
         :base-directory "./src"
         :base-extension "html\\|js\\|css\\|png\\|jpg\\|jpeg\\|webp\\|gif\\|svg\\|mp4\\|mov\\|woff2\\|pdf"
         ;; `/ltximg/' holds local LaTeX previews:
         :exclude ,(rx-to-string (rx "ltximg/"))
         ;; :exclude ,(rx-to-string (rx line-start "ltximg"))
         :publishing-directory ,(or (getenv "OUT_DIR") "./out")
         :recursive t
         :publishing-function org-publish-attachment)))

;;; Style

;; Add link to each heading
(setq org-html-self-link-headlines t)

;; No need of code highlight
(setq org-html-htmlize-output-type 'nil)

;;; Backend (HTML template)

(defvar my-codeblock-counter 0
  "Identifies coderefs in different code blocks.")

(defconst my-eager-image-count 1
  "How many leading thumbnails on a listing page to load eagerly (those above
the fold). The first of them is the LCP image and also gets fetchpriority=high.")

(defvar my-eager-image-budget 0
  "Remaining eager thumbnails to emit on the current listing page; counts down
from `my-eager-image-count' as cards render.")

(defconst my-site-url "https://toyboot4e.github.io/"
  "Canonical site root, used to build absolute URLs for OGP tags.")

(defconst my-default-description "Devlog of toyboot4e"
  "Fallback `og:description' when an article has none.")

;; e.g. `./img/x' or `/img/x' -> `img/x'
(defun my-clean-relative-path (path)
  (replace-regexp-in-string "\\`\\(?:\\./\\|/\\)+" "" (string-trim path)))

;; Turn a possibly-relative path into an absolute URL under `my-site-url'.
;; `http(s)' URLs are returned as-is; `nil' stays `nil'.
(defun my-absolute-url (path)
  (cond
   ((or (null path) (string-empty-p (string-trim path))) nil)
   ((string-match-p "\\`https?://" path) path)
   (t (concat my-site-url (my-clean-relative-path path)))))

;; Like `my-absolute-url' but produces a root-relative URL (e.g. `/img/x.png'),
;; suitable for inline `<img src>' in the top page.
(defun my-thumbnail-src (path)
  (cond
   ((or (null path) (string-empty-p (string-trim path))) nil)
   ((string-match-p "\\`https?://" path) path)
   (t (concat "/" (my-clean-relative-path path)))))

;; Best-effort `og:description': explicit `#+DESCRIPTION:', else the opening
;; text of the article body, else the site default.
(defun my-og-description (info contents)
  (let ((desc (plist-get info :description)))
    (if (org-string-nw-p (and desc (org-export-data desc info)))
        (string-trim (my-strip-html (org-export-data desc info)))
      (let* ((text (string-trim
                    (replace-regexp-in-string
                     "[ \t\n\r]+" " " (my-strip-html (or contents "")))))
             (max-len 140))
        (cond
         ((string-empty-p text) my-default-description)
         ((> (length text) max-len) (concat (substring text 0 max-len) "…"))
         (t text))))))

;; The disco ball ships site-wide (see CONTEXT.md / ADR 0003): the `<canvas>',
;; `disco.min.js', and the toggle button are emitted on every page. It runs by
;; default (the toggle persists an off preference across pages), is GPU-gated,
;; and is dark/light aware.
(defun my-disco-page-p (info)
  "Non-nil when the page should carry the disco ball (every page)."
  (ignore info)
  t)

(defun my-home-page-p (info)
  "Non-nil when the page being exported is the homepage (`index.html')."
  (let ((rel (replace-regexp-in-string
              "\\.org\\'" ".html"
              (file-relative-name (plist-get info :input-file) default-directory))))
    (string= rel "index.html")))

(defun my-listing-page-p (info)
  "Non-nil for card-listing pages: the homepage and the tag pages. They share the
homepage's `home' styling (translucent cards, heading chips) rather than the
long-form article backdrop, so both carry the `home' class."
  (or (my-home-page-p info)
      (let ((input (plist-get info :input-file)))
        (and input (string-match-p "\\(^\\|/\\)tags/[^/]*\\.org\\'" input)))))

;; Returns `<head>' SXML
(defun my-html-head (info contents)
  ;; Reset `my-codeblock-counter' on new file. TODO: move it to more appropriate place
  (setq my-codeblock-counter 0)
  (let* (;; NOTE: `org-export-data' returns HTML, so we'll remove HTML tags
         ;; TODO: (substring-no-properties (or (plist-get info :title) "")) may make more sense, but org-mode inline syntax must be removed
         (title (or (my-strip-html (org-export-data (plist-get info :title) info)) ""))
         (relative-path
          (replace-regexp-in-string "\\.org\\'" ".html"
                                    (file-relative-name
                                     (plist-get info :input-file)
                                     default-directory)))
         ;; OGP / Twitter card metadata, shared by `<meta>' tags below.
         (description (my-og-description info contents))
         (page-url (concat my-site-url relative-path))
         (image (my-absolute-url (plist-get info :thumbnail)))
         ;; Big image preview when a thumbnail exists, plain summary otherwise.
         (twitter-card (if image "summary_large_image" "summary"))
         ;; Only pull in MathJax (~250 KiB) when the body actually contains math.
         ;; Org exports inline/display math as `\(...\)' / `\[...\]' and keeps
         ;; LaTeX environments as `\begin{...}'. A stray match in a code block just
         ;; loads MathJax needlessly, so we err toward loading it.
         (has-math (and contents
                        (string-match-p (regexp-opt '("\\(" "\\[" "\\begin{")) contents)))
         ;; Only pull in Prism (~580 KiB JS + its CSS) on pages that actually
         ;; contain a highlightable code block. Code exports as
         ;; `<code class="... language-XXX">' (see `roygbyte/org-html-src-block').
         (has-code (and contents (string-match-p "language-" contents)))
         ;; Only ship `steno-viz.js' on pages that actually embed a steno chord
         ;; chart. `#+BEGIN_STENO' exports as `<steno-outline ...>' (see
         ;; `my-org-html-steno-block'); the vast majority of pages have none.
         (has-steno (and contents (string-match-p "<steno-outline" contents))))
    ;; NOTE: `esxml-html' is not on MELPA
    `(head
      (meta (@ (charset "utf-8")))
      ;; (meta (@ (author "toyboot4e")))
      (meta (@ (name "viewport")
               (content "width=device-width, initial-scale=1")))
      (title (*RAW-STRING* ,(concat title " - Toybeam")))
      (meta (@ (name "description")
               (content ,description)))
      ;; Inline SVG favicon (\U0001F526):
      (link (@ (rel "icon")
               (href "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>\U0001F526</text></svg>")))
      ;; (link (@ (rel "stylesheet")
      ;;          (href "https://cdn.simplecss.org/simple.min.css")))
      (link (@ (rel "stylesheet")
               (href "/style/simple.min.css")))
      (link (@ (rel "stylesheet")
               (href "/style/style.min.css")))
      ,@(when has-code
          `((link (@ (rel "stylesheet")
                     (id "prism-dark")
                     (href "/style/prism-dark.min.css")
                     (media "(prefers-color-scheme: dark)")))
            (link (@ (rel "stylesheet")
                     (id "prism-light")
                     (href "/style/prism-light.min.css")
                     (media "(prefers-color-scheme: light)")))))
      ;; KaTeX CSS for build-time pre-rendered math (see `scripts/postprocess.ts').
      ,@(when has-math
          `((link (@ (rel "stylesheet")
                     (href "/style/katex/katex.min.css")))))
      (script (@ (type "text/javascript")
                 (src "/style/style.js"))
              ;; NOTE: empty body is required for self-closing tag
              "")
      ;; Disco ball (`<canvas>' is emitted in the body). An inline script adds
      ;; `disco-on' before first paint (from the persisted preference) so the
      ;; disco-mode content styling doesn't flash in when the deferred script runs
      ;; on each navigation; `disco.min.js' (deferred, needs the canvas) then
      ;; renders, dropping it on no-GPU. See `docs/adr/0003-homepage-disco-ball-webgl.md'.
      ,@(when (my-disco-page-p info)
          `((script (*RAW-STRING*
                     "try{if(localStorage.getItem('toybeam-disco')!=='off')document.documentElement.classList.add('disco-on')}catch(e){}"))
            (script (@ (type "text/javascript")
                       (defer "")
                       (src "/style/disco.min.js"))
                    "")))
      ;; NOTE: Prism highlighting is baked in at build time (`scripts/postprocess.ts').
      ;; Only loaded on pages that actually embed a `<steno-outline>' chart.
      ,@(when has-steno
          `((script (@ (type "text/javascript")
                       (async "")
                       (src "/style/steno-viz.js"))
                    "")))
      ;; NOTE: math is pre-rendered to static KaTeX HTML at build time
      ;; (`scripts/postprocess.ts'); only `katex.min.css' (linked above) is shipped.
      ;; Open Graph protocol: <https://ogp.me/>
      (meta (@ (property "og:type")
               (content "article")))
      (meta (@ (property "og:title")
               (content ,title)))
      (meta (@ (property "og:description")
               (content ,description)))
      (meta (@ (property "og:url")
               (content ,page-url)))
      (meta (@ (property "og:site_name")
               (content "Toybeam")))
      (meta (@ (property "og:locale")
               (content "ja_JP")))
      ;; `og:image' is only present when the article sets `#+THUMBNAIL:'.
      ,@(when image
          `((meta (@ (property "og:image")
                     (content ,image)))))
      ;; Twitter / X card. Falls back to `og:*' for title/description/image.
      (meta (@ (name "twitter:card")
               (content ,twitter-card)))
      (meta (@ (name "twitter:creator")
               (content "@toyboot4e")))
      (meta (@ (name "twitter:site")
               (content "@toyboot4e")))
      ,@(when image
          `((meta (@ (name "twitter:image")
                     (content ,image)))))
      )))

(defun create-tag-list-in-header (tags)
  `(p (@ (class "org-tag-list"))
    ,@(mapcar #'create-tag-sxml tags)))

;;; Header nav icons
;; Inline SVG, baked into the page (the build is offline/hermetic and ships no
;; icon font or runtime JS). All use `currentColor' so they inherit the link
;; colour and the accent colour on hover, in both themes.
;;
;; All marks are Lucide (https://lucide.dev, ISC, stroked paths). We avoid the
;; real GitHub/Qiita/Zenn brand logos on purpose: their brand guidelines forbid
;; recolouring, and we tint every icon with `currentColor' + hover accent. So
;; the external links use generic semantic stand-ins instead (the text label
;; carries the brand name): code repo -> git-branch, articles -> newspaper,
;; books -> book-open.

;; Lucide marks (inner <path>s, stroked)
(defconst my-icon-github
  "<path d=\"M15 6a9 9 0 0 0-9 9V3\"/><circle cx=\"18\" cy=\"6\" r=\"3\"/><circle cx=\"6\" cy=\"18\" r=\"3\"/>")
(defconst my-icon-qiita
  "<path d=\"M15 18h-5\"/><path d=\"M18 14h-8\"/><path d=\"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2\"/><rect width=\"8\" height=\"4\" x=\"10\" y=\"6\" rx=\"1\"/>")
(defconst my-icon-zenn
  "<path d=\"M12 7v14\"/><path d=\"M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z\"/>")
(defconst my-icon-home
  "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\"/><path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/>")
(defconst my-icon-atcoder
  "<path d=\"M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978\"/><path d=\"M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978\"/><path d=\"M18 9h1.5a1 1 0 0 0 0-5H18\"/><path d=\"M4 22h16\"/><path d=\"M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z\"/><path d=\"M6 9H4.5a1 1 0 0 1 0-5H6\"/>")

(defun my-line-icon (paths)
  "Wrap Lucide PATHS in a stroked inline <svg>."
  (concat "<svg class=\"nav-icon\" viewBox=\"0 0 24 24\" width=\"1em\" height=\"1em\""
          " fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\""
          " stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">"
          paths "</svg>"))

(defun my-nav-link (href svg label)
  "A header nav link: inline SVG icon followed by a text LABEL."
  `(a (@ (href ,href))
      (*RAW-STRING* ,svg)
      (span (@ (class "nav-label")) ,label)))

;; Returns the sticky `<header>' SXML \u2014 only the navigation link icons.
(defun my-html-header (info)
  `(header (@ (role "banner"))
           (nav (@ (role "navigation"))
                ,(my-nav-link "/index.html" (my-line-icon my-icon-home) "Home")
                ,(my-nav-link "https://atcoder.jp/users/toyboot4e" (my-line-icon my-icon-atcoder) "AtCoder")
                ,(my-nav-link "https://github.com/toyboot4e" (my-line-icon my-icon-github) "GitHub")
                ,(my-nav-link "https://qiita.com/toyboot4e" (my-line-icon my-icon-qiita) "Qiita")
                ,(my-nav-link "https://zenn.dev/toyboot4e" (my-line-icon my-icon-zenn) "Zenn")
                (button (@ (id "theme-toggle")
                           (onclick "toggleTheme()")
                           (title "\u30c6\u30fc\u30de\u5207\u66ff")
                           (aria-label "Toggle theme"))
                        "")
                ;; Disco-ball on/off, homepage only (the ball lives there). Shown
                ;; only in dark theme via CSS; `toggleDisco' is defined in disco.ts.
                ,@(when (my-disco-page-p info)
                    `((button (@ (id "disco-toggle")
                                 (onclick "window.toggleDisco && toggleDisco()")
                                 (aria-pressed "true")
                                 (title "\u30c7\u30a3\u30b9\u30b3\u30dc\u30fc\u30eb\u5207\u66ff")
                                 (aria-label "Toggle disco ball"))
                              ""))))))

;; Returns the page title block, shown below the sticky header rather than
;; inside it: a title, then a single meta row of date + tags.
(defun my-html-title-block (info)
  (let ((tags (or (plist-get info :filetags) '())))
    `(div (@ (class "title-block"))
          ;; `org-export-data' returns raw HTML
          (h1 (*RAW-STRING* ,(org-export-data (plist-get info :title) info)))
          ;; meta row: date then tags, on one line
          (div (@ (class "title-meta"))
               (span (@ (class "title-date"))
                     ,(org-export-data (org-export-get-date info "%b %e, %Y") info))
               ,(unless (null tags)
                  (create-tag-list-in-header tags))))))

;; Returns `<footer>' SXML
(defun my-html-footer (info)
  `(footer (@ (role "contentinfo"))
           (*RAW-STRING* "<p>Styled with <a href=\"https://simplecss.org/\">Simple.css</a></p>")
           (div
            ,(my-nav-link "/index.html" (my-line-icon my-icon-home) "Home")
            ,(my-nav-link "https://github.com/toyboot4e" (my-line-icon my-icon-github) "GitHub"))))

;; Thanks: `https://github.com/SystemCrafters/systemcrafters.github.io/blob/master/publish.el'
(defun my-org-html-template (contents info)
  (concat
   "<!DOCTYPE html>\n"
   (my-sxml-to-xml
    `(html (@ (lang "ja")
              ;; `home' marks the card-listing pages (homepage + tag pages) so
              ;; disco-mode CSS gives them the card/heading styling, while
              ;; long-form article pages get the content backdrop instead.
              ,@(when (my-listing-page-p info) '((class "home"))))
           ,(my-html-head info contents)

           (body
            ;; Homepage disco ball: a fixed full-viewport WebGL background,
            ;; behind all content. Only rendered in dark theme (see disco.ts).
            ;; `.disco-bg-light' is the cheap CSS drifting-light layer used on the
            ;; static fallback (weak GPU / reduced motion); idle otherwise.
            ,@(when (my-disco-page-p info)
                `((div (@ (class "disco-bg-light") (aria-hidden "true")) "")
                  (canvas (@ (id "disco-canvas") (aria-hidden "true")) "")))
            ,(my-html-header info)
            (main (@ (role "main")
                     (id "main"))
                  ,(my-html-title-block info)
                  ;; TODO: <article> without style
                  (div (@ (id "content"))
                       (*RAW-STRING* ,contents))
                  (nav (@ (id "toc"))))
            ,(my-html-footer info)
            (script (@ (type "text/javascript")
                       (src "/style/tocbot.min.js"))
                    "")
            (script (*RAW-STRING*
                     "tocbot.init({ tocSelector: '#toc', contentSelector: '#content', headingSelector: 'h1, h2, h3, h4', collapseDepth: 6, scrollSmooth: false, orderedList: false });")
                    ))))))

;;; Backend (filters)

;; Codeblock filter for `prism.js' support:
;; `https://www.roygbyte.com/add_syntax_highlighting_to_an_org_publish_project.html'
(defun roygbyte/org-html-src-block (src-block _contents info)
  "Transcode a SRC-BLOCK element from Org to HTML.
  CONTENTS holds the contents of the item.  INFO is a plist holding
  contextual information."
  ;; NOTE(toyboot): increment code block count for unique coderef IDs.
  (setq my-codeblock-counter (+ 1 my-codeblock-counter))
  (if (org-export-read-attribute :attr_html src-block :textarea)
      (org-html--textarea-block src-block)
    (let* ((lang (org-element-property :language src-block))
           (code (org-html-format-code src-block info))
           (label (let ((lbl (org-html--reference src-block info t)))
                    (if lbl (format " id=\"%s\"" lbl) "")))
           (klipsify  (and  (plist-get info :html-klipsify-src)
                            (member lang '("javascript" "js"
                                           "ruby" "scheme" "clojure" "php" "html"))))
           (diff-highlight (if (and lang (string-prefix-p "diff" lang)) " diff-highlight" "")))
      (if (not lang) (format "<pre class=\"example\"%s>\n%s</pre>" label code)
        (format "<div class=\"org-src-container\">\n%s%s\n</div>"
                ;; Build caption.
                (let ((caption (org-export-get-caption src-block)))
                  (if (not caption) ""
                    (let ((listing-number
                           (format
                            "<span class=\"listing-number\">%s </span>"
                            (format
                             (org-html--translate "Listing %d:" info)
                             (org-export-get-ordinal
                              src-block info nil #'org-html--has-caption-p)))))
                      (format "<label class=\"org-src-name\">%s%s</label>"
                              listing-number
                              (org-trim (org-export-data caption info))))))
                ;; Contents.
                ;; Changed HTML template to work with Prism.
                (if klipsify
                    (format "<pre><code class=\"src language-%s%s\"%s%s>%s</code></pre>"
                            lang
                            diff-highlight
                            label
                            (if (string= lang "html")
                                " data-editor-type=\"html\""
                              "")
                            code)
                  (format "<pre><code class=\"src language-%s%s\"%s>%s</code></pre>"
                          lang diff-highlight label code)))))))

;; Overwrite the format for custom `coderef' (callouts) style in code.
(defun org-html-do-format-code
    (code &optional lang refs retain-labels num-start wrap-lines)
  "Format CODE string as source code.
Optional arguments LANG, REFS, RETAIN-LABELS, NUM-START, WRAP-LINES
are, respectively, the language of the source code, as a string, an
alist between line numbers and references (as returned by
`org-export-unravel-code'), a boolean specifying if labels should
appear in the source code, the number associated to the first
line of code, and a boolean specifying if lines of code should be
wrapped in code elements."
  (let* ((code-lines (split-string code "\n"))
         (code-length (length code-lines))
         (num-fmt
          (and num-start
               (format "%%%ds: "
                       (length (number-to-string (+ code-length num-start))))))
         (code (org-html-fontify-code code lang)))
    (org-export-format-code
     code
     (lambda (loc line-num ref)
       (setq loc
             (concat
              ;; Add line number, if needed.
              (when num-start
                (format "<span class=\"linenr\">%s</span>"
                        (format num-fmt line-num)))
              ;; Transcoded src line.
              (if wrap-lines
                  (format "<code%s>%s</code>"
                          (if num-start
                              (format " data-ox-html-linenr=\"%s\"" line-num)
                            "")
                          loc)
                loc)
              ;; Add label, if needed.
              ;; NOTE(toyboot): added coderef style.
              ;; TODO: replace with callout images?
              (when (and ref retain-labels)
                ;; (format " <span class=\"coderef-anchor\">(%s)</span>" ref)
                (format " <span class=\"coderef-anchor\">%s</span>" ref))))
       ;; Mark transcoded line as an anchor, if needed.
       (if (not ref) loc
         ;; REMARK(toyboot): added a wrapper `span' with `href', adding mouseover/click to `jump-href-*'.
         (let* ((coderef (format "coderef-%d-%s" my-codeblock-counter ref))
                (in (format "onmouseover=\"CodeHighlightOn(this,'jump-%s');\"" coderef))
                (out (format "onmouseout=\"CodeHighlightOff(this,'jump-%s');\"" coderef))
                (content (format "<a href=\"#%s\">%s</a>" coderef loc)))
           (format "<span id=\"%s\" %s %s class=\"coderef-off\">%s</span>"
                   coderef in out content))))
     num-start refs)))

;; Ovewrite the wrap image function
;; - remove `id' attribute for the `<figure>' tag:
;; - remove <br> between <img> and <figcaption>
(defun org-html--wrap-image (contents info &optional caption label)
  (let* ((html5-fancy (org-html--html5-fancy-p info))
         ;; HACK: remove literal <br> between <img> and <caption>
         (contents (replace-regexp-in-string "<br ?/?>" "" contents)))
    (format (if html5-fancy "\n<figure>\n%s%s\n</figure>"
              "\n<div class=\"figure\">\n%s%s\n</div>")
            (if html5-fancy contents (format "<p>%s</p>" contents))
            (if (not (org-string-nw-p caption)) ""
              (format (if html5-fancy "\n<figcaption>%s</figcaption>"
                        "\n<p>%s</p>")
                      (org-trim caption))))))

;; `#+BEGIN_CENTER' block
(defun my-org-html-center-block (center-block contents info)
  ;; `org-center' -> `text-center'
  (format "<div class=\"text-center\">\n%s</div>" contents))

;; `#+BEGIN_DETAILS' special block
(defun my-org-html-details-block (details-block contents info)
  ;; `PARAMETER' part of `#+BEGIN_DETAILS PARAMETERS' is not parsed, as described in:
  ;; <https://m13o.jp/202205062036>
  ;; So let's handle it manually. You know (I didn't know), current buffer is the `org' file!
  (let* ((block-begin (org-element-property :begin details-block))
         (contents-begin (org-element-property :contents-begin details-block))
         ;; NOTE: `-1' for removing the newline character:
         (block-line (buffer-substring block-begin (- contents-begin 1)))
         ;; Remove `#+BEGIN_DETAILS' and convert to html:
         (title-with-p (org-export-string-as (string-trim (substring block-line (length "#+BEGIN_DETAILS"))) 'html t))
         ;; Remove the surrounding `<p>' tags:
         (title (substring title-with-p 3 -5)))
    (format "<details>
<summary>%s</summary>
%s
</details>" title contents)))

;; ;; TODO: define it as special block
;; ;; `#+BEGIN_EXPORT yaruo'
;; (defun my-org-html-export-block (export-block contents info)
;;     "Transcode a EXPORT-BLOCK element from Org to HTML.
;; CONTENTS is nil.  INFO is a plist holding contextual information."
;;     (cond (;; yaruo
;;            (or (string= (org-element-property :type export-block) "YARUO")
;;                (string= (org-element-property :type export-block) "yaruo"))
;;            ;; <pre> is for avoiding mathjax
;;            (concat "<div class=\"YARUO\"><pre class=\"YARUO\">"
;;                    ;; (org-html-encode-plain-text (org-remove-indentation (org-element-property :value export-block)))
;;                    (xml-escape-string (org-remove-indentation (org-element-property :value export-block)))
;;                    "</pre></div>"))
;;           (t (ox-slimhtml-export-block export-block contents info))))

;; `#+BEGIN_YARUO' special block
(defun my-org-html-yaruo-block (yaruo-block contents info)
  ;; TODO: should not add <br> and should respect white spaces
  (let* ((beg (org-element-property :contents-begin yaruo-block))
         (end (org-element-property :contents-end yaruo-block))
         (raw-content (buffer-substring-no-properties beg end)))
    (format "<pre class=\"yaruo\">
%s
</pre>" raw-content)))

;; `#+BEGIN_STENO' special block
;; TODO: enable captions
(defun my-org-html-steno-block (steno-block contents info)
  (let* ((beg (org-element-property :contents-begin steno-block))
         (end (org-element-property :contents-end steno-block))
         (raw-content (buffer-substring-no-properties beg end)))
    ;; TODO: Remove mathjax_ignore, set it in other way
    (format "<steno-outline class=\"mathjax_ignore\">%s</steno-outline>" (string-trim raw-content))))

;; Special block (custom block) handler dispatcher
  (defun my-org-html-special-block (special-block contents info)
    (let* ((block-type (org-element-property :type special-block)))
      (cond ((or (string= block-type "details") (string= block-type "DETAILS"))
             (my-org-html-details-block special-block contents info))
            ((or (string= block-type "yaruo") (string= block-type "YARUO") (string= block-type "aa") (string= block-type "AA"))
             (my-org-html-yaruo-block special-block contents info))
            ((or (string= block-type "steno") (string= block-type "STENO"))
             (my-org-html-steno-block special-block contents info))
            (t ;; fallback
             (org-html-special-block special-block contents info)))))

;; Do not convert `/index.html' into `file:///index.html', really
(defun my-org-html-link (link desc info)
  "Transcode a LINK object from Org to HTML.
DESC is the description part of the link, or the empty string.
INFO is a plist holding contextual information.  See
`org-export-data'."
  (let* ((html-ext (plist-get info :html-extension))
         (dot (when (> (length html-ext) 0) "."))
         (link-org-files-as-html-maybe
          (lambda (raw-path info)
            ;; Treat links to `file.org' as links to `file.html', if
            ;; needed.  See `org-html-link-org-files-as-html'.
            (save-match-data
              (cond
               ((and (plist-get info :html-link-org-files-as-html)
                     (let ((case-fold-search t))
                       (string-match "\\(.+\\)\\.org\\(?:\\.gpg\\)?$" raw-path)))
                (concat (match-string 1 raw-path) dot html-ext))
               (t raw-path)))))
         (type (org-element-property :type link))
         (raw-path (org-element-property :path link))
         ;; Ensure DESC really exists, or set it to nil.
         (desc (org-string-nw-p desc))
         (path
          (cond
           ((member type '("http" "https" "ftp" "mailto" "news"))
            (url-encode-url (concat type ":" raw-path)))
           ((string= "file" type)
            ;; NEVER DO THIS:
            ;; ;; During publishing, turn absolute file names belonging
            ;; ;; to base directory into relative file names.  Otherwise,
            ;; ;; append "file" protocol to absolute file name.
            ;; (setq raw-path
            ;;       (org-export-file-uri
            ;;        (org-publish-file-relative-name raw-path info)))
            ;; ;; Possibly append `:html-link-home' to relative file
            ;; ;; name.
            ;; (let ((home (and (plist-get info :html-link-home)
            ;;                  (org-trim (plist-get info :html-link-home)))))
            ;;     (when (and home
            ;;                (plist-get info :html-link-use-abs-url)
            ;;                (file-name-absolute-p raw-path))
            ;;         (setq raw-path (concat (file-name-as-directory home) raw-path))))
            ;; Maybe turn ".org" into ".html".
            (setq raw-path (funcall link-org-files-as-html-maybe raw-path info))
            ;; Add search option, if any.  A search option can be
            ;; relative to a custom-id, a headline title, a name or
            ;; a target.
            (let ((option (org-element-property :search-option link)))
              (if (not option) raw-path
                (let ((path (org-element-property :path link)))
                  (concat raw-path
                          "#"
                          (org-publish-resolve-external-link option path t))))))
           (t raw-path)))
         (attributes-plist
          (org-combine-plists
           ;; Extract attributes from parent's paragraph.  HACK: Only
           ;; do this for the first link in parent (inner image link
           ;; for inline images).  This is needed as long as
           ;; attributes cannot be set on a per link basis.
           (let* ((parent (org-export-get-parent-element link))
                  (link (let ((container (org-export-get-parent link)))
                          (if (and (eq 'link (org-element-type container))
                                   (org-html-inline-image-p link info))
                              container
                            link))))
             (and (eq link (org-element-map parent 'link #'identity info t))
                  (org-export-read-attribute :attr_html parent)))
           ;; Also add attributes from link itself.  Currently, those
           ;; need to be added programmatically before `org-html-link'
           ;; is invoked, for example, by backends building upon HTML
           ;; export.
           (org-export-read-attribute :attr_html link)))
         (attributes
          (let ((attr (org-html--make-attribute-string attributes-plist)))
            (if (org-string-nw-p attr) (concat " " attr) ""))))
    (cond
     ;; Link type is handled by a special function.
     ((org-export-custom-protocol-maybe link desc 'html info))
     ;; Image file.
     ((and (plist-get info :html-inline-images)
           (org-export-inline-image-p
            link (plist-get info :html-inline-image-rules)))
      (org-html--format-image path attributes-plist info))
     ;; Radio target: Transcode target's contents and use them as
     ;; link's description.
     ((string= type "radio")
      (let ((destination (org-export-resolve-radio-link link info)))
        (if (not destination) desc
          (format "<a href=\"#%s\"%s>%s</a>"
                  (org-export-get-reference destination info)
                  attributes
                  desc))))
     ;; Links pointing to a headline: Find destination and build
     ;; appropriate referencing command.
     ((member type '("custom-id" "fuzzy" "id"))
      (let ((destination (if (string= type "fuzzy")
                             (org-export-resolve-fuzzy-link link info)
                           (org-export-resolve-id-link link info))))
        (pcase (org-element-type destination)
          ;; ID link points to an external file.
          (`plain-text
           (let ((fragment (concat "ID-" path))
                 ;; Treat links to ".org" files as ".html", if needed.
                 (path (funcall link-org-files-as-html-maybe
                                destination info)))
             (format "<a href=\"%s#%s\"%s>%s</a>"
                     path fragment attributes (or desc destination))))
          ;; Fuzzy link points nowhere.
          (`nil
           (format "<i>%s</i>"
                   (or desc
                       (org-export-data
                        (org-element-property :raw-link link) info))))
          ;; Link points to a headline.
          (`headline
           (let ((href (org-html--reference destination info))
                 ;; What description to use?
                 (desc
                  ;; Case 1: Headline is numbered and LINK has no
                  ;; description.  Display section number.
                  (if (and (org-export-numbered-headline-p destination info)
                           (not desc))
                      (mapconcat #'number-to-string
                                 (org-export-get-headline-number
                                  destination info) ".")
                    ;; Case 2: Either the headline is un-numbered or
                    ;; LINK has a custom description.  Display LINK's
                    ;; description or headline's title.
                    (or desc
                        (org-export-data
                         (org-element-property :title destination) info)))))
             (format "<a href=\"#%s\"%s>%s</a>" href attributes desc)))
          ;; Fuzzy link points to a target or an element.
          (_
           (if (and destination
                    (memq (plist-get info :with-latex) '(mathjax t))
                    (eq 'latex-environment (org-element-type destination))
                    (eq 'math (org-latex--environment-type destination)))
               ;; Caption and labels are introduced within LaTeX
               ;; environment.  Use "ref" or "eqref" macro, depending on user
               ;; preference to refer to those in the document.
               (format (plist-get info :html-equation-reference-format)
                       (org-html--reference destination info))
             (let* ((ref (org-html--reference destination info))
                    (org-html-standalone-image-predicate
                     #'org-html--has-caption-p)
                    (counter-predicate
                     (if (eq 'latex-environment (org-element-type destination))
                         #'org-html--math-environment-p
                       #'org-html--has-caption-p))
                    (number
                     (cond
                      (desc nil)
                      ((org-html-standalone-image-p destination info)
                       (org-export-get-ordinal
                        (org-element-map destination 'link #'identity info t)
                        info '(link) 'org-html-standalone-image-p))
                      (t (org-export-get-ordinal
                          destination info nil counter-predicate))))
                    (desc
                     (cond (desc)
                           ((not number) "No description for this link")
                           ((numberp number) (number-to-string number))
                           (t (mapconcat #'number-to-string number ".")))))
               (format "<a href=\"#%s\"%s>%s</a>" ref attributes desc)))))))
     ;; Coderef: replace link with the reference name or the
     ;; equivalent line number.
     ((string= type "coderef")
      (let ((fragment (format "coderef-%d-%s" my-codeblock-counter (org-html-encode-plain-text path))))
        ;; NOTE(toyboot): added id (`jump-coderef-*')
        (format "<a href=\"#%s\" id=\"jump-%s\" %s%s>%s</a>"
                fragment
                fragment
                (format "class=\"coderef\" onmouseover=\"CodeHighlightOn(this,'%s');\" onmouseout=\"CodeHighlightOff(this, '%s');\""
                        fragment fragment)
                attributes
                ;; NOTE(toyboot): reference code with anchor style
                ;; (format (org-export-get-coderef-format path desc)
                ;;         (org-export-resolve-coderef path info))
                (format "<span class=\"coderef-anchor\">%s</span>"
                        ;; the ref name:
                        (format (org-export-get-coderef-format path desc)
                                (org-export-resolve-coderef path info))))))
     ;; External link with a description part.
     ((and path desc)
      (format "<a href=\"%s\"%s>%s</a>"
              (org-html-encode-plain-text path)
              attributes
              desc))
     ;; External link without a description part.
     (path
      (let ((path (org-html-encode-plain-text path)))
        (format "<a href=\"%s\"%s>%s</a>" path attributes path)))
     ;; No path, only description.  Try to do something useful.
     (t
      (format "<i>%s</i>" desc)))))

;;; Link cards

;; Register the `card:' link type so Org recognises `[[card:https://...]]' and emit placeholder
;; anchors.
;;
;; The post processing script (`scripts/postprocess.ts') replaces it with a rich OGP card from the
;; committed `linkcard-cache.json'.
(org-link-set-parameters
 "card"
 :follow (lambda (path &optional _arg) (browse-url path))
 :export (lambda (path _desc backend _info)
           (when (org-export-derived-backend-p backend 'html)
             (let ((url (org-html-encode-plain-text path)))
               (format "<a class=\"link-card\" href=\"%s\" data-link-card>%s</a>" url url)))))

;;; Manual sitemap (`index.org') generation

;; Returns something like:
;; ((keyword (:key "DATE" :value "<2023-09-17 Sat>" :begin 20 :end 45 :post-blank 0 :post-affiliated 20 ...)))
;; Thanks: <https://emacs.stackexchange.com/questions/21713/how-to-get-property-values-from-org-file-headers>
(defun my-org-global-props (property &optional buffer)
  "Get the plists of global org properties of current buffer."
  (with-current-buffer (or buffer (current-buffer))
    (org-element-map (org-element-parse-buffer) 'keyword
      (lambda (el) (when (string-match property (org-element-property :key el)) el)))))

;; `my-org-global-prop-value "DATE"' => `2023-09-17 Sat'
(defun my-org-global-prop-value (key)
  "Get global org property KEY of current buffer."
  (org-element-property :value (car (my-org-global-props key))))

;; `my-org-read-prop "./example.org" "DATE"' => `2023-09-17 Sat'
(defun my-org-global-prop-value (key)
  "Get global org property KEY of current buffer."
  (org-element-property :value (car (my-org-global-props key))))

(defun my-org-read-prop (org-file key)
  "Reads an org file's propery using temporary buffer."
  (with-temp-buffer
    (insert-file-contents org-file)
    (my-org-global-prop-value key)))

;; Read several `#+KEY:' keywords from ORG-FILE in a single pass. Returns an
;; alist of (KEY . VALUE); missing keys are absent. Much cheaper than calling
;; `my-org-read-prop' once per key, which re-parses the whole document each time
;; (`collect-org-files' needs five keywords from every article, so the old
;; approach did 5 full `org-element-parse-buffer' passes per file).
(defun my-org-read-props (org-file keys)
  "Reads KEYS (a list of keyword strings) from ORG-FILE in one pass.
Uses Org's own `org-collect-keywords' rather than a hand-rolled regexp, so it
handles keyword syntax exactly as the exporter does. `delay-mode-hooks' keeps
the `org-mode' activation cheap and silences the non-Org-buffer warning that
`org-collect-keywords' would otherwise emit in a `fundamental-mode' buffer."
  (with-temp-buffer
    (insert-file-contents org-file)
    (delay-mode-hooks (org-mode))
    (mapcar (lambda (kw) (cons (car kw) (cadr kw)))
            (org-collect-keywords keys))))

;; Returns a plist of `filepath', 'href', `title', `date', `tags' and `draft'.
(defun collect-org-files (base-dir filter-p)
  (let* ((files (seq-filter
                 (lambda (s)
                   (not (string-match "index.org" s)))
                 (directory-files-recursively base-dir "\.org$")))
         (entries (mapcar
                   (lambda (s)
                     ;; NOTE: here `base-dir' is treated as a regex (unfortunately)
                     (let* (;; All keywords in one pass (see `my-org-read-props').
                            (props (my-org-read-props
                                    s '("TITLE" "DATE" "FILETAGS" "DRAFT" "THUMBNAIL")))
                            ;; `src/file.org' -> `/file.org'.
                            (filepath (string-trim-left s base-dir))
                            (href (replace-regexp-in-string "\\.org\\'" ".html" filepath))
                            (title (or (cdr (assoc "TITLE" props)) ""))
                            ;; `<2023-01-01 Sat>' => `2023-01-01'
                            (date (substring
                                   (or (cdr (assoc "DATE" props))
                                       (concat "<" (format-time-string "%F") ">"))
                                   1 11))
                            (filetags (or (cdr (assoc "FILETAGS" props)) ""))
                            (tags (split-string
                                   (replace-regexp-in-string
                                    ":" " "
                                    (string-trim filetags " "))))
                            (draft (org-string-nw-p (cdr (assoc "DRAFT" props))))
                            (thumbnail (my-thumbnail-src (cdr (assoc "THUMBNAIL" props)))))
                       (list :filepath filepath :href href :title title :date date :tags tags :draft draft :thumbnail thumbnail)))
                   files)))

    (sort
     (seq-filter filter-p entries)
     (lambda (l r)
       (string> (plist-get l :href) (plist-get r :href))))))

;; Concatenates strings with `\n' as the delimiter.
(defun join-with-newline (xs)
  (mapconcat #'identity xs "\n"))

(defun create-tag-sxml (tag)
  `(a (@ (href ,(concat "/tags/" tag ".html"))
         (class "org-tag"))
      (code
       ,tag)))

(defun show-tag-list (all-tags)
  (join-with-newline
   `("#+BEGIN_EXPORT html"
     ,(my-sxml-to-xml
       `(div (@ (class "org-tag-list"))
             ,@(mapcar #'create-tag-sxml all-tags)))
     "#+END_EXPORT")))

(defun create-article-card (entry)
  (let* ((title (plist-get entry :title))
         ;; Convert =code= etc. in title into html. Remove the surrounding <p>
         (title-html (replace-regexp-in-string "^<p>\\|</p>$" "" (org-export-string-as title 'html t '(:body-only t))))
         (date (plist-get entry :date))
         (link (plist-get entry :href))
         (tags (plist-get entry :tags))
         (thumbnail (plist-get entry :thumbnail)))
    `(div (@ (class "article-card"))
          ;; Padded text content; the thumbnail below stays flush to the border.
          (div (@ (class "article-card-body"))
               (div (a (@ (href ,link)
                          (class "article-card-link"))
                       (*RAW-STRING* ,title-html)))
               (div (@ (class "article-card-meta"))
                    (date ,date)
                    (span (@ (class "org-tag-list"))
                          ,@(mapcar #'create-tag-sxml tags))))
          ;; Thumbnail: `decoding=async' always. The first `my-eager-image-count'
          ;; thumbnails (above the fold) load eagerly; the very first is the LCP
          ;; and gets fetchpriority=high, the rest stay lazy/low.
          ,@(when thumbnail
              (let* ((eager (> my-eager-image-budget 0))
                     (lcp (and eager (= my-eager-image-budget my-eager-image-count))))
                (when eager (setq my-eager-image-budget (1- my-eager-image-budget)))
                `((img (@ (class "article-card-thumbnail")
                          (src ,thumbnail)
                          (alt "")
                          (loading ,(if eager "eager" "lazy"))
                          (decoding "async")
                          (fetchpriority ,(cond (lcp "high") (eager "auto") (t "low")))))))))))

(defun show-article-cards (entries)
  (join-with-newline
   `("#+BEGIN_EXPORT html"
     ,(my-sxml-to-xml
       `(div (@ (class "article-list"))
             ,@(mapcar #'create-article-card entries)))
     "#+END_EXPORT")))

;; Generates `index.org'.
(defun my-generate-sitemap (page-title devlog-entries diary-entries all-tags)
  (setq my-eager-image-budget my-eager-image-count) ; leading Devlog thumbnails load eagerly
  (let* ((tag-list (show-tag-list all-tags))
         (devlog-cards (show-article-cards devlog-entries))
         (diary-cards (show-article-cards diary-entries)))
    (concat "#+TITLE: " page-title "\n"
            "#+DESCRIPTION: " my-default-description "\n" "\n"
            "* Tags" "\n" "\n" tag-list "\n" "\n"
            "* Devlog (timeline)" "\n" "\n" devlog-cards "\n" "\n"
            "* Diary" "\n" "\n" diary-cards)))

;; Generates `tags/<tag>.org'.
(defun my-generate-tag-page-org (base-dir title devlog-entries all-tags tag)
  (setq my-eager-image-budget my-eager-image-count) ; leading thumbnails below load eagerly
  (let* ((tag-list (show-tag-list all-tags))
         (entries
          (seq-filter
           (lambda (entry) (member tag (plist-get entry :tags)))
           devlog-entries))
         (article-cards (show-article-cards entries)))
    (concat "#+TITLE: " title " (=#" tag "=)\n" "\n"
            "* Tags" "\n" "\n" tag-list "\n" "\n"
            "* Devlog (=#" tag "=)" "\n"
            "#+ATTR_HTML: :class sitemap" "\n" article-cards)))

;; Writes STRING to PATH only when the content differs from what's already there.
;; The generated `index.org' / `tags/*.org' are rebuilt every run, but if we
;; rewrote them unconditionally their mtime would bump and `org-publish' would
;; re-export all 18 pages on every build (even a body-only article edit). Leaving
;; the file untouched when unchanged lets the timestamp cache skip them.
(defun my-write-if-changed (path string)
  (unless (and (file-exists-p path)
               (string= string
                        (with-temp-buffer
                          (insert-file-contents path)
                          (buffer-string))))
    (with-temp-file path (insert string))))

;; Creates `tags/<tag>.org'.
(defun my-create-tag-page-org-file (base-dir devlog-entries all-tags tag)
  (let ((index-org-string (my-generate-tag-page-org base-dir "Toybeam" devlog-entries all-tags tag))
        (index-org-path (concat base-dir "/tags/" tag ".org")))
    (my-write-if-changed index-org-path index-org-string)))

;;; Backend (setup)

;; Set up `my-site-html' backend:
(org-export-define-derived-backend
    'my-site-html
    my-base-backend

  ;; OGP options for `my-html-head' in each article:
  ;; - `#+DESCRIPTION:' overrides `og:description'.
  ;; - `#+THUMBNAIL:' sets `og:image' (absolute URL, or a path under the site root).
  :options-alist
  '((:description "DESCRIPTION" nil nil newline)
    (:thumbnail "THUMBNAIL" nil nil t))

  :translate-alist
  '((template . my-org-html-template)
    (link . my-org-html-link)
    ;; (export-block . my-org-html-export-block)
    (src-block . roygbyte/org-html-src-block)
    (center-block . my-org-html-center-block)
    (special-block . my-org-html-special-block)))

;; Single source of truth: `#+DRAFT:' articles are published only in `--draft'.
(defun my-publish-drafts-p ()
  (string= build-target "draft"))

(defun my-org-html-publish-to-html (plist filename pub-dir)
  "Publish an org file to HTML, using the FILENAME as the output directory.
Skips `#+DRAFT:'-flagged files unless this is a `--draft' build."
  (if (and (not (my-publish-drafts-p))
           (org-string-nw-p (my-org-read-prop filename "DRAFT")))
      (message "Skipping draft: %s" filename)
    (org-publish-org-to 'my-site-html filename
                        (concat (when (> (length org-html-extension) 0) ".")
                                (or (plist-get plist :html-extension)
                                    org-html-extension
                                    "html"))
                        plist pub-dir)))


;;; Parallel export fan-out
;;
;; The Org -> HTML export is the build's only real bottleneck and `org-publish'
;; runs it sequentially in one process. So the article export is fanned out to
;; worker Emacs subprocesses: this (coordinator) process generates `index.org' /
;; `tags/*.org', computes the stale set, and owns the `org-publish' timestamp
;; cache; the workers (re-invocations of this script with `--export-worker') are
;; stateless and just force-export the file list handed to them. Only the
;; coordinator reads/writes the cache, so there is no race, and it reuses Org's
;; own cache functions so the result is interchangeable with a plain serial
;; build. See `docs/adr/0004-parallel-export-fan-out.md'.

;; Below this many stale files, fan-out's per-worker startup (~0.5s) costs more
;; than it saves, so we export in-process instead. ~= worker-startup / per-file.
(defconst my-parallel-export-threshold 10)

;; Cap on the automatic worker count. Each worker re-loads Org from scratch
;; (~0.5s, CPU-bound), and that startup — not the export — dominates the fan-out,
;; so launching more workers than physical cores just makes the simultaneous
;; boots contend (measured: throughput stops improving past ~8 even on a
;; 20-logical-core box). `num-processors' only reports logical cores, so cap at a
;; constant knee; an explicit `-j N' still overrides this.
(defconst my-max-workers 8)

(require 'cl-lib)                       ; `cl-position' for argument parsing

(defvar my-jobs-arg nil
  "Value of the `-j' / `--jobs' option, or nil for the automatic worker count.")

(defvar my-worker-files nil
  "Files this process must export in `--export-worker' mode, or nil (coordinator).")

(defun my-cpu-count ()
  "Cores to use: nix's allotment when in a sandbox, else the host count."
  (let ((nbc (getenv "NIX_BUILD_CORES")))
    (if (and nbc (> (string-to-number nbc) 0))
        (string-to-number nbc)
      (max 1 (num-processors)))))

(defun my-export-jobs (n-stale jobs-arg)
  "Worker count for N-STALE files.  JOBS-ARG is the -j value, or nil (auto)."
  (cond ((and jobs-arg (<= jobs-arg 1)) 1)        ; -j 1: force serial
        (jobs-arg (min jobs-arg n-stale))         ; -j N: force N
        ((< n-stale my-parallel-export-threshold) 1) ; small build: in-process
        (t (min n-stale (my-cpu-count) my-max-workers))))

(defun my-chunk-list (xs n)
  "Split XS into at most N contiguous chunks of near-equal size."
  (let* ((len (length xs))
         (n (max 1 (min n len)))
         (base (/ len n))
         (rem (% len n))
         (rest xs)
         chunks)
    (dotimes (i n)
      (let ((size (+ base (if (< i rem) 1 0))))
        (push (seq-take rest size) chunks)
        (setq rest (seq-drop rest size))))
    (nreverse chunks)))

(defun my-posts-context ()
  "Static export context (plist) shared by the coordinator and workers."
  (let* ((project (assoc "release-posts" org-publish-project-alist))
         (plist (cdr project)))
    (list :project project
          :plist plist
          :base-dir (file-name-as-directory (plist-get plist :base-directory))
          :pub-base-dir (file-name-as-directory (plist-get plist :publishing-directory))
          :pubfunc (plist-get plist :publishing-function))))

(defun my-export-one (filename ctx)
  "Export a single org FILENAME using export context CTX."
  (let ((pub-dir (file-name-directory
                  (expand-file-name
                   (file-relative-name filename (plist-get ctx :base-dir))
                   (plist-get ctx :pub-base-dir)))))
    (funcall (plist-get ctx :pubfunc) (plist-get ctx :plist) filename pub-dir)))

;; Worker entry point: force-export FILES, no cache. Any error aborts the
;; subprocess with a non-zero exit, which the coordinator treats as a chunk
;; failure.
(defun my-run-worker (files)
  "Export FILES (a chunk) in this worker subprocess."
  (let ((ctx (my-posts-context)))
    ;; `org-publish-org-to' reads/writes the in-memory publish cache, so the
    ;; worker needs it initialised. The coordinator has already created the
    ;; cache file before spawning us, so this only *loads* it — no disk write,
    ;; no race; the worker never calls `org-publish-write-cache-file'.
    (org-publish-initialize-cache "release-posts")
    (dolist (filename files)
      (my-export-one filename ctx))))

;; Spawn one worker subprocess per chunk and wait for all of them. Returns
;; (SUCCEEDED-FILES . FAILED-P): files from chunks whose worker exited 0, and
;; whether any worker failed. The same Emacs binary and script re-run with
;; `--export-worker' so workers are identical to the coordinator (hermetic).
(defun my-fan-out-export (files njobs)
  "Export FILES across NJOBS worker subprocesses."
  (let* ((emacs (expand-file-name invocation-name invocation-directory))
         (script (or load-file-name (expand-file-name "build.el")))
         (target (if (my-publish-drafts-p) "--draft" "--release"))
         (chunks (seq-filter #'identity (my-chunk-list files njobs)))
         (ok nil)
         (failed nil)
         jobs)
    (dolist (chunk chunks)
      (when chunk
        (let ((buf (generate-new-buffer " *export-worker*")))
          (push (list (make-process
                       :name "export-worker" :buffer buf :noquery t
                       :connection-type 'pipe
                       :command (append (list emacs "-Q" "--script" script "--"
                                              target "--export-worker")
                                        chunk))
                      buf chunk)
                jobs))))
    ;; Wait for every worker; `accept-process-output' drains all pipes so a
    ;; chatty worker can't deadlock on a full stderr buffer.
    (let ((procs (mapcar #'car jobs)))
      (while (seq-some #'process-live-p procs)
        (accept-process-output nil 0.2)))
    (dolist (job jobs)
      (let ((proc (nth 0 job)) (buf (nth 1 job)) (chunk (nth 2 job)))
        (if (eq (process-exit-status proc) 0)
            (setq ok (append ok chunk))
          (setq failed t)
          (message "--- export worker failed (exit %s) ---\n%s"
                   (process-exit-status proc)
                   (with-current-buffer buf (buffer-string))))
        (kill-buffer buf)))
    (cons ok failed)))

;; Coordinator: export all stale article/index/tag files, owning the cache.
;; `my-write-if-changed' has already written index.org/tags/*.org to disk, so
;; `org-publish-get-base-files' sees them as ordinary stale .org files.
(defun my-run-posts-export ()
  "Export the `release-posts' project, fanning out across workers when worth it."
  (let* ((ctx (my-posts-context))
         (project (plist-get ctx :project))
         (pub-base-dir (plist-get ctx :pub-base-dir))
         (base-dir (plist-get ctx :base-dir))
         (pubfunc (plist-get ctx :pubfunc))
         (failed nil))
    (org-publish-initialize-cache "release-posts")
    (let* ((all-files (org-publish-get-base-files project))
           ;; Reuse Org's own staleness check so keys match a serial build.
           (stale (if force-flag
                      all-files
                    (seq-filter
                     (lambda (f)
                       (org-publish-cache-file-needs-publishing
                        f pub-base-dir pubfunc base-dir))
                     all-files)))
           (njobs (my-export-jobs (length stale) my-jobs-arg)))
      (cond
       ((null stale)
        (message "Articles: nothing to rebuild"))
       ((<= njobs 1)
        (message "Articles: %d file(s), in-process" (length stale))
        (dolist (f stale)
          (my-export-one f ctx)
          (org-publish-update-timestamp f pub-base-dir pubfunc base-dir)))
       (t
        (message "Articles: %d file(s) across %d worker(s)" (length stale) njobs)
        (let ((res (my-fan-out-export stale njobs)))
          ;; Stamp only files whose worker succeeded (never stamp un-exported
          ;; output), then surface any failure as a non-zero build exit.
          (dolist (f (car res))
            (org-publish-update-timestamp f pub-base-dir pubfunc base-dir))
          (setq failed (cdr res)))))
      (org-publish-write-cache-file)
      (when failed
        (kill-emacs 1)))))


;;; Build

;; Build options:
;; - `-d' / `--draft': includes the `#+DRAFT' articles.
;; - `-f' / `--force': rebuilds every file, ignoring the timestamp cache.
;; - `-j' / `--jobs' N: worker count for the parallel export (default: auto).
;; - `--export-worker FILES...': internal worker mode (force-exports FILES).
(let* ((args command-line-args-left)
       (wpos (cl-position "--export-worker" args :test #'string=))
       ;; Everything after `--export-worker' is the worker's file list.
       (head (if wpos (seq-take args wpos) args)))
  (setq my-worker-files (and wpos (nthcdr (1+ wpos) args)))
  (setq build-target (if (or (member "-d" head) (member "--draft" head)) "draft" "release"))
  (setq force-flag (and (or (member "-f" head) (member "--force" head)) t))
  (setq my-jobs-arg
        (let ((v (or (cadr (member "-j" head)) (cadr (member "--jobs" head)))))
          (and v (string-to-number v)))))

;; Worker mode: just export the handed-off chunk and exit (a failing export
;; aborts the subprocess with a non-zero status, which the coordinator detects).
(when my-worker-files
  (my-run-worker my-worker-files)
  (kill-emacs 0))

(message "--------------------------------------------------------------------------------")
(message "Building project!")

(let* ((base-dir "src")
       ;; Keep drafts in output:
       (keep-p (lambda (entry) (or (my-publish-drafts-p) (not (plist-get entry :draft)))))
       ;; "src/*.org"
       (devlog-entries
        (collect-org-files
         base-dir (lambda (entry)
                    (let ((url (plist-get entry :filepath)))
                      (and (not (string-match "diary/" url))
                           (not (string-match "tags/" url))
                           (funcall keep-p entry))))))
       ;;"src/diary/*.org"
       (diary-entries
        (collect-org-files
         base-dir (lambda (entry)
                    (and (string-match "diary/" (plist-get entry :filepath))
                         (funcall keep-p entry)))))
       (all-tags
        (sort
         (seq-uniq (apply #'append
                          (mapcar (lambda (entry) (plist-get entry :tags)) devlog-entries)))
         #'string<)))
  (message "Generating `index.org`..")
  (let* ((index-org-string
          (my-generate-sitemap "Toybeam" devlog-entries diary-entries all-tags))
         (index-org-path (concat base-dir "/index.org")))
    (my-write-if-changed index-org-path index-org-string))

  (message "Generating `tags/*.org`..")
  (mapcar
   (lambda (tag)
     (my-create-tag-page-org-file "src" devlog-entries all-tags tag))
   all-tags)

  (message "Copying static files..")
  ;; Attachments (images/CSS/JS/fonts) are cheap file copies — keep them in the
  ;; coordinator; only the CPU-bound article export is fanned out.
  (org-publish "static" force-flag)

  (message "Building articles..")
  (my-run-posts-export))

(message "--------------------------------------------------------------------------------")
(message "Build complete!")

