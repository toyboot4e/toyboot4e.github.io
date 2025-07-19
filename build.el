;; Build script
;;
;; Thanks:
;; - `https://systemcrafters.net/publishing-websites-with-org-mode/building-the-site/'
;; - `https://taingram.org/blog/org-mode-blog.html'
;; - `https://www.roygbyte.com/add_syntax_highlighting_to_an_org_publish_project.html'
;; - `https://github.com/balddotcat/ox-slimhtml'


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
  (require 'package)
  (setq package-user-dir (expand-file-name "./.blog-build-packages"))
  (setq package-archives '(("melpa" . "https://melpa.org/packages/")
                           ("elpa" . "https://elpa.gnu.org/packages/")))

  (package-initialize)
  (unless package-archive-contents
    (package-refresh-contents)))

(progn
  ;; Needed when you need builtin code block highlight
  ;; (package-install 'htmlize)

  ;; `seq-*' functions
  (require 'seq)

  ;; Create HTML from S-expressions
  (package-install 'esxml)
  (require 'esxml)

  ;; Local package downloaded from: `https://github.com/balddotcat/ox-slimhtml'
  (add-to-list 'load-path (expand-file-name default-directory))
  (require 'ox-slimhtml)

  ;; Use `<br>' rather than `<br />'.
  (setq org-html-doctype "html5")

  ;; Prefer `<figure>' tag to <div>', etc.
  (setq org-html-html5-fancy t)

  (require 'ox-publish))

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
        :publishing-directory "./out"
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
        ("draft" :components ("static" "release-posts" "draft-posts"))

        ;; components:
        ("release-posts" ,@base-attrs
         :base-directory "./src/"
         :recursive t
         ;; :include ,(mapcar (lambda (x) (concat "./src/" x)) (directory-files "./src" nil "\\.org$"))
         )

        ("draft-posts" ,@base-attrs
         :base-directory "./draft"
         :recursive t
         )

        ("static"
         :base-directory "./src"
         :base-extension "js\\|css\\|png\\|jpg\\|gif\\|svg\\|mp4\\|mov\\|woff2"
         ;; `/ltximg/' is for previewing. MathJax is used at runtime.
         :exclude ,(rx-to-string (rx "ltximg/"))
         ;; :exclude ,(rx-to-string (rx line-start "ltximg"))
         :publishing-directory  "./out"
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

;; Returns `<head>' SXML
(defun my-html-head (info)
  ;; Reset `my-codeblock-counter' on new file. TODO: move it to more appropriate place
  (setq my-codeblock-counter 0)
  ;; NOTE: `esxml-html' is not on MELPA
  `(head
    (meta (@ (charset "utf-8")))
    ;; (meta (@ (author "toyboot4e")))
    (meta (@ (name "viewport")
             (content "width=device-width, initial-scale=1")))
    ;; NOTE: `org-export-data' returns HTML, so we'll remove HTML tags
    (title (*RAW-STRING* ,(concat (my-strip-html (org-export-data (plist-get info :title) info)) " - toybeam")))
    (meta (@ (name "description")
             (content "devlog by toyboot4e")))
    ;; (link (@ (rel "stylesheet")
    ;;          (href "https://cdn.simplecss.org/simple.min.css")))
    (link (@ (rel "stylesheet")
             (href "/style/simple.min.css")))
    (link (@ (rel "stylesheet")
             (href "/style/style.css")))
    (link (@ (rel "stylesheet")
             (href "/style/prism.css")))
    (script (@ (type "text/javascript")
               (src "/style/style.js"))
            ;; NOTE: empty body is required for self-closing tag
            "")
    (script (@ (type "text/javascript")
               ;; NOTE: It creates `async=""`. I prefer `async` only, but the value is required for XHTML.
               (async "")
               (src "/style/prism.js"))
            ;; NOTE: empty body is required for self-closing tag
            "")
    ;; TODO: lazy loading
    (script (@ (type "text/javascript")
               (async "")
               (src "/style/steno-viz.js"))
            "")
    (*RAW-STRING* "<!-- MathJax -->")
    (script (@ (type "text/javascript")
               (async "")
               (src "https://cdnjs.cloudflare.com/ajax/libs/mathjax/2.7.7/latest.js?config=TeX-MML-AM_CHTML"))
            "")))

;; Returns `<header>' SXML
(defun my-html-header (info)
  `(header (@ (role "banner"))
           ;; `org-export-data' returns raw HTML
           (h1 (*RAW-STRING* ,(org-export-data (plist-get info :title) info)))
           ;; timestamp
           (p ,(org-export-data (org-export-get-date info "%b %e, %Y") info))
           (nav (@ (role "navigation"))
                (a (@ (href "/index.html")) "Home")
                (a (@ (href "https://github.com/toyboot4e")) "GitHub"))))

;; Returns `<footer>' SXML
(defun my-html-footer (info)
  `(footer (@ (role "contentinfo"))
           (*RAW-STRING* "<p>Styled with <a href=\"https://simplecss.org/\">Simple.css</a></p>")
           (div
            (a (@ (href "/index.html")) "Home")
            (a (@ (href "https://github.com/toyboot4e")) "GitHub"))))

;; Thanks: `https://github.com/SystemCrafters/systemcrafters.github.io/blob/master/publish.el'
(defun my-org-html-template (contents info)
  (concat
   "<!DOCTYPE html>\n"
   (my-sxml-to-xml
    `(html (@ (lang "ja"))
           ,(my-html-head info)

           (body
            ,(my-html-header info)
            (main (@ (role "main"))
                  (*RAW-STRING* ,contents))

            ,(my-html-footer info)
            )))))

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

