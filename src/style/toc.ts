// Table-of-contents scrollspy: marks the `#toc` link for the heading the reader
// is currently under with `aria-current="true"` (styled by the ToC CSS). The ToC
// list itself is generated statically at build time (build/render.tsx buildToc);
// this is the only ToC JS, and it ships only on pages that have a ToC. Replaces
// the scrollspy tocbot used to provide.

const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#toc a[href^='#']"));

if (links.length) {
  // heading element -> its ToC link, in document (scroll) order
  const linkFor = new Map<HTMLElement, HTMLAnchorElement>();
  for (const a of links) {
    const el = document.getElementById(decodeURIComponent(a.hash.slice(1)));
    if (el) linkFor.set(el, a);
  }
  const headings = Array.from(linkFor.keys());

  let active: HTMLAnchorElement | null = null;
  const setActive = (a: HTMLAnchorElement | null) => {
    if (a === active) return;
    active?.removeAttribute("aria-current");
    active = a;
    active?.setAttribute("aria-current", "true");
  };

  const update = () => {
    // the current section is the last heading whose top has scrolled above the
    // line; headings are in order, so stop at the first one still below it.
    const line = 120;
    let cur: HTMLElement | null = null;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= line) cur = h;
      else break;
    }
    setActive(linkFor.get(cur ?? headings[0]) ?? null);
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      update();
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onScroll, { passive: true });
  update();
}
