/** Mini convertisseur Markdown HTML sûr (titres, gras, italique, liens, listes, paragraphes). */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2" style="color:#0b2545;">$1</a>');

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => { if (list.length) { out.push(`<ul>${list.join('')}</ul>`); list = []; } };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { flush(); const n = h[1].length + 1; out.push(`<h${n} style="font-family:Georgia,serif;color:#0b2545;margin:22px 0 8px;">${inline(h[2])}</h${n}>`); continue; }
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { list.push(`<li>${inline(li[1])}</li>`); continue; }
    flush(); out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n');
}
export const mdToText = (md: string) => md.replace(/[#*]/g, '').replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
