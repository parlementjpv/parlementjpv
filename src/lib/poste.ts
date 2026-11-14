const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
/** Petit badge rouge « ★ Président·e » à placer après un nom */
export const posteBadge = (poste?: string | null) => (poste ? `<span class="poste-badge" title="Membre du bureau">${esc(poste)}</span>` : '');
