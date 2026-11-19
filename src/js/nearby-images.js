// Runs before the body. If this script is unavailable, the stylesheet shows
// every photograph normally. Covers and ordinary <img> elements load in HTML.
(() => {
  if (!('IntersectionObserver' in window)) return;
  const attribute = 'data-load-on-approach';
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.removeAttribute(attribute);
        observer.unobserve(entry.target);
      }
    }
  }, { rootMargin: '900px 0px' });

  document.addEventListener('DOMContentLoaded', () => {
    for (const image of document.querySelectorAll('[' + attribute + ']')) {
      observer.observe(image);
    }
  }, { once: true });
  document.documentElement.classList.add('defer-offscreen-images');
})();
