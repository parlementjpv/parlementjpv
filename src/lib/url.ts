/** Préfixe un chemin du site par le sous-dossier de déploiement (ex. "/parlementjpv"). */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
export const u = (path: string) => (path.startsWith(BASE + '/') && BASE ? path : BASE + path);
export const SITE_ROOT = BASE;
