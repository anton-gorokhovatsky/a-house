const moscow = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit'
});
const dayAndMonth = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC', day: 'numeric', month: 'long'
});

export function moscowDay(now = new Date()) {
  return moscow.format(now);
}

export function isEventToday({ start, end = start }, day) {
  return start === day && end === day;
}

export function compareEventStarts(a, b) {
  return a.start.localeCompare(b.start) || (a.time || '').localeCompare(b.time || '');
}

export function compareUpcomingEvents(a, b, day) {
  return Number(isEventToday(b, day)) - Number(isEventToday(a, day)) || compareEventStarts(a, b);
}

export function updateScheduleDate(card, day) {
  const { start, end, time, kind } = card.dataset;
  const absolute = card.querySelector('[data-absolute-date]');
  const relative = card.querySelector('[data-relative-date]');
  let label = '';
  let dateTime = end;

  if (isEventToday(card.dataset, day)) {
    label = time ? 'Сегодня в\u00a0' + time : 'Сегодня';
    if (time) dateTime = start + 'T' + time + ':00+03:00';
  } else if (start < end && start <= day && day <= end && /^выставк/i.test(kind)) {
    const year = end.slice(0, 4);
    label = 'Идёт до\u00a0' + dayAndMonth.format(new Date(end + 'T12:00:00Z'));
    if (year !== day.slice(0, 4)) label += '\u00a0' + year;
  }

  relative.textContent = label;
  relative.dateTime = dateTime;
  relative.hidden = !label;
  absolute.hidden = Boolean(label);
}
