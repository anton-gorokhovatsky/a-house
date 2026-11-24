// Original compositions use a different drawing width at each breakpoint.
// Scale the composition as a whole so photographs and their captions stay together.
const boards = Array.from(document.querySelectorAll('.t396__artboard[data-artboard-screens]'));
const venuePrograms = document.querySelectorAll('[data-venue-program]');
if (venuePrograms.length) {
  const dateInMoscow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' });
  function refreshVenuePrograms() {
    const today = dateInMoscow.format(new Date());
    for (const program of venuePrograms) {
      for (const item of program.querySelectorAll('[data-venue-end]')) item.hidden = item.dataset.venueEnd < today;
      program.querySelector('[data-venue-empty]').hidden = !!program.querySelector('li:not([hidden])');
    }
  }
  refreshVenuePrograms();
  window.addEventListener('pageshow', refreshVenuePrograms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVenuePrograms(); });
  window.setInterval(refreshVenuePrograms, 60000);
}
function fitCompositions() {
  const width = document.documentElement.clientWidth;
  for (const board of boards) {
    const sizes = board.dataset.artboardScreens.split(',').map(Number).sort((a, b) => a - b);
    const design = sizes.filter(size => size <= width).pop() || sizes[0];
    let mode = board.dataset.artboardUpscale;
    for (const size of [...sizes].reverse()) {
      if (size >= design) mode = board.getAttribute('data-artboard-upscale-res-' + size) || mode;
    }
    const scale = mode === 'window' ? width / design : 1;
    board.style.zoom = String(scale);
    board.style.setProperty('--artboard-scale', String(scale));
    board.style.width = mode === 'window' ? design + 'px' : '';
    // Coordinates can inherit from a larger breakpoint. The last coordinate
    // stays valid; the centre of that larger drawing does not.
    const activeSizes=[...sizes].reverse().filter(size=>size>=design);
    for (const node of board.children) {
      const prefix=node.hasAttribute('data-group-id')?'group':node.hasAttribute('data-elem-id')?'field':null;
      if (!prefix) continue;
      const field=name=>{
        let value=node.getAttribute('data-'+prefix+'-'+name+'-value');
        for(const size of activeSizes) value=node.getAttribute('data-'+prefix+'-'+name+'-res-'+size+'-value')??value;
        return value;
      };
      const left=field('left');
      if (left===null || (field('container')||'grid')!=='grid' || (field('axisx')||'left')!=='left' || field('leftunits')!=='px') continue;
      if (Number.isFinite(Number(left))) node.style.left='calc(50% - '+design/2+'px + '+Number(left)+'px)';
    }
    board.classList.add('t396__artboard_rendered');
  }
}
fitCompositions();
let pendingFrame = 0;
window.addEventListener('resize', () => {
  cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(fitCompositions);
});

