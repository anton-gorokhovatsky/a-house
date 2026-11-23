(() => {
  const article = document.querySelector('[data-event-detail]');
  if (!article) return;
  const calendar = article.querySelector('[data-event-calendar]');
  if (document.referrer) {
    const from = new URL(document.referrer);
    if (from.origin === location.origin && from.pathname === calendar.pathname) {
      const params = new URLSearchParams();
      for (const name of ['month', 'audience']) {
        const value = from.searchParams.get(name);
        if (value) params.set(name, value);
      }
      calendar.search = params.toString();
    }
  }

  const moscowDate = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const ended = article.querySelector('[data-event-ended]');
  const admission = article.querySelector('[data-event-admission]');
  function update() {
    const past = article.dataset.end < moscowDate.format(new Date());
    ended.hidden = !past;
    if (admission) admission.hidden = past;
  }
  update();
  window.addEventListener('pageshow', update);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  if (article.dataset.end >= moscowDate.format(new Date())) window.setInterval(update, 60000);
})();
