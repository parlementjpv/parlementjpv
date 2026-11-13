import { admin, resend, json, isEmail, checkTurnstile, esc, layout, FROM, BUREAU_EMAIL } from './_lib.mjs';

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Méthode non autorisée' });
  let b; try { b = await req.json(); } catch { return json(400, { error: 'Requête invalide' }); }
  if (b.website) return json(200, { ok: true }); // pot de miel anti-spam
  const nom = String(b.nom || '').trim().slice(0, 120), email = String(b.email || '').trim().toLowerCase(), sujet = String(b.sujet || '').slice(0, 120), message = String(b.message || '').trim().slice(0, 5000);
  if (!nom || !isEmail(email) || message.length < 10) return json(400, { error: 'Merci de remplir tous les champs.' });
  if (!(await checkTurnstile(b.turnstileToken, req))) return json(400, { error: 'Vérification anti-robot échouée.' });
  await admin().from('contact_messages').insert({ nom, email, sujet, message });
  try {
    await resend().emails.send({
      from: FROM, to: BUREAU_EMAIL, replyTo: email, subject: `[Contact] ${sujet} — ${nom}`,
      html: layout({ title: `Nouveau message : ${sujet}`, body: `<p><strong>${esc(nom)}</strong> &lt;${esc(email)}&gt;</p><p style="white-space:pre-wrap;">${esc(message)}</p>` }),
    });
  } catch (e) { console.error(e); }
  return json(200, { ok: true });
};

export const config = { path: '/api/contact' };
