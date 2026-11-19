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

const header = document.querySelector('#t-header');
if (header) {
  const toggle = header.querySelector('.t-menuburger');
  const menu = header.querySelector('.t454');
  const trigger = header.querySelector('[data-menu-submenu-hook]:not([data-menu-submenu-hook=""])');
  const submenu = header.querySelector('.t-menusub__menu');
  function openMenu(open) {
    if (!menu || !toggle) return;
    menu.classList.toggle('site-menu-open', open);
    toggle.classList.toggle('t-menuburger-opened',open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label',open ? 'Закрыть меню' : 'Открыть меню');
    if (!open) openSubmenu(false);
  }
  function openSubmenu(open) {
    if (!trigger || !submenu) return;
    submenu.classList.toggle('site-submenu-open',open);
    trigger.setAttribute('aria-expanded',String(open));
  }
  if (toggle && menu) {
    toggle.setAttribute('aria-controls',menu.id);
    menu.setAttribute('role','navigation');
    menu.setAttribute('aria-label','Основное меню');
    openMenu(false);
    toggle.addEventListener('click',() => openMenu(toggle.getAttribute('aria-expanded') !== 'true'));
  }
  if (trigger && submenu) {
    submenu.id='presence-submenu';
    trigger.setAttribute('aria-controls',submenu.id);
    trigger.setAttribute('role','button');
    trigger.setAttribute('href','#presence-submenu');
    trigger.addEventListener('click',event => {
      event.preventDefault();
      openSubmenu(trigger.getAttribute('aria-expanded') !== 'true');
    });
    trigger.addEventListener('keydown',event => {
      if (event.key===' ') { event.preventDefault(); trigger.click(); }
      if (event.key==='ArrowDown') { event.preventDefault(); openSubmenu(true); submenu.querySelector('a')?.focus(); }
    });
    document.addEventListener('click',event => {
      if (!trigger.contains(event.target) && !submenu.contains(event.target)) openSubmenu(false);
    });
    header.addEventListener('focusout',event => {
      if (!header.contains(event.relatedTarget)) openSubmenu(false);
    });
  }
  document.addEventListener('keydown',event => {
    if (event.key!=='Escape') return;
    if (trigger?.getAttribute('aria-expanded')==='true') { openSubmenu(false); trigger.focus(); }
    else if (toggle?.getAttribute('aria-expanded')==='true') { openMenu(false); toggle.focus(); }
  });
  for (const link of header.querySelectorAll('a[href]')) {
    if (link.origin===location.origin && link.pathname===location.pathname && !link.hash) link.setAttribute('aria-current','page');
  }
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
for (const button of document.querySelectorAll('button.t-cover__arrow')) {
  button.addEventListener('click', () => {
    const section = button.closest('.t-rec')?.nextElementSibling;
    section?.scrollIntoView({behavior: reduced.matches ? 'instant' : 'smooth'});
  });
}
for (const gallery of document.querySelectorAll('.archive-gallery')) {
  const track = gallery.querySelector('.archive-gallery-track');
  const controls = gallery.querySelector('.archive-gallery-controls');
  if (!controls || !track) continue;
  const index = () => Math.min(track.children.length-1, Math.max(0,Math.round(track.scrollLeft/Math.max(1,track.clientWidth))));
  const update = () => {
    controls.querySelector('[data-gallery-status]').textContent = (index()+1)+' / '+track.children.length;
    controls.firstElementChild.disabled = index()===0;
    controls.lastElementChild.disabled = index()===track.children.length-1;
  };
  controls.addEventListener('click',event => {
    const step = event.target.closest('[data-gallery-step]');
    if (!step) return;
    track.scrollTo({left:(index()+Number(step.dataset.galleryStep))*track.clientWidth,behavior:reduced.matches?'instant':'smooth'});
  });
  track.addEventListener('scroll',update,{passive:true});
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
