// Header nav: on narrow windows the bar scrolls sideways (style.css). A mouse
// wheel only sends vertical deltas, so turn them sideways; while the bar
// overflows, the wheel never scrolls the page from it (input past either end is
// dropped). The edge with more buttons beyond it fades out (`fade-start` /
// `fade-end`, style.css).

const nav = document.querySelector<HTMLElement>("body > header > nav");

if (nav) {
  const maxScroll = (): number => nav.scrollWidth - nav.clientWidth;

  const update = (): void => {
    nav.classList.toggle("fade-start", nav.scrollLeft > 1);
    nav.classList.toggle("fade-end", nav.scrollLeft < maxScroll() - 1);
  };

  const LINE_PX = 16;
  const wheelUnit = (e: WheelEvent): number => {
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return LINE_PX;
    }
    if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      return nav.clientWidth;
    }
    return 1;
  };
  nav.addEventListener(
    "wheel",
    (e) => {
      // pinch-zoom and trackpad sideways swipes stay native; a bar that fits
      // leaves the wheel to the page
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || maxScroll() <= 0) {
        return;
      }
      e.preventDefault();
      nav.scrollLeft += e.deltaY * wheelUnit(e);
    },
    { passive: false },
  );
  nav.addEventListener("scroll", update, { passive: true });
  globalThis.addEventListener("resize", update);
  update();
}
