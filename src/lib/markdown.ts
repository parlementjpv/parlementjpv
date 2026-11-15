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

/** Rendu Markdown pour les articles du site (sans styles d'email) : titres, gras, italique, liens, listes, citations, images. */
export function mdToHtmlWeb(md: string): string {
  const out: string[] = [];
  let list: string[] = [], ol: string[] = [];
  const flush = () => {
    if (list.length) { out.push(`<ul>${list.join('')}</ul>`); list = []; }
    if (ol.length) { out.push(`<ol>${ol.join('')}</ol>`); ol = []; }
  };
  for (const raw of md.replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const img = line.match(/^!\[(.*?)\]\((https:\/\/[^\s)]+)\)$/);
    if (img) { flush(); out.push(`<figure><img src="${esc(img[2])}" alt="${esc(img[1])}" loading="lazy" />${img[1] ? `<figcaption>${esc(img[1])}</figcaption>` : ''}</figure>`); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { flush(); const n = h[1].length + 1; out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const q = line.match(/^>\s?(.*)/);
    if (q) { flush(); out.push(`<blockquote>${inline(q[1])}</blockquote>`); continue; }
    const li = line.match(/^[-*]\s+(.*)/);
    if (li) { list.push(`<li>${inline(li[1])}</li>`); continue; }
    const oli = line.match(/^\d+[.)]\s+(.*)/);
    if (oli) { ol.push(`<li>${inline(oli[1])}</li>`); continue; }
    flush(); out.push(`<p>${inline(line)}</p>`);
  }
  flush();
  return out.join('\n').replace(/ style="color:#0b2545;"/g, '');
}
