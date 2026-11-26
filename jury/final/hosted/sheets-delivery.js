// Called by the scheduled job inside the connected Google Drive tool environment.
// Only counts and the refresh time leave this function; comments are carried as literal cell values.
(async function syncJurySheet(tools, workspace) {
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  async function local(command, max = 700) {
    const result = await tools.exec_command({ cmd: `node jury/final/hosted/sheets-sync.mjs ${command}`,
      workdir: workspace, max_output_tokens: max, yield_time_ms: 10000, sandbox_permissions: 'require_escalated',
      justification: 'Разрешить синхронизировать закрытую таблицу жюри с рабочей базой конкурса?',
      prefix_rule: ['node', 'jury/final/hosted/sheets-sync.mjs'] });
    let output = result.output;
    let state = result;
    while (state.session_id && state.exit_code == null) {
      state = await tools.write_stdin({session_id: state.session_id, chars: '', yield_time_ms: 1000, max_output_tokens: max});
      output += state.output;
    }
    check(state.exit_code === 0, `Local export failed at ${command.split(' ')[0]}`);
    return output.trim();
  }
  function read(result) {
    check(result && !result.isError && result.structuredContent, 'Google Drive request failed');
    return result.structuredContent;
  }
  const {spreadsheet, titles} = JSON.parse(await local('target'));
  const doc = read(await tools.mcp__codex_apps__google_drive_get_file_metadata({fileId: spreadsheet,
    fields: 'id,mimeType,permissions(type,role)'}));
  check(doc.id === spreadsheet && doc.mime_type === 'application/vnd.google-apps.spreadsheet' &&
    doc.permissions?.some(p => p.role === 'owner') && doc.permissions.every(p => ['user', 'group'].includes(p.type)), 'Check file or its sharing settings');
  const props = read(await tools.mcp__codex_apps__google_drive_get_spreadsheet_metadata({spreadsheet_id: spreadsheet}));
  const grid = titles.map(title => props.sheets.find(s => s.properties.title === title)?.properties);
  check(grid.every(p => Number.isInteger(p?.sheetId) && Number.isInteger(p?.gridProperties?.rowCount)), 'Results tab missing');
  const args = grid.flatMap(p => [p.sheetId, p.gridProperties.rowCount]).join(' ');
  const lock = await tools.exec_command({cmd: 'python3 jury/final/hosted/sheets-lock.py', workdir: workspace,
    tty: true, yield_time_ms: 500, max_output_tokens: 50, sandbox_permissions: 'require_escalated',
    justification: 'Разрешить защитить таблицу жюри от одновременных обновлений?', prefix_rule: ['python3', 'jury/final/hosted/sheets-lock.py']});
  if (lock.output.trim() === 'busy') return { skipped: 'another refresh holds the lock' };
  check(lock.session_id && lock.output.trim() === 'locked', 'Could not lock the export');
  async function renew() {
    const res = await tools.write_stdin({session_id: lock.session_id, chars: 'renew\n', yield_time_ms: 250, max_output_tokens: 50});
    check(res.exit_code == null && res.output.includes('held'), 'Export lock expired');
  }
  async function cells(ranges) {
    return read(await tools.mcp__codex_apps__google_drive_get_spreadsheet_cells({spreadsheet_id: spreadsheet, ranges, cell_fields: 'userEnteredValue'})).sheets;
  }
  const stamps = titles.map(title => `'${title}'!B1`);
  const stamp = part => part?.rowData?.[0]?.values?.[0]?.userEnteredValue?.stringValue;
  let batch;
  try {
    batch = JSON.parse(await local(`prepare ${args}`));
    check(/^[0-9a-f-]{36}$/.test(batch.run) && Number.isInteger(batch.chunks) && batch.chunks > 0 && Number.isInteger(batch.length), 'Invalid export');
    const previous = await cells(stamps);
    if (previous.some(s => stamp(s.data[0]) > batch.stamp)) return { skipped: 'newer snapshot is already visible' };
    const parts = [];
    for (let n = 0; n < batch.chunks; n += 6) {
      if (n) await renew();
      const next = await Promise.all(Array.from({length: Math.min(6, batch.chunks - n)}, (_, i) => local(`chunk ${batch.run} ${n+i}`, 12500)));
      parts.push(...next.map(v => JSON.parse(v)));
    }
    const payload = parts.join('');
    check(payload.length === batch.length, 'Incomplete export');
    const requests = JSON.parse(payload);
    await renew();
    read(await tools.mcp__codex_apps__google_drive_batch_update_spreadsheet({spreadsheet_id: spreadsheet, requests}));
    const counts = [batch.works, batch.ballots];
    const ranges = titles.flatMap((title, i) => [stamps[i], `'${title}'!A3:A${Math.min(Math.max(grid[i].gridProperties.rowCount, counts[i]+2), counts[i]+3)}`]);
    const saved = await cells(ranges);
    for (let i = 0; i < titles.length; i++) {
      const data = saved.find(s => s.properties.title === titles[i])?.data;
      const time = data?.find(part => part.startColumn === 1);
      const body = data?.find(part => part.startRow === 2);
      const rowCount = (body?.rowData ?? []).filter(r => r.values?.[0]?.userEnteredValue?.stringValue).length;
      check(stamp(time) === batch.stamp && rowCount === counts[i], 'Saved sheet did not match the source snapshot');
    }
    return { refreshedMoscow: batch.stamp, works: counts[0], ballots: counts[1] };
  } finally {
    try { if (batch?.run) await local(`finish ${batch.run}`); }
    finally { await tools.write_stdin({session_id: lock.session_id, chars: 'done\n', yield_time_ms: 250, max_output_tokens: 50}); }
  }
})