// The text and photographs share an artboard on the original spreads.
const readingBoards = [...document.querySelectorAll('[data-reading-scene]')];
for (const board of readingBoards) {
  board.style.setProperty('--reading-rows', String(board.querySelectorAll('[data-type-role]').length));
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Opt in only for the link the visitor just activated. Direct entry, focus,
// browser history and a visitor's own scrolling keep their native behaviour.
let followingAnchor = false;
document.addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (reduced.matches || !link?.hash || link.origin !== location.origin || link.pathname !== location.pathname ||
      link.search !== location.search || link.classList.contains('skip-content') || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || link.hasAttribute('download') ||
      (link.target && link.target !== '_self')) return;
  followingAnchor = true;
  document.documentElement.setAttribute('data-anchor-scroll', '');
  requestAnimationFrame(() => document.documentElement.removeAttribute('data-anchor-scroll'));
}, true);
function interruptAnchorScroll() {
  if (!followingAnchor) return;
  followingAnchor = false;
  window.scrollTo({ left: scrollX, top: scrollY, behavior: 'instant' });
}
window.addEventListener('wheel', interruptAnchorScroll, { passive: true });
window.addEventListener('pointerdown', interruptAnchorScroll, { passive: true });
window.addEventListener('keydown', event => {
  if (['Tab', ' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) interruptAnchorScroll();
});
document.addEventListener('scrollend', () => { followingAnchor = false; });
window.addEventListener('pagehide', () => { followingAnchor = false; });
function fitReadingText() {
  const largeType = parseFloat(getComputedStyle(document.documentElement).fontSize) > 20;
  for (const board of readingBoards) {
    board.classList.toggle('reading-flow', largeType || (reduced.matches && board.hasAttribute('data-cycling-copy')));
  }
}
fitReadingText();
reduced.addEventListener('change', fitReadingText);

const header = document.querySelector('.site-header');
if (header) {
  const menu = header.querySelector('.site-navigation');
  const toggle = header.querySelector('.site-menu-toggle');
  const headerLinks = [...header.querySelectorAll('a[href]')];
  const presence = header.querySelector('.site-nav-presence');
  const trigger = presence?.querySelector('button');
  const submenu = presence?.querySelector('.site-submenu');
  const compact = matchMedia('(max-width: 61.25em)');

  function openSubmenu(open) {
    if (!submenu || !trigger) return;
    trigger.setAttribute('aria-expanded', String(open));
    submenu.hidden = !open;
  }
  function openMenu(open) {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    menu.hidden = compact.matches && !open;
    if (!open) openSubmenu(false);
  }
  function measureHeader() {
    fitReadingText();
    document.documentElement.style.setProperty('--site-header-height', header.getBoundingClientRect().height + 'px');
  }

  header.dataset.navReady = '';
  openMenu(false);
  measureHeader();
  new ResizeObserver(measureHeader).observe(header);
  compact.addEventListener('change', () => {
    if (compact.matches && menu.contains(document.activeElement)) toggle.focus({preventScroll: true});
    const focused = document.activeElement;
    if (!compact.matches && (focused === toggle || (header.contains(focused) && !focused.getClientRects().length))) {
      header.querySelector('.site-header-brand').focus({preventScroll: true});
    }
    openMenu(false);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) openMenu(false); });
  toggle.addEventListener('click', () => openMenu(menu.hidden));
  trigger?.addEventListener('click', () => openSubmenu(submenu.hidden));
  trigger?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openSubmenu(true);
      submenu.querySelector('a').focus();
    }
  });
  function dismissOutside(target) {
    if (!presence?.contains(target)) openSubmenu(false);
    if (!header.contains(target)) openMenu(false);
  }
  document.addEventListener('click', event => dismissOutside(event.target));
  document.addEventListener('focusin', event => dismissOutside(event.target));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (submenu && !submenu.hidden) { openSubmenu(false); trigger.focus({ preventScroll: true }); }
    else if (toggle.getAttribute('aria-expanded') === 'true') { openMenu(false); toggle.focus({ preventScroll: true }); }
  });
  menu.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || !link.hash || link.origin !== location.origin || link.pathname !== location.pathname ||
        link.search !== location.search || toggle.getAttribute('aria-expanded') !== 'true') return;
    const target = document.getElementById(link.hash.slice(1));
    if (!target) return;
    if (target.tabIndex < 0) target.tabIndex = -1;
    openMenu(false);
    // A selection may reveal its target as part of the fragment navigation.
    requestAnimationFrame(() => {
      if (document.activeElement === document.body || menu.contains(document.activeElement)) {
        target.focus({ preventScroll: true });
      }
    });
  });
  for (const link of headerLinks) {
    if (link.origin === location.origin && link.pathname === location.pathname && !link.hash) link.setAttribute('aria-current', 'page');
  }
}

const archiveList = document.querySelector('.publication-catalog, [data-page="special_projects"] main');

// Browsers restore the URL on Back. Restore the place to continue reading or tabbing as well.
document.addEventListener('click', event => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href]');
  if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self') || !/^https?:$/.test(link.protocol)) return;
  if (link.origin === location.origin && link.pathname === location.pathname && link.search === location.search) return;
  // The responsive archive separately restores the corresponding visible occurrence of an article.
  if (archiveList?.contains(link) && link.origin === location.origin && /\/tpost\//.test(link.pathname)) {
    if (history.state?.visitorReturn) {
      const state = { ...history.state };
      delete state.visitorReturn;
      history.replaceState(state, '');
    }
    return;
  }
  const matches = [...document.links].filter(item => item.href === link.href);
  const visitorReturn = { href: link.href, occurrence: matches.indexOf(link), top: link.getBoundingClientRect().top };
  history.replaceState({ ...history.state, visitorReturn }, '');
});

