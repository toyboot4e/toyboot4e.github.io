;; Build script
;;
;; Thanks:
;; - `https://systemcrafters.net/publishing-websites-with-org-mode/building-the-site/'
;; - `https://taingram.org/blog/org-mode-blog.html'
;; - `https://www.roygbyte.com/add_syntax_highlighting_to_an_org_publish_project.html'

(setq make-backup-files nil)

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

    ;; Create HTML from S-expressions
    (package-install 'esxml)
    (require 'esxml)

    ;; Use `<br>' rather than `<br />':
    (setq org-html-doctype "html5")

    (require 'ox-publish))

;;; Ingredients

;; Creates final output
(defun my-sxml-to-xml (sxml)
    ;; NOTE: `pp' formats `<code>' tag contents, too.
    ;; (pp-esxml-to-xml (sxml-to-esxml sxml))
    ;; So I use `exml-to-xml' and run `tidy' after build.
    (esxml-to-xml (sxml-to-esxml sxml)))

;; Thanks: `http://sachachua.com/notebook/emacs/small-functions.el'
;; TODO: hide meesage here?:
(defun my-strip-html (string)
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

        (buffer-substring-no-properties (point-min) (point-max))))

;;; Project settings

;; Attributes for `org-publish-project-alist' below.
;; See also: `https://orgmode.org/org.html#Publishing-options'
(setq base-attrs
      ;; backquote and splice operator ,@: `https://www.gnu.org/software/emacs/manual/html_node/elisp/Backquote.html'
      `(:base-directory "./src"
                        :base-extension "org"
                        :publishing-directory "./out"
                        :recursive t
                        ;; Custom function defined below
                        :publishing-function my-org-html-publish-to-html
                        :section-numbers nil
                        :with-author nil
                        :with-creator nil
                        :with-toc nil
                        ;; `index.html' generation:
                        :auto-sitemap t
                        :sitemap-filename "index.org"
                        :sitemap-title "Index"
                        :sitemap-format-entry my-org-sitemap-format-entry
                        :sitemap-style list ;; list | tree
                        :sitemap-sort-files chronologically))

