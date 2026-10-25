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
  nav.addEventListener(
    "wheel",
    (e) => {
      // pinch-zoom and trackpad sideways swipes stay native; a bar that fits
      // leaves the wheel to the page
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || maxScroll() <= 0) return;
      e.preventDefault();
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? nav.clientWidth : 1;
      nav.scrollLeft += e.deltaY * unit;
    },
    { passive: false },
  );
  nav.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
}