;; Ovewrite the wrap image function and remove `id' attribute for the `<figure>' tag:
(defun org-html--wrap-image (contents info &optional caption label)
  (let ((html5-fancy (org-html--html5-fancy-p info)))
    (format (if html5-fancy "\n<figure>\n%s%s\n</figure>"
              "\n<div class=\"figure\">\n%s%s\n</div>")
            ;; NOTE: `id' attribute for `<figure>' is removed
            (if html5-fancy contents (format "<p>%s</p>" contents))
            (if (not (org-string-nw-p caption)) ""
              (format (if html5-fancy "\n<figcaption>%s</figcaption>"
                        "\n<p>%s</p>")
                      caption)))))

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

;; Returns a list of '(url tag-list)
(defun collect-org-files (base-dir filter-p)
  (let* ((files (seq-filter
                 (lambda (s)
                   (not (string-match "index.org" s)))
                 (directory-files-recursively base-dir "\.org$")))
         (entries (mapcar
                   (lambda (s)
                     ;; NOTE: here `base-dir' is treated as a regex (unfortunately)
                     (let* ((relative-path (string-trim-left s base-dir))
                            (filetags (or (my-org-read-prop s "FILETAGS") ""))
                            (tags (split-string
                                   (replace-regexp-in-string
                                    ":" " "
                                    (string-trim filetags " ")))))
                       `(,relative-path ,tags)))
                   files)))

    (sort
     (seq-filter filter-p entries)
     (lambda (l r)
       (string> (car l) (car r))))))

;; Parses an `org-file' headline and returns an org line as a link.
(defun my-show-article-bullet (org-file link-path)
  (let* ((title (or (my-org-read-prop org-file "TITLE") "<none>"))
         ;; `<2023-01-01 Sat>' => `2023-01-01'
         (date-string (substring (or (my-org-read-prop org-file "DATE") (concat "<" (format-time-string "%F") ">")) 1 11))
         (filetags (or (my-org-read-prop org-file "FILETAGS") ""))
         (tags (split-string
                (replace-regexp-in-string
                 ":" " "
                 (string-trim filetags " "))))
         (tag-delimiter ;; "&nbsp;"
          "|")
         (tags-string
          (if (not tags) ""
            (format " [@@html:%s@@]"
                    (mapconcat
                     (lambda (tag)
                       (let ((link (format "./tags/%s.html" tag)))
                         (format "<a href=\"%s\" class=\"org-tag\"><code>#%s</code></a>" link tag)))
                     tags tag-delimiter)))))
    (format "@@html:<date>%s</date>@@ [[file:%s][%s]]%s" date-string link-path title tags-string)))

