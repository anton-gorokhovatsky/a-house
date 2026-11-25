(() => {
  const disclosures = [
    ['rec2291512421', 'rec2291513081', 'Подробнее о конкурсе'],
    ['rec2291516421', 'rec2291516781', 'Этап 1. Отборочный этап'],
    ['rec2291517171', 'rec2291517501', 'Этап 2. Эскизное задание'],
    ['rec3335110301', 'rec3319573401', 'Этап 3. Конкурсное задание']
  ];
  const sections = {
    stages: 'rec2291515311',
    jury: 'rec2291518041',
    awards: 'rec4612983501'
  };
  const panels = new Map();

  function followBookmark() {
    const fragment = location.hash.slice(1);
    if (fragment === 'organizers') {
      document.querySelector('.t367__opener').click();
      return;
    }
    const disclosure = panels.get(fragment);
    if (disclosure) {
      const {title, trigger} = disclosure;
      if (!title.classList.contains('active-accord')) trigger.click();
      title.scrollIntoView();
    } else if (Object.hasOwn(sections, fragment)) {
      document.getElementById(sections[fragment]).scrollIntoView();
    }
  }

  for (const [titleId, panelId, label] of disclosures) {
    const title = document.getElementById(titleId);
    const panel = document.getElementById(panelId);
    const trigger = title.querySelector(titleId === 'rec2291512421' ? '.accord:not(.accord-icon)' : '.accord-icon');
    panels.set(panelId, {title, trigger});
    trigger.setAttribute('role', 'button');
    trigger.tabIndex = 0;
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-controls', panelId);
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      if (!event.repeat) trigger.click();
    });
    const syncState = () => {
      const open = title.classList.contains('active-accord');
      trigger.setAttribute('aria-expanded', String(open));
      panel.inert = !open;
    };
    new MutationObserver(syncState).observe(title, { attributes: true, attributeFilter: ['class'] });
    syncState();
  }

  window.addEventListener('load', followBookmark, { once: true });
  window.addEventListener('hashchange', followBookmark);
})();
