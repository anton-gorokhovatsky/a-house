// An old bookmark opens the corresponding place in the publications section.
// This parser-blocking script runs before the static fallback can be painted.
(() => {
  const destination = new URL(document.currentScript.dataset.destination, location.href);
  destination.search = location.search;
  if (location.hash && !['#site-content', '#allrecords'].includes(location.hash)) destination.hash = location.hash;
  document.documentElement.hidden = true;
  location.replace(destination.href);
})();
