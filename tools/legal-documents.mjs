// The same column headings travel with each record when a narrow screen
// puts its cells one below another. The native headers remain available to AT.
export function formatDocumentTables(html) {
  return html.replace(/<table>\s*<thead>([\s\S]*?)<\/thead>\s*<tbody>([\s\S]*?)<\/tbody>\s*<\/table>/g, (_, head, body) => {
    const headings = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(match => match[1]);
    if (!headings.length) throw new Error('A document table needs column headings');
    const headRow = head.replace(/<tr>/g, '<tr role="row">').replace(/<th\b/g, '<th role="columnheader"');
    const rows = body.replace(/<tr>([\s\S]*?)<\/tr>/g, (_, cells) => {
      let column = 0;
      const row = cells.replace(/<td>([\s\S]*?)<\/td>/g, (_, value) => {
        const heading = headings[column++];
        return '<td role="cell"><span class="document-cell-label" aria-hidden="true">' + heading + '</span>' + value + '</td>';
      });
      if (column !== headings.length) throw new Error('Mismatched document table cells');
      return '<tr role="row">' + row + '</tr>';
    });
    return '<table role="table" data-columns="' + headings.length + '"><thead role="rowgroup">' + headRow
      + '</thead><tbody role="rowgroup">' + rows + '</tbody></table>';
  });
}