window.addEventListener('pageshow', event => {
  const entry = history.state?.visitorReturn;
  if (!entry || !(event.persisted || performance.getEntriesByType('navigation')[0]?.type === 'back_forward')) return;
  const link = [...document.links].filter(item => item.href === entry.href)[entry.occurrence];
  if (!link) return;
  for (let details = link.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
  requestAnimationFrame(() => {
    let target = link;
    if (link.closest('.site-navigation[hidden]')) target = header?.querySelector('.site-menu-toggle');
    else if (link.closest('.site-submenu[hidden]')) target = header?.querySelector('.site-presence-toggle');
    if (!target?.getClientRects().length) return;
    target.focus({ preventScroll: true });
    if (target === link) window.scrollBy({ top: link.getBoundingClientRect().top - entry.top, behavior: 'instant' });
  });
});

if (archiveList) {
  const list = archiveList;
  const articles = [...list.querySelectorAll('a[href]')].filter(link =>
    link.origin === location.origin && /\/tpost\/[^/]+\/?$/.test(link.pathname));
  const matchingLinks = path => articles.filter(link => link.pathname === path);

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const state = { ...history.state };
    if (articles.includes(link)) {
      state.articleReturn = {
        path: link.pathname, occurrence: matchingLinks(link.pathname).indexOf(link), top: link.getBoundingClientRect().top
      };
    } else if (state.articleReturn) {
      delete state.articleReturn;
    } else return;
    history.replaceState(state, '');
  });

  window.addEventListener('pageshow', event => {
    const entry = history.state?.articleReturn;
    if (!entry) return;
    const returning = event.persisted || window.navigation?.activation?.navigationType === 'traverse' ||
      performance.getEntriesByType?.('navigation')?.[0]?.type === 'back_forward';
    if (!returning) return;
    const matches = matchingLinks(entry.path);
    const original = matches[entry.occurrence];
    const link = original?.getClientRects().length ? original : matches.find(item => item.getClientRects().length);
    if (!link) return;
    link.focus({ preventScroll: true });
    // WebKit can restore scroll before the responsive project layout has settled.
    requestAnimationFrame(() => {
      if (document.activeElement !== link) return;
      const shift = link.getBoundingClientRect().top - entry.top;
      if (Math.abs(shift) > 1) window.scrollBy({ top: shift, behavior: 'instant' });
    });
  });
}

for (const gallery of document.querySelectorAll('.archive-gallery')) {
  const track = gallery.querySelector('.archive-gallery-track');
  if (!track) continue;
  const slides = [...track.querySelectorAll('img')];
  if (slides.length < 2) {
    track.removeAttribute('tabindex');
    continue;
  }
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', 'Просмотр изображений');
  const controls = document.createElement('div');
  controls.className = 'archive-gallery-controls';
  const strip = document.createElement('div');
  strip.className = 'archive-gallery-thumbs';
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Выбрать изображение');
  const status = document.createElement('span');
  status.dataset.galleryStatus = '';
  status.setAttribute('role', 'status');
  const buttons = slides.map((slide, index) => {
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.tabIndex = -1;
    const number = 'Фото ' + (index + 1) + ' из ' + slides.length;
    pick.setAttribute('aria-label', slide.alt ? number + '. ' + slide.alt : number);
    const thumb = document.createElement('img');
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.sizes = '60px';
    if (slide.srcset) thumb.srcset = slide.srcset;
    thumb.src = slide.src;
    pick.append(thumb);
    pick.addEventListener('click', () => show(index));
    strip.append(pick);
    return pick;
  });
  controls.append(strip, status);
  gallery.append(controls);
  let current = -1;
  function show(index) {
    track.scrollTo({ left: index * track.clientWidth, behavior: 'instant' });
    update();
  }
  const update = () => {
    const position = Math.max(0, Math.min(slides.length - 1, Math.round(track.scrollLeft / (track.clientWidth || 1))));
    if (position === current) return;
    if (current >= 0) {
      buttons[current].removeAttribute('aria-current');
      buttons[current].tabIndex = -1;
    }
    current = position;
    const selected = buttons[current];
    selected.setAttribute('aria-current', 'true');
    selected.tabIndex = 0;
    status.textContent = (current + 1) + ' из ' + slides.length;
    const item = selected.getBoundingClientRect();
    const rail = strip.getBoundingClientRect();
    if (item.left < rail.left + 4) strip.scrollLeft += item.left - rail.left - 4;
    if (item.right > rail.right - 4) strip.scrollLeft += item.right - rail.right + 4;
  };
  gallery.addEventListener('keydown', event => {
    const origin = buttons.indexOf(event.target);
    if (event.target !== track && origin < 0) return;
    const start = origin < 0 ? current : origin;
    const next = { ArrowLeft: start - 1, ArrowRight: start + 1, Home: 0, End: slides.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const index = Math.max(0, Math.min(slides.length - 1, next));
    show(index);
    if (origin >= 0) buttons[index].focus({ preventScroll: true });
  });
  track.addEventListener('scroll', update, { passive: true });
  new ResizeObserver(update).observe(track);
  update();
}
for (const video of document.querySelectorAll('[data-archive-video]')) {
  video.querySelector('button')?.addEventListener('click',event => {
    const player = document.createElement('iframe');
    player.src='https://www.youtube-nocookie.com/embed/'+video.dataset.archiveVideo;
    player.title='Видео публикации A–House';
    player.allowFullscreen=true;
    player.referrerPolicy='strict-origin-when-cross-origin';
    event.currentTarget.replaceWith(player);
  });
}
