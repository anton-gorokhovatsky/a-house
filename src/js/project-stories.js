// Without scripting all stories remain ordinary articles with working fragment URLs.
const panels = new Map();
const openers = new Map();
let current;
let opener;
let closingFromHistory = false;
const fragment = () => location.hash.slice(1) === 'popup:infoblock' ? 'organizers' : location.hash.slice(1);

function closeStory() {
  if (!current) return;
  if (history.state?.projectStory === current) {
    if (!closingFromHistory) history.back();
    closingFromHistory = true;
  } else {
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(history.state, '', url);
    showLocation();
  }
}

function showLocation() {
  closingFromHistory = false;
  const target = fragment();
  if (target === current) return;
  if (current) {
    panels.get(current).close();
    document.documentElement.classList.remove('project-story-open');
    current = null;
    opener?.focus({ preventScroll: true });
  }
  const dialog = panels.get(target);
  if (dialog) {
    current = target;
    opener = openers.get(target);
    dialog.showModal();
    dialog.scrollTop = 0;
    document.documentElement.classList.add('project-story-open');
  } else if (target) {
    const disclosure = document.getElementById(target)?.closest('details');
    if (disclosure) disclosure.open = true;
  }
}

for (const article of document.querySelectorAll('[data-story-panel]')) {
  const dialog = document.createElement('dialog');
  dialog.className = 'project-dialog';
  dialog.setAttribute('aria-labelledby', article.getAttribute('aria-labelledby'));
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'story-close';
  close.textContent = 'Закрыть';
  close.addEventListener('click', closeStory);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeStory(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) closeStory();
  });
  article.before(dialog);
  dialog.append(close, article);
  panels.set(article.id, dialog);
}

for (const link of document.querySelectorAll('main a[href^="#"]')) {
  const id = link.hash.slice(1);
  if (!panels.has(id)) continue;
  openers.set(id, link);
  link.setAttribute('aria-haspopup', 'dialog');
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openers.set(id, link);
    history.pushState({ ...history.state, projectStory: id }, '', link.hash);
    showLocation();
  });
}
window.addEventListener('popstate', showLocation);
window.addEventListener('hashchange', showLocation);
window.addEventListener('pageshow', showLocation);
showLocation();
