const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});

function escape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function dateElement(isoDate) {
  const label = dateFormat.format(new Date(isoDate + 'T12:00:00Z')).replace(/\s*г\.$/u, '');
  return '<time datetime="' + escape(isoDate) + '">' + escape(label) + '</time>';
}

function list(items) {
  return '<ul>' + items.map(item => '<li>' + escape(item) + '</li>').join('') + '</ul>';
}

function renderJob(job) {
  const action = new URL(job.url).hostname === 'hh.ru' ? 'Откликнуться на hh.ru' : 'Откликнуться в A–Index';
  const application = job.application
    ? '<p class="home-job-application">' + escape(job.application) + '</p>' : '';
  return `<details class="home-job" id="job-${escape(job.id)}">
    <summary class="home-job-summary"><span class="home-job-title">${escape(job.title)}</span></summary>
    <div class="home-job-body">
      <p class="home-job-workplace">${escape(job.workplace)}</p>
      <h5>Что предстоит делать</h5>${list(job.tasks)}
      <h5>Что понадобится</h5>${list(job.requirements)}
      ${application}<a class="home-job-apply" href="${escape(job.url)}">${action}</a>
    </div>
  </details>`;
}

export function renderJobs(catalog) {
  const openJobs = catalog.jobs.filter(job => job.status === 'open');
  const teams = [...new Set(openJobs.map(job => job.team))];
  const groups = teams.map(team => {
    const title = team === 'A–House' ? 'Команда A–House' : team;
    const jobs = openJobs.filter(job => job.team === team).map(renderJob).join('');
    return '<div class="home-job-group"><h4>' + escape(title) + '</h4><div class="home-job-list">' + jobs + '</div></div>';
  }).join('');
  return `<section class="home-jobs" id="jobs" aria-labelledby="jobs-heading">
    <div class="home-jobs-head">
      <h3 id="jobs-heading">Работа в A–House</h3>
      <p class="home-jobs-updated">${openJobs.length ? 'Открытые вакансии на ' : 'Открытых вакансий на '}${dateElement(catalog.checkedOn)}${openJobs.length ? '' : ' нет.'}</p>
    </div>
    ${groups}
  </section>`;
}
