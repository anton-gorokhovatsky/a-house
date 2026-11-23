(() => {
  const archive = document.getElementById('publication-archive');
  const topics = [...archive.querySelectorAll('[data-archive-topic]')];
  const rows = [...archive.querySelectorAll('[data-archive-topics]')];
  const status = archive.querySelector('[data-archive-count]');
  let current;

  // Each unenhanced link opens an already filtered HTML index.
  for (const link of topics) link.setAttribute('href', '#' + (link.id || archive.id));
  archive.dataset.enhanced = '';

  function showTopic() {
    const selected = topics.find(link => link.hash === location.hash) || topics[0];
    if (current === selected) return;
    const key = selected.dataset.archiveTopic;
    let count = 0;
    for (const row of rows) {
      row.hidden = !!key && !row.dataset.archiveTopics.split(' ').includes(key);
      if (!row.hidden) count++;
    }
    for (const link of topics) {
      if (link === selected) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    if (current) status.textContent = 'Публикаций — ' + count;
    current = selected;
  }

  showTopic();
  // The home router pushes fragments during its document click handler.
  // A window listener sees the final address before the next paint.
  window.addEventListener('click', event => {
    if (event.target.closest('a[href^="#"]')) showTopic();
  });
  window.addEventListener('popstate', showTopic);
  window.addEventListener('hashchange', showTopic);
  window.addEventListener('pageshow', showTopic);
})();
