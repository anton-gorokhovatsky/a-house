(function () {
  var root  = document.getElementById('hacc');
  if (!root) return;
  var items = Array.prototype.slice.call(root.querySelectorAll('.hacc__item'));
  var mq    = window.matchMedia('(max-width: 959px)');   // мобильная версия

  function head(item) { return item.querySelector('.hacc__head'); }

  function setState(item, on) {
    item.classList.toggle('is-active', on);
    head(item).setAttribute('aria-expanded', on ? 'true' : 'false');
  }

  function open(item) {
    items.forEach(function (it) { setState(it, it === item); });
    root.setAttribute('data-active', items.indexOf(item) + 1);
  }

  items.forEach(function (item) {
    head(item).addEventListener('click', function () {
      if (!item.classList.contains('is-active')) {
        open(item);
      } else if (mq.matches) {
        setState(item, false);        // на мобильном открытую вкладку можно закрыть
      }
    });
  });

  // при переходе на десктоп одна вкладка должна быть открыта всегда
  function ensureOpen() {
    if (!mq.matches && !root.querySelector('.is-active')) open(items[0]);
  }
  if (mq.addEventListener) mq.addEventListener('change', ensureOpen);
  else if (mq.addListener) mq.addListener(ensureOpen);
})();


(() => {
  const bar = document.getElementById('mobile-sections');
  const phone = matchMedia('(max-width: 639px)');
  const sections = ['one', 'two', 'three'].map(id => ({
    id,
    section: document.getElementById(id)?.closest('section'),
    links: [...document.querySelectorAll('a[href="#' + id + '"]')],
  }));
  let frame;

  function update() {
    frame = undefined;
    const coversFocus = bar.contains(document.activeElement);
    bar.hidden = !coversFocus && !phone.matches;
    const current = sections.findLast(entry => entry.section?.getBoundingClientRect().top <= innerHeight * .35);
    for (const entry of sections) {
      for (const link of entry.links) {
        if (entry === current) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      }
    }
  }

  function queueUpdate() {
    frame ??= requestAnimationFrame(update);
  }

  phone.addEventListener('change', queueUpdate);
  addEventListener('scroll', queueUpdate, {passive: true});
  addEventListener('hashchange', queueUpdate);
  addEventListener('load', queueUpdate, {once: true});
  bar.addEventListener('focusout', queueUpdate);
  update();
})();
