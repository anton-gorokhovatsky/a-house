import assert from 'node:assert/strict';
import { nominations } from './criteria.mjs';

const moscow = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Moscow', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23',
});

function sheetDate(value) {
  assert.ok(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'Invalid report timestamp');
  return moscow.format(new Date(value)); // Year first keeps Moscow times sortable as well as readable.
}

export const tabs = [
  {
    name: 'Сводка', columns: ['Работа', 'Рабочий балл', 'Голосов', 'Концепция, среднее', 'Техоценка МТС', 'Порог для премии\n(техоценка ≥ 4)'],
    widths: [159, 115, 77, 139, 132, 160], note: 'Шкала 0–5. Для рабочего балла нужны минимум 4 голоса и техоценка. Вес каждой части — 50 %. Для архитектурного эксперимента реализуемость необязательна.',
  },
  {
    name: 'Оценки жюри', columns: ['Работа', 'Член жюри', 'Комментарий', 'Концепция', 'Техоценка МТС', 'Тип записи', 'Изменено (МСК)', 'Рекомендации по номинациям'],
    widths: [169, 210, 353, 95, 128, 100, 169, 320], note: 'Шкала 0–5. Одна строка — последняя сохранённая оценка члена жюри за работу. Тестовые записи исключены из сводки.',
  },
];

export function jurorNamesFromRoster(tsv) {
  const [header, ...rows] = tsv.trim().split(/\r?\n/).map(line => line.split('\t'));
  const loginColumn = header.indexOf('Логин');
  const nameColumn = header.indexOf('Член жюри');
  assert.ok(loginColumn >= 0 && nameColumn >= 0, 'Missing jury roster columns');
  const names = new Map();
  for (const row of rows) {
    const login = row[loginColumn]?.trim();
    const name = row[nameColumn]?.trim();
    assert.ok(login && name && !names.has(login), 'Incomplete or duplicate jury roster entry');
    names.set(login, name);
  }
  return names;
}

export function reportRows(report, jurorNames) {
  assert.equal(report?.rubric, 'final_50_50', 'Unexpected jury rubric');
  assert.ok(Array.isArray(report.works) && report.works.length > 0, 'No finalist catalogue');
  assert.ok(Array.isArray(report.ballots), 'Missing ballots');
  const ids = new Set(report.works.map(w => w.work_id));
  assert.equal(ids.size, report.works.length, 'Duplicate finalist');
  const saved = new Set();
  const ballots = report.ballots.map(b => {
    assert.ok(ids.has(b.work_id) && typeof b.login === 'string' && b.login.length, 'Unknown ballot');
    assert.equal(typeof b.is_test, 'boolean', 'Missing ballot type');
    const pair = JSON.stringify([b.work_id, b.login]);
    assert.ok(!saved.has(pair), 'Duplicate ballot');
    saved.add(pair);
    const name = b.is_test ? (b.test_name || 'Тестовый член жюри') : (jurorNames.get(b.login) || 'Имя не указано');
    const labels = nominations.filter(({ key }) => b.nomination_keys?.includes(key))
      .map(({ name }) => name.replace(/^\d+\.\s*/, ''));
    return [b.title, name, b.comment || null, b.concept, b.technical_score,
      b.is_test ? 'Тестовая' : 'Жюри', sheetDate(b.updated_at), labels.join('\n') || null];
  });
  return {
    time: sheetDate(report.as_of),
    bodies: [report.works.map(w => [w.title, w.working_score, w.ballot_count, w.mean_concept, w.mean_feasibility,
      w.meets_prize_feasibility_threshold == null ? null : w.meets_prize_feasibility_threshold ? 'Достигнут' : 'Ниже порога']),
    ballots],
  };
}

function cell(value) {
  if (value == null) return {};
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'Invalid numeric cell');
    return { userEnteredValue: { numberValue: value } };
  }
  assert.equal(typeof value, 'string', 'Invalid text cell');
  return { userEnteredValue: { stringValue: value } };
}

// Replace both report bodies in one Sheets batch. The bounded columns belong to this export.
// An updateCells range also clears old values left beyond the new snapshot, including deleted tests.
export function makeSheetUpdates(report, sheets, jurorNames) {
  const { time, bodies } = reportRows(report, jurorNames);
  return tabs.flatMap((tab, index) => {
    const sheet = sheets.find(s => s.title === tab.name);
    assert.ok(sheet && Number.isInteger(sheet.sheetId) && sheet.rowCount >= 3, 'Missing results tab');
    const sheetId = sheet.sheetId;
    const rowCount = Math.max(sheet.rowCount, bodies[index].length + 2);
    const updates = [];
    if (rowCount > sheet.rowCount) updates.push({ appendDimension: { sheetId, dimension: 'ROWS', length: rowCount - sheet.rowCount } });
    const headerRows = [{ values: [cell(time)] }];
    if (index === 1) headerRows.push({ values: [cell(tab.columns[1])] });
    updates.push({ updateCells: { start: { sheetId, rowIndex: 0, columnIndex: 1 },
      rows: headerRows, fields: 'userEnteredValue' } });
    if (index === 1) {
      const columnIndex = tab.columns.length - 1;
      updates.push({ updateCells: { start: { sheetId, rowIndex: 1, columnIndex },
        rows: [{ values: [cell(tab.columns[columnIndex])] }], fields: 'userEnteredValue' } });
      updates.push({ repeatCell: {
        range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: columnIndex, endColumnIndex: columnIndex + 1 },
        cell: { userEnteredFormat: { wrapStrategy: 'WRAP' } }, fields: 'userEnteredFormat.wrapStrategy',
      } });
    }
    updates.push({ updateCells: { range: { sheetId, startRowIndex: 2, endRowIndex: rowCount,
      startColumnIndex: 0, endColumnIndex: tab.columns.length },
      rows: bodies[index].map(row => ({ values: row.map(cell) })), fields: 'userEnteredValue' } });
    if (index === 1 && bodies[index].length) updates.push({ autoResizeDimensions: { dimensions: {
      sheetId, dimension: 'ROWS', startIndex: 2, endIndex: bodies[index].length + 2,
    } } });
    return updates;
  });
}
