;; Build script
;;
;; Thanks:
;; - https://systemcrafters.net/publishing-websites-with-org-mode/building-the-site/
;; - https://taingram.org/blog/org-mode-blog.html

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
         :publishing-function org-html-publish-to-html
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

;; Surround title text with `<a>' tag link
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
                            ;; "\n"
                            ;; "<link rel=\"stylesheet\" href=\"style/prism.css\" />"
                            ;; "\n"
                            ;; "<script src=\"/style/prism.js\" async></script>"
                            )

      org-html-preamble (with-temp-buffer
                            (insert-file-contents "src/style/preamble.html")
                            (buffer-string))

      org-html-postamble (with-temp-buffer
                             (insert-file-contents "src/style/postamble.html")
                             (buffer-string)))

;; Use custom export functions
(defun ox-mrkup-filter-code
        (text back-end info)
    (format "<code>%s</code>" text))

;;; Build
(org-publish-all t)

(message "Build complete!")

