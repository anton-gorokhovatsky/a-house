// Original compositions use a different drawing width at each breakpoint.
// Scale the composition as a whole so photographs and their captions stay together.
const boards = Array.from(document.querySelectorAll('.t396__artboard[data-artboard-screens]'));
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
  const presence = header.querySelector('.site-nav-presence');
  const trigger = presence.querySelector('button');
  const submenu = presence.querySelector('.site-submenu');
  const compact = matchMedia('(max-width: 61.25em)');

  function openSubmenu(open) {
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
    if (!compact.matches && document.activeElement === toggle) header.querySelector('.site-header-brand').focus({preventScroll: true});
    openMenu(false);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) openMenu(false); });
  toggle.addEventListener('click', () => openMenu(menu.hidden));
  trigger.addEventListener('click', () => openSubmenu(submenu.hidden));
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openSubmenu(true);
      submenu.querySelector('a').focus();
    }
  });
  function dismissOutside(target) {
    if (!presence.contains(target)) openSubmenu(false);
    if (!header.contains(target)) openMenu(false);
  }
  document.addEventListener('click', event => dismissOutside(event.target));
  document.addEventListener('focusin', event => dismissOutside(event.target));
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!submenu.hidden) { openSubmenu(false); trigger.focus(); }
    else if (toggle.getAttribute('aria-expanded') === 'true') { openMenu(false); toggle.focus(); }
  });
  for (const link of header.querySelectorAll('a[href]')) {
    if (link.origin === location.origin && link.pathname === location.pathname && !link.hash) link.setAttribute('aria-current', 'page');
  }
}

for (const button of document.querySelectorAll('button.t-cover__arrow')) {
  button.addEventListener('click', () => {
    const section = button.closest('.t-rec')?.nextElementSibling;
    if (!section) return;
    section.tabIndex = -1;
    section.focus({preventScroll: true});
    section.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth'});
  });
}
for (const gallery of document.querySelectorAll('.archive-gallery')) {
  const track = gallery.querySelector('.archive-gallery-track');
  const controls = gallery.querySelector('.archive-gallery-controls');
  if (!controls || !track) continue;
  const multiple = track.children.length > 1;
  controls.hidden = !multiple;
  if (!multiple) track.removeAttribute('tabindex');
  track.setAttribute('role', 'region');
  track.setAttribute('aria-label', 'Фотографии публикации');
  const index = () => Math.min(track.children.length - 1,
    Math.max(0, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
  const update = () => {
    const current = index();
    controls.querySelector('[data-gallery-status]').textContent = (current + 1) + ' / ' + track.children.length;
    controls.firstElementChild.disabled = current === 0;
    controls.lastElementChild.disabled = current === track.children.length - 1;
  };
  const move = (step, instant = false) => {
    track.scrollTo({
      left: (index() + step) * track.clientWidth,
      behavior: instant || reduced.matches ? 'instant' : 'smooth'
    });
  };
  controls.addEventListener('click', event => {
    const step = event.target.closest('[data-gallery-step]');
    if (!step) return;
    move(Number(step.dataset.galleryStep), event.detail === 0);
  });
  track.addEventListener('keydown', event => {
    if (event.target !== track || !multiple) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') {
      track.scrollTo({
        left: event.key === 'Home' ? 0 : track.scrollWidth,
        behavior: 'instant'
      });
    } else {
      move(event.key === 'ArrowRight' ? 1 : -1, true);
    }
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
