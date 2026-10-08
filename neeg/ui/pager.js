// Swipeable tab pages. A transform-based track moved by touch swipes; tabs switch on tap
// and with arrow keys. (CSS scroll-snap was tried first, but live data updates made Chrome
// re-snap and cancel page changes mid-animation.) Each page scrolls vertically on its own.

export function createPager({ pager, track, tabs, tabbar, storageKey }) {
  const pages = [...track.children];
  let current = 0;
  const listeners = new Set();

  new ResizeObserver(() =>
    document.documentElement.style.setProperty('--bar-h', tabbar.offsetHeight + 'px')).observe(tabbar);

  function goTo(i) {
    current = Math.max(0, Math.min(pages.length - 1, i));
    track.style.transform = `translateX(${-100 * current}%)`;
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', k === current); t.tabIndex = k === current ? 0 : -1; });
    pages.forEach((p, k) => { p.inert = k !== current; });
    try { localStorage.setItem(storageKey, current); } catch {}
    for (const fn of listeners) fn(current);
  }

  // Horizontal swipe on touch/pen; vertical movement is left to the page's own scrolling.
  let swipe = null;
  track.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    swipe = { x: e.clientX, y: e.clientY, dx: 0, axis: null };
  });
  track.addEventListener('pointermove', e => {
    if (!swipe) return;
    swipe.dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (!swipe.axis && Math.hypot(swipe.dx, dy) > 10) swipe.axis = Math.abs(swipe.dx) > Math.abs(dy) ? 'x' : 'y';
    if (swipe.axis !== 'x') return;
    const atEdge = (current === 0 && swipe.dx > 0) || (current === pages.length - 1 && swipe.dx < 0);
    track.classList.add('dragging');
    track.style.transform = `translateX(calc(${-100 * current}% + ${atEdge ? swipe.dx / 3 : swipe.dx}px))`;
  });
  function endSwipe() {
    if (!swipe) return;
    const { axis, dx } = swipe;
    swipe = null;
    track.classList.remove('dragging');
    if (axis !== 'x') return;
    const threshold = Math.min(80, pager.clientWidth * 0.2);
    goTo(current + (dx < -threshold ? 1 : dx > threshold ? -1 : 0));
  }
  track.addEventListener('pointerup', endSwipe);
  track.addEventListener('pointercancel', endSwipe);

  tabs.forEach((t, i) => {
    t.onclick = () => goTo(i);
    t.onkeydown = e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { const n = (i + d + pages.length) % pages.length; goTo(n); tabs[n].focus(); }
    };
  });

  let saved = 0;
  try { saved = +localStorage.getItem(storageKey) || 0; } catch {}
  track.classList.add('dragging'); // no slide animation on first paint
  goTo(saved);
  requestAnimationFrame(() => requestAnimationFrame(() => track.classList.remove('dragging')));

  return {
    goTo,
    get current() { return current; },
    onChange(fn) { listeners.add(fn); },
  };
}
