// Actualités publiées depuis l'espace bureau (table « articles » + images dans le stockage Supabase).
import type { SupabaseClient } from '@supabase/supabase-js';

export type Article = { id: string; slug: string; titre: string; chapo: string | null; contenu: string; image_url: string | null; image_alt: string | null;
  categorie: string; publie: boolean; publie_at: string | null; auteur_nom: string; created_at: string; updated_at: string };

export const CATEGORIES = ['Actualité', 'Compte rendu', 'Débat', 'Événement', 'Projet', 'Tribune'];

export const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'article';

export const fmtDate = (d: string) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(d));

export async function articlesPublies(sb: SupabaseClient, limit = 50) {
  const { data } = await sb.from('articles').select('*').eq('publie', true).order('publie_at', { ascending: false }).limit(limit);
  return (data || []) as Article[];
}

/** Réduit une photo avant envoi (max 1600 px de large, JPEG ~ 82 %) : pages légères et stockage économisé. */
export async function preparerImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((ok) => c.toBlob((b) => ok(b!), 'image/jpeg', 0.82));
}
