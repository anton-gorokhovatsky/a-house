// Keep the displayed spelling and copied text intact. Only visible HTML text
// gets wrapped. Attributes, embedded artwork and native form values stay literal.
const htmlTokens = /<!--[\s\S]*?-->|<(script|style|svg|textarea|select)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</gi;
const projectName = /(?<![\p{L}\p{N}@./_-])[AА][-‑–—](?:House|News|Index|School|Fest|Presence|Friend|Member|Patron|Board|Press|Seasons|Kids|Shop|Media|State|Pass|Gallery|Sport|Focus|Private|Book|Concierge)(?![\p{L}\p{N}_/-])/giu;

export function keepProjectNames(html) {
  return html.replace(htmlTokens, token => token.startsWith('<') ? token :
    token.replace(projectName, name => '<span class="project-name">' + name + '</span>'));
}
