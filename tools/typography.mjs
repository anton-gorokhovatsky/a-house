// Only visible HTML text is formatted. Attributes, artwork and native values
// stay literal in both the editorial homepage and the imported pages.
const htmlTokens = /<!--[\s\S]*?-->|<(script|style|svg|textarea|select)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</gi;
const names = 'House|News|Index|School|Fest|Presence|Friend|Member|Patron|Board|Press|Seasons|Kids|Shop|Media|State|Pass|Gallery|Sport|Focus|Private|Book|Concierge|Room';
const namePattern = suffixes => new RegExp('(?<![\\p{L}\\p{N}@./_-])[AА][-‑–—](?:' + suffixes + ')(?![\\p{L}\\p{N}_/-])', 'giu');
const projectName = namePattern(names);
const homeProjectName = namePattern(names + '|Forum|Guide|Industry|Membership');

const month = '(?:январ[ья]|феврал[ья]|марта?|апрел[ья]|ма[йя]|июн[ья]|июл[ья]|августа?|сентябр[ья]|октябр[ья]|ноябр[ья]|декабр[ья])';
const dayMonth = new RegExp('(?<=\\d) (?=' + month + '(?!\\p{L}))', 'giu');
const monthYear = new RegExp('(?<!\\p{L})(' + month + ') (?=\\d{4}(?!\\d))', 'giu');
const shortWord = /(?<![\p{L}\p{N}@./_–-])(а|в|и|к|о|с|у|во|до|за|из|ко|на|об|от|по|со|без|для|при) (?=[«„(]?[\p{L}\d№])/giu;

function wrapNames(text, pattern) {
  return text.replace(pattern, name => '<span class="project-name">' + name + '</span>')
    .replace(/«([АA][-‑–—]ком)(мью)(ни)(кейшнс)»/giu,
      '<span class="legal-name"><span>«$1</span>&shy;$2&shy;$3&shy;$4»</span>');
}

function russianSpacing(text) {
  // Each replacement changes one space in place. The break after a date's
  // comma, after a punctuation dash, or between quantities stays available.
  return text.replace(shortWord, '$1\u00a0')
    .replace(dayMonth, '\u00a0')
    .replace(monthYear, '$1\u00a0')
    .replace(/(?<=№)[ \u00a0](?=\d)/gu, '\u202f')
    .replace(/(?<=\d)[ \u00a0](?=\d{3}(?:[ \u00a0\u202f]\d{3})*(?:[,.]\d+)?[ \u00a0]₽)/gu, '\u202f')
    .replace(/(?<=\d) (?=₽|%|(?:минут[ауы]?|час(?:а|ов)?|год(?:а|у)?|лет|г\.)(?!\p{L}))/giu, '\u00a0')
    .replace(/(?<!\p{L})((?:пер|д|стр|ст|ч|п|пп|подп|абз)\.,?) (?=\d)/giu, '$1\u00a0')
    .replace(/(?<=\S) (?=[—·](?:\s|$))/gu, '\u00a0');
}

// Join a paragraph's text across inline tags, including links and <time>,
// then put its characters back in the original text nodes. This keeps both
// sides of a link and its complete opening tag exactly where the author put them.
export function typesetText(html) {
  const tokens = html.match(htmlTokens) ?? [];
  const run = [];
  let excludedDepth = 0;

  function finishRun() {
    if (!run.length) return;
    // A source newline and its indentation render as a single ordinary space.
    const parts = run.map(index => tokens[index].replace(/[\t\r\n ]+/g, ' ')
      .replace(/&(?:nbsp|#160|#xa0);/gi, '\u00a0').replace(/&#(?:8239|x202f);/gi, '\u202f'));
    const formatted = russianSpacing(parts.join(''));
    let offset = 0;
    for (const [part, index] of run.entries()) {
      const end = offset + parts[part].length;
      const result = formatted.slice(offset, end);
      // Keep the original whitespace and entities of an unchanged text node.
      tokens[index] = wrapNames(result === parts[part] ? tokens[index] : result, homeProjectName);
      offset = end;
    }
    run.length = 0;
  }

  for (const [index, token] of tokens.entries()) {
    if (token.startsWith('<')) {
      if (!/^<\/?(?:a|abbr|b|em|i|small|span|strong|sub|sup|time|u)\b/i.test(token)) finishRun();
      if (/^<(?:dialog|form|pre|code)\b/i.test(token)) excludedDepth++;
      if (/^<\/(?:dialog|form|pre|code)\s*>/i.test(token)) excludedDepth--;
    } else if (excludedDepth) {
      // Keep the original rendering of the imported subscription dialog.
      tokens[index] = wrapNames(token, projectName);
    } else {
      run.push(index);
    }
  }
  finishRun();
  return tokens.join('');
}