(setq org-publish-project-alist
      `(
        ;; build targets:
        ("release" :components ("static" "release-posts"))
        ("draft" :components ("static" "draft-posts"))

        ;; components:
        ("release-posts" ,@base-attrs :exclude ".*\.draft\.org")
        ("draft-posts" ,@base-attrs)

        ("static"
         :base-directory "./src"
         :base-extension "js\\|css\\|png\\|jpg\\|gif"
         :publishing-directory  "./out"
         :recursive t
         :publishing-function org-publish-attachment)))

;;; Style

;; Add link to each heading
(setq org-html-self-link-headlines t)

;; No need of code highlight
(setq org-html-htmlize-output-type 'nil)

;;; Backend (HTML template)

;; NOTE:
;; - Generate XHTML from SXML using the `esxml' package
;; - Raw HTML can be embedded into SXML using `*RAW-STRING*'
;; - `org-export-data' returns document property

;; Returns article link SXML in `Index.html'
;; - `entry' = path
;; - Thanks: `https://miikanissi.com/blog/website-with-emacs/'
(defun my-org-sitemap-format-entry (entry style project)
    (cond ((not (directory-name-p entry))
           (let* ((date (org-publish-find-date entry project)))
               (format "[[file:%s][%s: %s]]"
                       entry
                       (format-time-string "%F" date)
                       (org-publish-find-title entry project))))
          ((eq style 'tree)
           ;; Return only last subdir.
           (file-name-nondirectory (directory-file-name entry)))
          (t entry)))

;; Returns `<head>' SXML
(defun my-html-head (info)
    ;; NOTE: `esxml-html' is not on MELPA
    `(head
      (meta (@ (charset "utf-8")))
      ;; (meta (@ (author "toyboot4e")))
      (meta (@ (name "viewport")
               (content "width=device-width, initial-scale=1")))
      (link (@ (rel "stylesheet")
               (href "https://cdn.simplecss.org/simple.min.css")))
      (link (@ (rel "stylesheet")
               (href "style/style.css")))
      (link (@ (rel "stylesheet")
               (href "style/prism.css")))
      (script (@ (src "/style/prism.js")
                 ;; NOTE: It creates `async=""`. I prefer `async` only, but the value is required for XHTML.
                 (async ""))
              ;; NOTE: empty body is required for self-closing tag
              "")
      ;; NOTE: `org-export-data' returns HTML
      (title (*RAW-STRING* ,(concat (my-strip-html (org-export-data (plist-get info :title) info)) " - toybeam")))))

;; Returns `<header>' SXML
(defun my-html-header (info)
    `(header (@ (role "banner"))
             ;; `org-export-data' returns raw HTML
             (h1 (*RAW-STRING* ,(org-export-data (plist-get info :title) info)))
             ;; timestamp
             (p ,(org-export-data (org-export-get-date info "%b %e, %Y") info))
             (nav (@ (role "navigation"))
                  (a (@ (href "/")) "Home")
                  (a (@ (href "https://github.com/toyboot4e")) "GitHub"))))

;; Returns `<footer>' SXML
(defun my-html-footer (info)
    `(footer (@ (role "contentinfo"))
             (*RAW-STRING* "<p>Styled with <a href=\"https://simplecss.org/\">Simple.css</a></p>")
             (div
              (a (@ (href "/")) "Home")
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
(defun roygbyte/org-html-src-block (src-block _contents info)
    "Transcode a SRC-BLOCK element from Org to HTML.
  CONTENTS holds the contents of the item.  INFO is a plist holding
  contextual information."
    (if (org-export-read-attribute :attr_html src-block :textarea)
            (org-html--textarea-block src-block)
        (let* ((lang (org-element-property :language src-block))
               (code (org-html-format-code src-block info))
               (label (let ((lbl (org-html--reference src-block info t)))
                          (if lbl (format " id=\"%s\"" lbl) "")))
               (klipsify  (and  (plist-get info :html-klipsify-src)
                                (member lang '("javascript" "js"
                                               "ruby" "scheme" "clojure" "php" "html")))))
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
                                (format "<pre><code class=\"src language-%s\"%s%s>%s</code></pre>"
                                        lang
                                        label
                                        (if (string= lang "html")
                                                " data-editor-type=\"html\""
                                            "")
                                        code)
                            (format "<pre><code class=\"src language-%s\"%s>%s</code></pre>"
                                    lang label code)))))))

;;; Backend (setup)

;; Set up `my-site-html' backend:
(progn
    (org-export-define-derived-backend
     'my-site-html
     'html ;; 'slimhtml

     :translate-alist
     '((template . my-org-html-template)
       (src-block . roygbyte/org-html-src-block)))
    )

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

;; FIXME: don't repeat twice
(when-let ((arg (elt argv 1)))
    (cond ((or (string= arg "-r") (string= arg "--release"))
           (setq build-target "release"))
          ((or (string= arg "-d") (string= arg "--draft"))
           (setq build-target "draft"))
          ((or (string= arg "-f") (string= arg "--force"))
           (setq force-flag t))))

(when-let ((arg (elt argv 2)))
    (cond ((or (string= arg "-r") (string= arg "--release"))
           (setq build-target "release"))
          ((or (string= arg "-d") (string= arg "--draft"))
           (setq build-target "draft"))
          ((or (string= arg "-f") (string= arg "--force"))
           (setq force-flag t))))

(message (concat "Target: " build-target " force flag: " (symbol-name force-flag)))
(message "--------------------------------------------------------------------------------")

(org-publish-remove-all-timestamps)

(if force-flag
        (org-publish build-target t)
    (org-publish build-target))

(message "--------------------------------------------------------------------------------")
(message "Build complete!")

