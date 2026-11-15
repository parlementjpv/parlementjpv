import { api } from './newsletter';
import { getSupabase } from './supabase';

// Télécharge le certificat de membre (PDF généré par le serveur : signatures + QR code de vérification)
export async function telechargerCertificat(token: string) {
  const { data } = await getSupabase().auth.getSession(); if (data.session?.access_token) token = data.session.access_token;
  const r = await fetch(api('/api/certificat'), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok || r.headers.get('content-type') !== 'application/pdf') throw new Error('Certificat indisponible');
  const nom = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'certificat-parlement-jpv.pdf';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob()); a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
