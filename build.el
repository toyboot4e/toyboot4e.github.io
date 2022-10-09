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
    ;; Allow generating code block HTML
    (package-install 'htmlize)

    ;; Create HTML from S-expressions
    (package-install 'esxml)
    (require 'esxml)

    (defun pp-sxml-to-xml (sxml)
        (pp-esxml-to-xml (sxml-to-esxml sxml)))

    ;; ;; TODO: any difference?
    ;; (load-file "ox-slimhtml.el")

    (require 'ox-publish))

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
                        :section-numbers t
                        :with-author nil
                        :with-creator nil
                        :with-toc nil
                        ;; `index.html' generation:
                        :auto-sitemap t
                        :sitemap-filename "index.org"
                        :sitemap-title "Index"
                        :sitemap-style list ;; list | tree
                        :sitemap-sort-files anti-chronologically))

(setq org-publish-project-alist
      `(
        ;; build modes:
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

;; HTML_CONTAINER article

;;; Style

;; Remove `validate' link at the bottom
(setq org-html-validation-link nil)

;; Remove `<!-- $timestamp -->' from the output HTML
(setq org-export-time-stamp-file nil)

(setq org-export-with-timestamps t)

;; Add link to each heading
(setq org-html-self-link-headlines t)

;; `<DOCTYPE!>' and `<html>'
(setq org-html-doctype "html5"
      org-export-default-language "ja")

;; (setq org-html-container-element "article")

;; Custom theme
(setq org-html-head-include-scripts nil       ;; Use our own scripts
      org-html-head-include-default-style nil ;; Use our own styles

      ;; TODO: taken from system crafter
      org-html-html5-fancy nil
      org-html-htmlize-output-type 'css

      ;; Thanks:
      ;; - simple.css: https://github.com/kevquirk/simple.css
      ;; - Prism.js: https://prismjs.com
      org-html-head (concat "<link rel=\"stylesheet\" href=\"https://cdn.simplecss.org/simple.min.css\">"
                            "\n"
                            "<link rel=\"stylesheet\" href=\"style/style.css\" />"
                            "\n"
                            "<link rel=\"stylesheet\" href=\"style/prism.css\" />"
                            "\n"
                            "<script src=\"/style/prism.js\" async></script>"
                            )

      org-html-preamble (with-temp-buffer
                            (insert-file-contents "src/style/preamble.html")
                            (buffer-string))

      org-html-postamble (with-temp-buffer
                             (insert-file-contents "src/style/postamble.html")
                             (buffer-string)))

;;; Backend

;; NOTE:
;; - Generate XHTML from SXML using the `esxml' package
;; - Raw HTML can be embedded into SXML using `*RAW-HTML'
;; - `org-export-data' returns document property

;; Returns `<head>' SXML
(defun my-html-head (info)
    ;; TODO: try `esxml-html'.. though it's not on MELPA?
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
      (script (@ (href "/style/prism.js")
                 ;; NOTE: It creates `async="async=`. I prefer `async` only, but the value is required for XHTML.
                 (async))
              ;; NOTE: empty body is required for self-closing tag
              "")
      ;; FIXME: remove html tags (especially code tag) from the metadata
      (title ,(concat (org-export-data (plist-get info :title) info) " - toybeam"))))

;; Returns `<header>' SXML
(defun my-html-header (info)
    `(header (@ (href "/"))
             (nav
              (a (@ (href "/")) "toybeam"))
             (h1 (*RAW-STRING* ,(org-export-data (plist-get info :title) info)))
             ;; TODO: smaller text with dimmed color
             ;; timestamp
             (p ,(org-export-data (org-export-get-date info "%B %e, %Y") info))))

;; Returns `<footer>' SXML
(defun my-html-footer (info)
    `(footer
      (nav
       (a (@ (href "/")) "Home")
       (a (@ (href "https://github.com/toyboot4e")) "GitHub"))))

;; Thanks: `https://github.com/SystemCrafters/systemcrafters.github.io/blob/master/publish.el'
(defun my-org-html-template (contents info)
    (concat
     "<!DOCTYPE html>\n"
     (pp-sxml-to-xml
      `(html (@ (lang "ja"))
             ,(my-html-head info)

             (body
              ,(my-html-header info)

              (main
               (*RAW-STRING* ,contents))

              ,(my-html-footer info)
              )))))

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

(defun my-org-html-publish-to-html (plist filename pub-dir)
  "Publish an org file to HTML, using the FILENAME as the output directory."
  (org-publish-org-to 'my-site-html filename
                      (concat (when (> (length org-html-extension) 0) ".")
                              (or (plist-get plist :html-extension)
                                  org-html-extension
                                  "html"))
                      plist pub-dir))

(org-export-define-derived-backend
 'my-site-html
 'html
 ;; 'slimhtml

 :translate-alist
 '((template . my-org-html-template)
   (src-block . roygbyte/org-html-src-block))

 ;; TODO: remove? taken from system crafter
 :options-alist
 '((:page-type "PAGE-TYPE" nil nil t)
   (:html-use-infojs nil nil nil))
 )

;;; Build

;; target mode in the `org-publish-project-alist':
(setq target-mode (elt argv 1))

(unless target-mode
    ;; fallback to draft mode
    (setq target-mode "draft"))

(message (concat "Target: " target-mode))

(org-publish target-mode t)

(message "Build complete!")

