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
        ;; `index.html' generation:
        :auto-sitemap t
        :sitemap-filename "index.org"
        :sitemap-title "toybeam"
        :sitemap-function my-org-sitemap-function
        :sitemap-format-entry my-org-sitemap-format-entry
        ;; :sitemap-style list ;; list | tree
        ;; REMARK: It doesn't take effect. See the sort in `my-org-sitemap-function'.
        :sitemap-sort-files chronologically))

(setq org-publish-project-alist
      `(
        ;; build targets:
        ("release" :components ("static" "release-posts"))
        ("draft" :components ("static" "release-posts" "draft-posts"))

        ;; components:
        ("release-posts" ,@base-attrs
         :base-directory "./src/"
         ;; :exclude ".*"
         ;; :include ,(mapcar (lambda (x) (concat "./src/" x)) (directory-files "./src" nil "\\.org$"))
         )
        ("draft-posts" ,@base-attrs
         :base-directory "./draft"
         )

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

(defun my-org-sitemap-function (title list)
    (let* ((f (lambda (entry) (format "- %s" (car entry))))
           ;; Alphabetical sort:
           (list2 (sort (mapcar f (cdr list)) #'string<))
           (xs (mapconcat 'identity list2 "\n")))
        (concat "#+TITLE: " title "\n\n"
                "#+ATTR_HTML: :class sitemap" "\n"
                xs)))

(defun my-org-sitemap-format-entry (entry style project)
    (cond ((not (directory-name-p entry))
           (let* ((date (org-publish-find-date entry project)))
               (format "@@html:<date>%s</date>@@ [[file:%s][%s]]"
                       (format-time-string "%F" date)
                       entry
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
      ;; NOTE: `org-export-data' returns HTML, so we'll remove HTML tags
      (title (*RAW-STRING* ,(concat (my-strip-html (org-export-data (plist-get info :title) info)) " - toybeam")))
      (meta (@ (name "description")
               (content "devlog of toyboot4e")))
      ;; (link (@ (rel "stylesheet")
      ;;          (href "https://cdn.simplecss.org/simple.min.css")))
      (link (@ (rel "stylesheet")
               (href "/style/simple.min.css")))
      (link (@ (rel "stylesheet")
               (href "/style/style.css")))
      (link (@ (rel "stylesheet")
               (href "/style/prism.css")))
      (script (@ (type "text/javascript")
                 ;; NOTE: It creates `async=""`. I prefer `async` only, but the value is required for XHTML.
                 (async "")
                 (src "/style/prism.js"))
              ;; NOTE: empty body is required for self-closing tag
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
          (let ((fragment (concat "coderef-" (org-html-encode-plain-text path))))
	          (format "<a href=\"#%s\" %s%s>%s</a>"
		              fragment
		              (format "class=\"coderef\" onmouseover=\"CodeHighlightOn(this, \
'%s');\" onmouseout=\"CodeHighlightOff(this, '%s');\""
			                  fragment fragment)
		              attributes
		              (format (org-export-get-coderef-format path desc)
			                  (org-export-resolve-coderef path info)))))
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
;;; Backend (setup)

;; Set up `my-site-html' backend:
(org-export-define-derived-backend
 'my-site-html
 my-base-backend

 :translate-alist
 '((template . my-org-html-template)
   (src-block . roygbyte/org-html-src-block)
   (center-block . my-org-html-center-block)
   (link . my-org-html-link)
   ))

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