;; Creates a list of `- [[..][..]]'.
(defun my-show-article-bullets (base-dir url-tags-list)
  (mapcar (lambda (url-tags)
            (let ((org-file (concat base-dir (car url-tags)))
                  (link-path (concat "." (car url-tags))))
              (format "- %s" (my-show-article-bullet org-file link-path))))
          url-tags-list))

;; Concatenates strings with `\n' as the delimiter.
(defun join-with-newline (xs)
  (mapconcat #'identity xs "\n"))

;; Generates `index.org'
(defun my-generate-sitemap (base-dir page-title)
  (let* ((devlog-bullets
          (my-show-article-bullets
           "src" (collect-org-files
                  base-dir (lambda (url-tags)
                             (let ((url (car url-tags)))
                               (and (not (string-match "diary/" url))
                                    (not (string-match "tags/" url))))))))

         (diary-bullets
          (my-show-article-bullets
           "src" (collect-org-files
                  base-dir (lambda (url-tags)
                             (let ((url (car url-tags)))
                               (string-match "diary/" url)))))))
    (concat "#+TITLE: " page-title "\n"
            "\n"

            ;; "#+BEGIN_CENTER" "\n"
            ;; "[[/index.html][devlog]] | [[/diary/index.org][diary]]" "\n"
            ;; "#+END_CENTER" "\n"
            "* devlog" "\n"
            "#+ATTR_HTML: :class sitemap" "\n"
            (join-with-newline devlog-bullets) "\n"
            "\n"

            "* diary" "\n"
            "#+ATTR_HTML: :class sitemap" "\n"
            (join-with-newline diary-bullets)"\n"
            )))

;; Generates string content of `tags/<tag>.org'
(defun my-generate-tag-page-org (base-dir tag)
  (let* ((url-tags-list
          (collect-org-files
           base-dir
           (lambda (url-tags) (member tag (car (cdr url-tags))))))
         ;; Org-mode file bullets:
         (bullets
          (mapcar (lambda (url-tags)
                    (let ((org-file (concat base-dir (car url-tags)))
                          (link-path (concat "." (car url-tags))))
                      (format "- %s" (my-show-article-bullet org-file link-path))))
                  url-tags-list))
         ;; Stringify
         (articles (join-with-newline bullets)))
    (concat "#+TITLE: #" tag "\n"
            "\n"

            ;; "#+BEGIN_CENTER" "\n"
            ;; "[[/index.html][devlog]] | [[/diary/index.org][diary]]" "\n"
            ;; "#+END_CENTER" "\n"
            "* Articles (#" tag ")" "\n"
            "#+ATTR_HTML: :class sitemap" "\n"
            articles"\n"
            )))

;; Creates `tags/<tag>.org'.
(defun my-create-tag-page-org-file (base-dir tag)
  (let ((index-org-string (my-generate-tag-page-org base-dir tag))
        (index-org-path (concat base-dir "/tags/" tag ".org")))
    (with-temp-file index-org-path (insert index-org-string))))

;;; Backend (setup)

;; Set up `my-site-html' backend:
(org-export-define-derived-backend
 'my-site-html
 my-base-backend

 :translate-alist
 '((template . my-org-html-template)
   (link . my-org-html-link)
   ;; (export-block . my-org-html-export-block)
   (src-block . roygbyte/org-html-src-block)
   (center-block . my-org-html-center-block)
   (special-block . my-org-html-special-block)))

(defun my-org-html-publish-to-html (plist filename pub-dir)
  "Publish an org file to HTML, using the FILENAME as the output directory."
  (org-publish-org-to 'my-site-html filename
                      (concat (when (> (length org-html-extension) 0) ".")
                              (or (plist-get plist :html-extension)
                                  org-html-extension
                                  "html"))
                      plist pub-dir))


;;; Build

;; release build by default, ignoring drafts
(setq build-target "release")
(setq force-flag nil)

(message (concat "Target: " build-target " force flag: " (symbol-name force-flag)))
(message "--------------------------------------------------------------------------------")

(org-publish-remove-all-timestamps)

(message "Generating `index.org`..")
(let* ((base-dir "src")
      (index-org-string (my-generate-sitemap base-dir "toybeam"))
      (index-org-path (concat base-dir "/index.org")))
   (with-temp-file index-org-path (insert index-org-string)))

;; TODO: draft/release
;; TODO: Collect tags first
(my-create-tag-page-org-file "src" "atcoder")
(my-create-tag-page-org-file "src" "blender")
(my-create-tag-page-org-file "src" "blog")
(my-create-tag-page-org-file "src" "buy")
(my-create-tag-page-org-file "src" "gamedev")
(my-create-tag-page-org-file "src" "haskell")
(my-create-tag-page-org-file "src" "keyboard")
(my-create-tag-page-org-file "src" "misc")
(my-create-tag-page-org-file "src" "nix")
(my-create-tag-page-org-file "src" "react")
(my-create-tag-page-org-file "src" "steno")
(my-create-tag-page-org-file "src" "tools")
(my-create-tag-page-org-file "src" "vim")

(if force-flag
    (org-publish build-target t)
  (org-publish build-target))

(message "--------------------------------------------------------------------------------")
(message "Build complete!")

