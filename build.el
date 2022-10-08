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
    ;; (package-install 'esxml)
    ;; (require 'esxml)

    (require 'ox-publish))

;;; Settings: `https://orgmode.org/org.html#Publishing-options'
(setq org-publish-project-alist
      `(("posts"
         :base-directory "./src"
         :base-extension "org"
         :publishing-directory "./out"
         :recursive t
         ;; Custom function defined below
         :publishing-function my-org-html-publish-to-html
         :section-numbers t
         :with-author nil
         :with-creator nil
         :time-stamp-file nil
         :with-toc nil
         :auto-sitemap t
         :sitemap-filename "index.org"
         :sitemap-title "Index"
         :sitemap-style list ;; tree
         :sitemap-sort-files anti-chronologically)

        ("static"
         :base-directory "./src"
         :base-extension "js\\|css\\|png\\|jpg\\|gif"
         :publishing-directory  "./out"
         :recursive t
         :publishing-function org-publish-attachment)))

;; Remove `validate' link at the bottom
(setq org-html-validation-link nil)

;; Add link to each heading
(setq org-html-self-link-headlines t)

;; Use custom CSS
(setq org-html-head-include-scripts nil       ;; Use our own scripts
      org-html-head-include-default-style nil ;; Use our own styles

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

(org-export-define-derived-backend 'my-site-html
                                   'html ;; 'slimhtml
                                   :translate-alist
                                   '((src-block . roygbyte/org-html-src-block)))

(defun my-org-html-publish-to-html (plist filename pub-dir)
  "Publish an org file to HTML, using the FILENAME as the output directory."
  (org-publish-org-to 'my-site-html filename
                      (concat (when (> (length org-html-extension) 0) ".")
                              (or (plist-get plist :html-extension)
                                  org-html-extension
                                  "html"))
                      plist pub-dir))

;;; Build
(org-publish-all t)

(message "Build complete!")

