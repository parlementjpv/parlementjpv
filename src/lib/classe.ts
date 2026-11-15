// Classe structurée : niveau + numéro
export const ELEVE = ['Seconde', 'Première', 'Terminale'];
export function libelleClasse(niveau: string | null | undefined, num: number | string | null | undefined) {
  if (!niveau) return '';
  if (ELEVE.includes(niveau)) return num ? `${niveau} ${num}` : niveau;
  return niveau === 'Personnel' ? 'Personnel du lycée' : niveau;
}
/** Lit les deux champs d'un formulaire */
export function lireClasse(fd: FormData) {
  const niveau = String(fd.get('niveau') || '');
  const n = Number(fd.get('classe_num')) || null;
  const classe_num = ELEVE.includes(niveau) ? n : null;
  return { niveau, classe_num, classe: libelleClasse(niveau, classe_num) };
}
/** Remplit les deux champs d'un formulaire */
export function remplirClasse(form: HTMLFormElement, niveau: string | null | undefined, num: number | null | undefined) {
  (form.elements.namedItem('niveau') as HTMLSelectElement).value = niveau || '';
  (form.elements.namedItem('classe_num') as HTMLSelectElement).value = num ? String(num) : '';
  form.querySelector('[data-classe]')?.dispatchEvent(new Event('classe:maj'));
}
