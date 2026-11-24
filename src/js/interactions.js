/* Independent interaction layer for the preserved A-House markup.
 * It reads authored DOM/data only. No Tilda runtime, jQuery or source eval.
 * Store/product dialogs and submitting forms belong to services.js.
 */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const initialized = new WeakSet();
  const dialogs = [];
  let unique = 0;
  const id = (node, prefix) => node.id || (node.id = `${prefix}-${++unique}`);
  const visible = node => !!node && !node.closest('[hidden], [inert]') && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const focusables = node => $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])', node).filter(element => element.tabIndex >= 0 && visible(element));
  const layoutChanged = node => {
    window.dispatchEvent(new Event('resize'));
    node.dispatchEvent(new CustomEvent('ahouse:contentchange', { bubbles: true }));
  };
  const button = (label, className, text) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = className;
    node.setAttribute('aria-label', label);
    node.textContent = text;
    return node;
  };
  const pauseMedia = node => $$('video,audio', node).forEach(media => media.pause());

  // Preserve each dialog's original ancestors and their styling. Only the
  // branches outside the active dialog are inert; closing restores prior state.
  function openDialog(node, origin, close, backdrop = null) {
    if (dialogs.some(dialog => dialog.node === node)) return;
    const inert = [];
    let branch = node;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling !== backdrop && sibling instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK', 'DIALOG'].includes(sibling.tagName)) {
          inert.push([sibling, sibling.inert]);
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-hidden', 'false');
    node.tabIndex = -1;
    dialogs.push({ node, origin, close, inert, previousOverflow });
    requestAnimationFrame(() => (focusables(node)[0] || node).focus({ preventScroll: true }));
  }
  function releaseDialog(node, returnFocus = true) {
    const index = dialogs.findIndex(dialog => dialog.node === node);
    if (index < 0) return;
    const dialog = dialogs[index];
    // Nested states close from the top; never release the lower dialog's lock.
    for (let i = dialogs.length - 1; i > index; i--) dialogs[i].close(false);
    dialogs.splice(index, 1);
    dialog.inert.reverse().forEach(([element, wasInert]) => { element.inert = wasInert; });
    document.body.style.overflow = dialog.previousOverflow;
    node.setAttribute('aria-hidden', 'true');
    pauseMedia(node);
    if (returnFocus && visible(dialog.origin)) dialog.origin.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', event => {
    const dialog = dialogs[dialogs.length - 1];
    if (!dialog || $('dialog[open]:not([data-interaction-dialog])')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    } else if (event.key === 'Tab') {
      const stops = focusables(dialog.node);
      if (!stops.length) { event.preventDefault(); dialog.node.focus(); return; }
      const first = stops[0], last = stops[stops.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.node.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.node.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    }
  });

  const popupMap = new Map();
  function setupPopups() {
    const widePanel = matchMedia('(min-width: 960px)');
    let desktopDefault;
    $$('.t-popup[data-tooltip-hook]').forEach(popup => {
      if (initialized.has(popup) || popup.closest('.t776,.t-store,.t706') || $('form', popup)) return;
      initialized.add(popup);
      const hook = popup.dataset.tooltipHook;
      const hooks = hook.startsWith('#') ? [hook] : [hook, '#' + hook, '#popup:' + hook];
      const bankPanel = popup.dataset.popupDisabledBg === 'y';
      const background = popup.nextElementSibling?.classList.contains('t-popup__bg') ? popup.nextElementSibling : null;
      let opened = false, nonModal = false, openedByDefault = false, currentOrigin = null, previousOverflow = '';
      const triggers = () => $$('a[href]').filter(link => hooks.includes(link.dataset.popupTrigger || link.getAttribute('href')));
      const triggerState = on => triggers().forEach(link => {
        link.setAttribute('aria-expanded', String(on));
        link.setAttribute('aria-controls', id(popup, 'ah-program-panel'));
      });
      const content = $('.t-popup__container', popup) || popup;
      for (const recordId of (popup.dataset.popupRecIds || '').split(/[\s,]+/).filter(Boolean)) {
        const record = document.getElementById(recordId.replace(/^#/, ''));
        if (record && !record.contains(popup)) {
          content.appendChild(record);
          record.hidden = false;
          record.removeAttribute('aria-hidden');
          record.classList.add('ah-popup-record');
        }
      }
      popup.classList.add('ah-legacy-dialog');
      popup.hidden = true;
      popup.setAttribute('aria-hidden', 'true');
      if (!popup.hasAttribute('aria-label') && !popup.hasAttribute('aria-labelledby')) {
        const heading = $('h1,h2,h3,.t-title,.t-name,[data-elem-type="text"] .tn-atom', content);
        if (heading && heading.textContent.trim()) popup.setAttribute('aria-labelledby', id(heading, 'ah-dialog-title'));
        else popup.setAttribute('aria-label', 'Подробности');
      }
      const close = (returnFocus = true) => {
        if (!opened) return;
        if (nonModal) {
          document.body.style.overflow = previousOverflow;
          popup.setAttribute('aria-hidden', 'true');
          if (returnFocus && visible(currentOrigin)) currentOrigin.focus({ preventScroll: true });
        } else releaseDialog(popup, returnFocus);
        popup.classList.remove('t-popup_show', 'ah-interaction-open', 'ah-nonmodal-panel');
        if (background) background.classList.remove('t-popup__bg-active');
        popup.hidden = true;
        opened = false;
        triggerState(false);
        if (returnFocus && bankPanel && hooks.includes(location.hash)) {
          history.replaceState(history.state, '', location.pathname + location.search);
          if (visible(currentOrigin)) currentOrigin.scrollIntoView({block:'nearest', behavior:'instant'});
        }
      };
      const open = (origin, byDefault = false) => {
        if (opened) return;
        if (bankPanel) [...new Set(popupMap.values())].filter(other => other.popup !== popup && other.bankPanel).forEach(other => other.close(false));
        const controls = triggers();
        currentOrigin = origin || controls.find(link => link.hasAttribute('data-panel-title')) || controls[0] || null;
        openedByDefault = byDefault;
        nonModal = bankPanel && widePanel.matches;
        popup.hidden = false;
        popup.classList.add('t-popup_show', 'ah-interaction-open');
        popup.classList.toggle('ah-nonmodal-panel', nonModal);
        if (background && !bankPanel) background.classList.add('t-popup__bg-active');
        if (nonModal) {
          previousOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
          popup.setAttribute('role', 'region');
          popup.removeAttribute('aria-modal');
          popup.setAttribute('aria-hidden', 'false');
        } else openDialog(popup, currentOrigin, close);
        opened = true;
        triggerState(true);
        layoutChanged(popup);
      };
      const entry = { popup, open, close, bankPanel, isOpen: () => opened };
      if (bankPanel) widePanel.addEventListener('change', () => {
        if (!opened) return;
        const origin = currentOrigin;
        close(false);
        if (!openedByDefault || widePanel.matches) open(origin, openedByDefault);
      });
      if (bankPanel && popup.dataset.popupOpenOnPageLoad === 'y') desktopDefault ??= entry;
      for (const key of hooks) popupMap.set(key, entry);
      $$('.t-popup__close-wrapper,.t-popup__close', popup).forEach(control => {
        if (control.tagName !== 'BUTTON' && !control.querySelector('button')) {
          control.tabIndex = 0;
          control.setAttribute('role', 'button');
          control.setAttribute('aria-label', 'Закрыть');
          control.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); close(); }
          });
        }
        control.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close(); });
      });
      popup.addEventListener('click', event => { if (!nonModal && event.target === popup) close(); });
      triggerState(false);
    });
    if (!setupPopups.bound) {
      setupPopups.bound = true;
      document.addEventListener('click', event => {
        const link = event.target.closest('a[href],[data-popup-trigger]');
        if (!link || link.closest('[data-catalog-open],[data-service-order],[data-service-request],[data-service-live],.services-dialog') || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        let key = link.dataset.popupTrigger || link.getAttribute('href');
        let entry = popupMap.get(key);
        if (!entry) {
          try {
            const url = new URL(key, location.href);
            if (url.origin === location.origin && url.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '')) entry = popupMap.get(url.hash);
            // The author used the literal hook "rules" for Longevity's panel.
            if (!entry && url.origin === location.origin) entry = popupMap.get(url.pathname.replace(/^\//, '').replace(/\/$/, ''));
          } catch (_) { /* Non-URL actions are left to their owning module. */ }
        }
        if (entry) { event.preventDefault(); if (entry.bankPanel && entry.isOpen()) entry.close(); else entry.open(link); }
      });
      const hashOpen = () => {
        const entry = popupMap.get(location.hash);
        if (entry) entry.open(null);
      };
      window.addEventListener('hashchange', hashOpen);
      document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || dialogs.length || $('dialog[open]')) return;
        const entry = [...new Set(popupMap.values())].find(item => item.bankPanel && item.isOpen());
        if (entry) { event.preventDefault(); entry.close(); }
      });
      hashOpen();
    }
    if (!location.hash && widePanel.matches) desktopDefault?.open(null, true);
  }

  function setupAccordions() {
    const groups = new Map();
    $$('[class*="uc-accord-"]').forEach(record => {
      const key = [...record.classList].find(token => /^uc-accord-[a-z]+-\d+$/.test(token));
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });
    const entries = [];
    for (const [key, records] of groups) {
      const heading = records[0];
      if (records.length < 2 || initialized.has(heading)) continue;
      initialized.add(heading);
      const panels = records.slice(1);
      heading.classList.add('title-accord', 'ah-accordion-heading');
      heading.setAttribute('role', 'button');
      heading.tabIndex = 0;
      const texts = $$('[data-elem-type="text"] .tn-atom', heading).map(node => node.textContent.trim()).filter(text => text && text !== '+');
      heading.setAttribute('aria-label', texts.join('. '));
      heading.setAttribute('aria-controls', panels.map(panel => id(panel, 'ah-accordion-panel')).join(' '));
      $$('.accord-icon', heading).forEach(icon => icon.setAttribute('aria-hidden', 'true'));
      panels.forEach(panel => panel.classList.add('content-accord', 'ah-accordion-panel'));
      const entry = { key, heading, panels, open: false };
      const set = open => {
        entry.open = open;
        heading.classList.toggle('active-accord', open);
        heading.setAttribute('aria-expanded', String(open));
        panels.forEach(panel => {
          panel.hidden = !open;
          panel.classList.toggle('hide-accord', !open);
          panel.classList.toggle('open-accord', open);
          panel.style.maxHeight = open ? 'none' : '0px';
          if (!open) pauseMedia(panel);
        });
      };
      entry.set = set;
      set(false);
      entries.push(entry);
      const toggle = () => {
        const top = heading.getBoundingClientRect().top;
        const willOpen = !entry.open;
        entries.filter(other => other !== entry && other.key.split('-')[2] === key.split('-')[2]).forEach(other => other.set(false));
        set(willOpen);
        layoutChanged(heading);
        const delta = heading.getBoundingClientRect().top - top;
        if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'instant' });
      };
      heading.addEventListener('click', event => {
        if (event.target.closest('a[href],button,input,select,textarea')) return;
        toggle();
      });
      heading.addEventListener('keydown', event => {
        if (event.target !== heading) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
      });
    }
  }

  function setupHorizontalAccordion() {
    const root = $('#hacc');
    if (!root || initialized.has(root)) return;
    initialized.add(root);
    const items = $$('.hacc__item', root);
    const mobile = matchMedia('(max-width: 959px)');
    const set = (selected, user = false) => {
      items.forEach((item, index) => {
        const on = index === selected;
        const head = $('.hacc__head', item);
        const panel = document.getElementById(head.getAttribute('aria-controls'));
        item.classList.toggle('is-active', on);
        head.setAttribute('aria-expanded', String(on));
        head.tabIndex = !mobile.matches && on ? -1 : 0;
        if (panel) {
          panel.inert = !on;
          panel.setAttribute('aria-hidden', String(!on));
          panel.tabIndex = -1;
          if (user && on && !mobile.matches) requestAnimationFrame(() => {
            if (!panel.inert && !mobile.matches) panel.focus({ preventScroll: true });
          });
        }
      });
      root.dataset.active = String(selected + 1);
    };
    items.forEach((item, index) => {
      const head = $('.hacc__head', item);
      head.addEventListener('click', () => set(item.classList.contains('is-active') && mobile.matches ? -1 : index, true));
      head.addEventListener('keydown', event => {
        const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
        if (delta) { event.preventDefault(); const next = (index + delta + items.length) % items.length; set(next, true); }
      });
    });
    const resize = () => {
      let index = items.findIndex(item => item.classList.contains('is-active'));
      if (!mobile.matches && index < 0) index = 0;
      set(index);
    };
    mobile.addEventListener('change', resize);
    resize();
  }

  function setupMoscow() {
    const grid = $('#ah-grid'), modal = $('#ah-modal');
    if (!grid || !modal || initialized.has(grid)) return;
    initialized.add(grid);
    const overlay = $('#ah-overlay');
    let visualTimers = [];
    const clearVisualTimers = () => { visualTimers.forEach(clearTimeout); visualTimers = []; };
    const measureModal = () => modal.style.setProperty('--half', `${modal.getBoundingClientRect().height / 2}px`);
    window.addEventListener('resize', () => { if (!modal.hidden) measureModal(); });
    modal.hidden = true;
    modal.classList.add('ah-authored-dialog');
    if (overlay) overlay.hidden = true;
    const close = (returnFocus = true) => {
      clearVisualTimers();
      releaseDialog(modal, returnFocus);
      modal.classList.remove('open', 'drawn', 'split', 'instant');
      modal.hidden = true;
      if (overlay) { overlay.classList.remove('open'); overlay.hidden = true; }
    };
    function open(card, origin) {
      const template = $('template[data-event-detail]', card);
      if (!template) return;
      for (const [field, target] of [['date','meta'],['title','title'],['lead','lead'],['desc','desc'],['spk','spk']]) {
        const node = $(`#ah-m-${target}`);
        const source = $(`[data-event-field="${field}"]`, template.content);
        node.textContent = field === 'spk' ? `Спикеры: ${source?.textContent || 'уточняются'}` : source?.textContent || '';
        node.hidden = field === 'lead' && !node.textContent;
      }
      const image = $('.img img', card);
      const target = $('#ah-m-img');
      target.replaceChildren();
      if (image) { const copy = image.cloneNode(); copy.loading = 'eager'; target.append(copy); }
      clearVisualTimers();
      modal.hidden = false;
      modal.classList.remove('drawn', 'split');
      modal.classList.add('open', 'instant');
      measureModal();
      void modal.offsetWidth;
      modal.classList.remove('instant');
      if (reduced.matches) modal.classList.add('drawn', 'split');
      else {
        visualTimers.push(setTimeout(() => modal.classList.add('drawn'), 120));
        visualTimers.push(setTimeout(() => modal.classList.add('split'), 420));
      }
      if (overlay) { overlay.hidden = false; overlay.classList.add('open'); }
      $('.modal-scroll', modal).scrollTop = 0;
      openDialog(modal, origin, close, overlay);
    }
    grid.addEventListener('click', event => {
      const card = event.target.closest('[data-event-card]');
      if (card) open(card, event.target.closest('button') || $('[data-event-open]', card));
    });
    $('#ah-m-close')?.addEventListener('click', () => close());
    overlay?.addEventListener('click', () => close());
    $$('#ah-arc .arc-row').forEach(head => {
      const panel = document.getElementById(head.getAttribute('aria-controls'));
      if (panel) panel.inert = true;
      head.addEventListener('click', () => {
        const on = !head.closest('.arc-item').classList.contains('open');
        $$('#ah-arc .arc-item').forEach(item => {
          const selected = on && item.contains(head);
          item.classList.toggle('open', selected);
          $('.arc-row', item).setAttribute('aria-expanded', String(selected));
          const body = $('.arc-body', item);
          body.inert = !selected;
          body.setAttribute('aria-hidden', String(!selected));
          $('.pm', item).textContent = selected ? '−' : '+';
        });
      });
    });
  }

  function setupPhotoRing() {
    const stage = $('#ah-stage'), hero = $('.ah-hero .hero');
    if (!stage || !hero || initialized.has(stage)) return;
    const photos = $$('.ph[data-ring-width]', stage);
    if (!photos.length) return;
    initialized.add(stage);
    let geometry, arc, widths, offsets, position = .75, velocity = 0, frameId = 0, lastTime = 0, elapsed = 0, pointer = null;
    const angle = fraction => {
      const distance = ((fraction % 1) + 1) % 1 * arc[arc.length - 1];
      let low = 0, high = arc.length - 1;
      while (high - low > 1) { const mid = (high + low) >> 1; if (arc[mid] < distance) low = mid; else high = mid; }
      return (low + (distance - arc[low]) / (arc[high] - arc[low] || 1)) * Math.PI * 2 / (arc.length - 1);
    };
    const measure = () => {
      const mobile = innerWidth <= 760, w = stage.clientWidth, h = stage.clientHeight;
      geometry = { x:w/2, y:h*(mobile?.5:.48), rx:w*(mobile?.37:.35), ry:h*(mobile?.32:.31), tilt:(mobile?-24:-16)*Math.PI/180 };
      widths = photos.map(photo => {
        const width = Number(mobile ? photo.dataset.ringMobile : photo.dataset.ringWidth) * w * .0085;
        const height = width * Number(photo.dataset.ringRatio);
        photo.style.width = `${width}px`; photo.style.height = `${height}px`;
        return { width, height };
      });
      arc = [0];
      for (let n=1;n<=720;n++) { const a=n/720*Math.PI*2,b=(n-1)/720*Math.PI*2; arc.push(arc[n-1]+Math.hypot(geometry.rx*(Math.cos(a)-Math.cos(b)),geometry.ry*(Math.sin(a)-Math.sin(b)))); }
      offsets = photos.map((_, index) => index / photos.length);
      place();
    };
    const place = () => {
      const { x,y,rx,ry,tilt } = geometry, cosine=Math.cos(tilt), sine=Math.sin(tilt), length=arc[arc.length-1];
      if (!length) return;
      // Preserve spacing along the tilted ellipse as differently sized photos move.
      for (let pass=0;pass<3;pass++) {
        const extents=widths.map((size,i)=>{const a=angle(position+offsets[i]),tx=-Math.sin(a)*rx,ty=Math.cos(a)*ry,gx=tx*cosine-ty*sine,gy=tx*sine+ty*cosine,n=Math.hypot(gx,gy)||1;return (Math.abs(size.width*gx)+Math.abs(size.height*gy))/n;});
        const gap=(length-extents.reduce((sum,n)=>sum+n,0))/photos.length;let distance=0;
        offsets=extents.map((size,i)=>{if(i)distance+=extents[i-1]/2+gap+size/2;return distance/length;});
      }
      photos.forEach((photo,i)=>{const a=angle(position+offsets[i]),ex=Math.cos(a)*rx,ey=Math.sin(a)*ry;photo.style.transform=`translate3d(${x+ex*cosine-ey*sine-widths[i].width/2}px,${y+ex*sine+ey*cosine-widths[i].height/2}px,0)`;});
    };
    const tick = now => {
      if (reduced.matches || document.hidden) { frameId = 0; lastTime = now; return; }
      const dt=Math.min((now-lastTime)/1000 || 0,.05);lastTime=now;elapsed+=dt;
      if(elapsed<5)position=.75+.04*Math.sin(elapsed/5*Math.PI/2);
      else {position+=velocity*dt;velocity*=Math.exp(-dt*1.6);}
      place();frameId=0;
      if(!reduced.matches && !document.hidden && (elapsed<5 || velocity>1e-5))frameId=requestAnimationFrame(tick);
    };
    const run = () => { if (!frameId && !reduced.matches && !document.hidden) {lastTime=performance.now();frameId=requestAnimationFrame(tick);} };
    hero.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || reduced.matches) return;
      if(pointer && elapsed>=5) {velocity=Math.min(.03,velocity+Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)*.00003);run();}
      pointer={x:event.clientX,y:event.clientY};
    });
    hero.addEventListener('pointerleave',()=>{pointer=null;});
    reduced.addEventListener('change',()=>{cancelAnimationFrame(frameId);frameId=0;velocity=0;if(!reduced.matches)run();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimationFrame(frameId);frameId=0;}else run();});
    new ResizeObserver(measure).observe(stage);
    measure();run();
  }

  function setupImageGalleries() {
    $$('[data-elem-type="gallery"][data-field-imgs-value]').forEach(container => {
      const holder = $('.tn-atom__gallery', container);
      if (!holder || initialized.has(holder)) return;
      if (!$('[data-image-slide]', holder)) {
        let images;
        try {
          images = JSON.parse(container.getAttribute('data-field-imgs-value'));
        } catch (_) {
          return;
        }
        images.filter(image => image.li_img).forEach(image => {
          const slide = document.createElement('figure');
          slide.className = 'ah-image-slide';
          slide.dataset.imageSlide = '';
          const img = document.createElement('img');
          img.loading = 'lazy';
          img.decoding = 'async';
          img.alt = image.li_imgalt || '';
          img.src = image.li_img;
          slide.append(img);
          holder.append(slide);
        });
      }
      const slides = $$('[data-image-slide]', holder);
      if (!slides.length) return;
      initialized.add(holder);
      holder.classList.add('ah-image-gallery');
      holder.setAttribute('role', 'region');
      holder.setAttribute('aria-label', 'Фотографии Дома A-House');
      const multiple = slides.length > 1;
      const seconds = Number(container.getAttribute('data-field-slds_autoplay-value')) || 0;
      const automatic = multiple && seconds > 0;
      holder.id ||= 'ah-gallery-' + container.dataset.elemId;
      if (multiple) holder.tabIndex = 0;

      let index = 0;
      let paused = false;
      let timer = 0;
      let inView = false;
      let explicitPlay = false;
      const controls = document.createElement('div');
      controls.className = 'ah-gallery-controls';
      const navigation = document.createElement('div');
      navigation.className = 'ah-gallery-navigation';
      const prev = button('Предыдущая фотография', 'ah-gallery-prev', '←');
      const next = button('Следующая фотография', 'ah-gallery-next', '→');
      const pause = button('Пауза — остановить смену фотографий', 'ah-gallery-pause', 'Пауза');
      const count = document.createElement('span');
      count.className = 'ah-gallery-count';
      const announcement = document.createElement('span');
      announcement.className = 'ah-gallery-announcement';
      announcement.setAttribute('aria-live', 'polite');
      announcement.setAttribute('aria-atomic', 'true');
      for (const control of [prev, next, pause]) {
        control.setAttribute('aria-controls', holder.id);
      }
      navigation.append(prev, count, next);
      controls.append(navigation, pause);
      holder.append(controls);
      holder.append(announcement);

      function show(n, announce = false) {
        index = (n + slides.length) % slides.length;
        slides.forEach((slide, i) => {
          slide.hidden = i !== index;
        });
        count.textContent = `${index + 1} / ${slides.length}`;
        if (announce) announcement.textContent = `Фотография ${index + 1} из ${slides.length}`;
      }

      function canRotate() {
        const interacting = holder.matches(':hover') || holder.contains(document.activeElement);
        return automatic && !paused && !reduced.matches && inView && !document.hidden
          && (!interacting || explicitPlay);
      }

      function scheduleRotation() {
        clearInterval(timer);
        timer = 0;
        if (canRotate()) {
          timer = setInterval(() => show(index + 1), Math.max(3, seconds) * 1000);
        }
      }

      function syncPauseControl() {
        pause.hidden = !automatic || reduced.matches;
        pause.textContent = paused ? 'Продолжить' : 'Пауза';
        const label = paused ? 'Продолжить смену фотографий' : 'Пауза — остановить смену фотографий';
        pause.setAttribute('aria-label', label);
        pause.title = label;
      }

      function setPaused(nextPaused) {
        paused = nextPaused;
        // An explicit request to resume also works while its button has focus.
        explicitPlay = !paused;
        syncPauseControl();
        scheduleRotation();
      }

      function moveTo(n) {
        explicitPlay = false;
        show(n, true);
        scheduleRotation();
      }

      prev.addEventListener('click', () => moveTo(index - 1));
      next.addEventListener('click', () => moveTo(index + 1));
      pause.addEventListener('click', () => setPaused(!paused));
      holder.addEventListener('keydown', event => {
        if (event.target !== holder || !multiple) return;
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (event.key === 'Home' || event.key === 'End') {
          moveTo(event.key === 'Home' ? 0 : slides.length - 1);
        } else {
          moveTo(index + (event.key === 'ArrowRight' ? 1 : -1));
        }
      });

      let touch = null;
      holder.addEventListener('pointerdown', event => {
        if (!multiple || event.pointerType === 'mouse' || event.target.closest('button,a')) return;
        touch = { x: event.clientX, y: event.clientY };
      });
      holder.addEventListener('pointerup', event => {
        if (!touch) return;
        const dx = event.clientX - touch.x;
        const dy = event.clientY - touch.y;
        touch = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          moveTo(index + (dx < 0 ? 1 : -1));
        }
      });
      holder.addEventListener('pointercancel', () => {
        touch = null;
      });

      function resetInteractionOverride() {
        explicitPlay = false;
        requestAnimationFrame(scheduleRotation);
      }
      for (const type of ['mouseenter', 'mouseleave', 'focusin', 'focusout']) {
        holder.addEventListener(type, resetInteractionOverride);
      }
      document.addEventListener('visibilitychange', scheduleRotation);
      reduced.addEventListener('change', () => {
        syncPauseControl();
        scheduleRotation();
      });
      new IntersectionObserver(entries => {
        inView = entries[0].isIntersecting;
        if (inView) {
          slides.forEach(slide => {
            const img = $('img', slide);
            if (img) img.loading = 'eager';
          });
        }
        scheduleRotation();
      }, { threshold: .05 }).observe(holder);

      controls.hidden = !multiple;
      show(0);
      syncPauseControl();
      scheduleRotation();
    });
  }

  function setupHorizontalGalleries() {
    const known=['rec2291514171','rec2415560171','rec3656770101','rec3670555301','rec3672450901','rec3674146901'];
    const records=[...new Set([...$$('[data-horizontal-gallery]'),...known.map(key=>document.getElementById(key)).filter(Boolean)])];
    records.forEach(record=>{
      const scene=$('.t396__artboard',record);if(!scene||initialized.has(scene))return;
      initialized.add(scene);record.classList.add('ah-horizontal-gallery');scene.classList.add('ah-horizontal-scene');scene.tabIndex=0;scene.setAttribute('role','region');scene.setAttribute('aria-label','Галерея: прокрутка влево и вправо');
      const controls=document.createElement('div');controls.className='ah-scroll-controls';
      const prev=button('Прокрутить влево','ah-scroll-prev','←'),next=button('Прокрутить вправо','ah-scroll-next','→');controls.append(prev,next);record.append(controls);
      const update=()=>{const max=scene.scrollWidth-scene.clientWidth;controls.hidden=max<8;scene.classList.toggle('ah-can-scroll',max>=8);prev.disabled=scene.scrollLeft<4;next.disabled=scene.scrollLeft>=max-4;};
      const scroll=direction=>{scene.scrollBy({left:direction*scene.clientWidth*.8,behavior:reduced.matches?'instant':'smooth'});};
      prev.addEventListener('click',()=>scroll(-1));next.addEventListener('click',()=>scroll(1));
      scene.addEventListener('keydown',event=>{if(event.target!==scene)return;if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();if(event.key==='Home'||event.key==='End')scene.scrollTo({left:event.key==='Home'?0:scene.scrollWidth,behavior:'instant'});else scroll(event.key==='ArrowRight'?1:-1);}});
      let drag=null,suppressClick=false;
      scene.addEventListener('pointerdown',event=>{if(event.pointerType!=='mouse'||event.button!==0||event.target.closest('a,button,input,select,textarea'))return;drag={x:event.clientX,left:scene.scrollLeft,pointer:event.pointerId,moved:false};});
      scene.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x;if(Math.abs(dx)>6||drag.moved){if(!drag.moved){scene.setPointerCapture(drag.pointer);drag.moved=true;scene.classList.add('is-dragging');}event.preventDefault();scene.scrollLeft=drag.left-dx;}});
      const end=()=>{if(!drag)return;suppressClick=drag.moved;drag=null;scene.classList.remove('is-dragging');setTimeout(()=>{suppressClick=false;},0);};
      scene.addEventListener('pointerup',end);scene.addEventListener('pointercancel',end);scene.addEventListener('lostpointercapture',end);scene.addEventListener('dragstart',event=>event.preventDefault());
      scene.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();}},true);
      scene.addEventListener('scroll',update,{passive:true});new ResizeObserver(update).observe(scene);record.addEventListener('ahouse:contentchange',update);window.addEventListener('resize',update);update();
    });
  }

  function setupVideo() {
    $$('.institution-video[data-content-video-url-youtube]').forEach(host => {
      const videoId = host.dataset.contentVideoUrlYoutube;
      if (initialized.has(host) || !/^[\w-]{11}$/.test(videoId)) return;
      initialized.add(host);
      host.hidden = false;
      host.classList.add('ah-video-player');
      const provider = 'https://www.youtube-nocookie.com';
      const play = button('Смотреть фильм об A–House', 'ah-video-play', 'Смотреть фильм');
      const poster = $('img', host);
      const status = host.nextElementSibling;
      const reducedData = matchMedia('(prefers-reduced-data: reduce)');
      let frame, handshake, timeout;
      let seenEnough = false, onScreen = false, attempted = false, requested = false;
      host.append(play);

      function send(message) {
        frame?.contentWindow?.postMessage(JSON.stringify({ ...message, id: frame.id, channel: 'widget' }), provider);
      }

      function clearLoading() {
        clearInterval(handshake);
        clearTimeout(timeout);
      }

      function showPoster(error) {
        const returnFocus = frame && document.activeElement === frame;
        clearLoading();
        frame?.remove();
        frame = null;
        poster.hidden = false;
        play.hidden = false;
        play.removeAttribute('aria-disabled');
        play.textContent = error ? 'Попробовать ещё раз' : 'Смотреть фильм';
        play.setAttribute('aria-label', play.textContent);
        status.textContent = error ? 'Не удалось загрузить фильм в плеере.' : '';
        if (returnFocus) play.focus({ preventScroll: true });
      }

      window.addEventListener('message', event => {
        if (!frame || event.source !== frame.contentWindow || event.origin !== provider) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message) return;
        if (message.event === 'onError' || message.info?.videoData?.errorCode) {
          showPoster(true);
        } else if (message.event === 'onReady') {
          send({ event: 'command', func: 'addEventListener', args: ['onError'] });
          clearLoading();
          frame.classList.add('film-ready');
          frame.removeAttribute('aria-hidden');
          frame.tabIndex = 0;
          const transferFocus = requested && document.activeElement === play;
          play.hidden = true;
          poster.hidden = true;
          if (transferFocus) frame.focus({ preventScroll: true });
        }
      });

      function start(manual) {
        if (frame) return;
        requested = manual;
        attempted = true;
        status.textContent = '';
        play.textContent = 'Загружаем фильм…';
        play.setAttribute('aria-label', play.textContent);
        play.setAttribute('aria-disabled', 'true');
        frame = document.createElement('iframe');
        frame.id = 'about-film-player';
        frame.title = host.dataset.videoTitle;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        frame.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture';
        frame.allowFullscreen = true;
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        const params = new URLSearchParams({ autoplay: '1', mute: '1', controls: '1', playsinline: '1', enablejsapi: '1', origin: location.origin, rel: '0' });
        frame.src = `${provider}/embed/${videoId}?${params}`;
        frame.addEventListener('error', event => {
          if (event.currentTarget === frame) showPoster(true);
        }, { once: true });
        host.prepend(frame);
        // The embedded player announces readiness over postMessage. The iframe's
        // own load event can also fire for a blocked or failed document.
        handshake = setInterval(() => send({ event: 'listening' }), 250);
        timeout = setTimeout(() => showPoster(true), 12000);
      }

      function checkPlayback() {
        const saveData = reducedData.matches || navigator.connection?.saveData;
        if (document.hidden || !onScreen || reduced.matches || saveData) {
          if (frame && !requested) {
            if (frame.classList.contains('film-ready')) send({ event: 'command', func: 'pauseVideo', args: [] });
            else showPoster(false);
          }
        } else if (!attempted && seenEnough) start(false);
      }

      play.addEventListener('click', () => start(true));
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => {
          seenEnough = entry.intersectionRatio >= .5;
          onScreen = entry.isIntersecting;
          checkPlayback();
        }, { threshold: [0, .5] }).observe(host);
        document.addEventListener('visibilitychange', checkPlayback);
        reduced.addEventListener('change', checkPlayback);
        reducedData.addEventListener('change', checkPlayback);
        navigator.connection?.addEventListener?.('change', checkPlayback);
      }
    });
  }

  function setupSectionTracking() {
    const links=$$('.brand-1,.brand-2,.brand-3');
    if(!links.length||initialized.has(links[0]))return;initialized.add(links[0]);
    const pairs=[['brand-1','rec3882403501'],['brand-2','rec3908590501'],['brand-3','rec3908765201']].map(([cls,key])=>({nodes:$$(`.${cls}`),target:document.getElementById(key)})).filter(pair=>pair.target);
    const activate=pair=>{pairs.forEach(p=>p.nodes.forEach(node=>{node.classList.toggle('active',p===pair);if(p===pair)node.setAttribute('aria-current','location');else node.removeAttribute('aria-current');}));};
    const observer=new IntersectionObserver(entries=>{const entry=entries.find(item=>item.isIntersecting);if(entry)activate(pairs.find(pair=>pair.target===entry.target));},{rootMargin:'-40% 0px -40% 0px'});
    pairs.forEach(pair=>{observer.observe(pair.target);pair.nodes.forEach(node=>node.addEventListener('click',()=>activate(pair)));});
  }

  function init() {
    setupPopups();setupAccordions();setupHorizontalAccordion();setupMoscow();setupPhotoRing();setupImageGalleries();setupHorizontalGalleries();setupVideo();setupSectionTracking();
  }
  window.AHouseInteractions={refresh:init};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
