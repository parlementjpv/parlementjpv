// Badges du profil d'orateur, calculés à partir des statistiques (aucune donnée supplémentaire stockée)
export type Profil = {
  seances: number; debats: number; roles: Record<string, number>; arguments_retenus: number; camps: Record<string, number>;
  motions_proposees: number; motions_retenues: number; meilleur_orateur?: number; votes_orateur?: number | null; tournois_gagnes?: number; finales?: number; duels_gagnes?: number; votes_elections?: number | null; absences?: number | null; role: string; poste?: string | null;
};
export type Badge = { id: string; nom: string; desc: string; obtenu: boolean; progres?: string };

const nbRole = (p: Profil, prefix: string) => Object.entries(p.roles || {}).filter(([r]) => r.startsWith(prefix)).reduce((a, [, n]) => a + n, 0);

export function badges(p: Profil): Badge[] {
  const typesRoles = ['Ouverture', 'Argument', 'Réfutation', 'Conclusion'].filter((r) => nbRole(p, r) > 0).length;
  const palier = (n: number, cible: number) => (n >= cible ? undefined : `${n}/${cible}`);
  return [
    { id: 'premiere', nom: 'Première séance', desc: 'Être présent à une séance', obtenu: p.seances >= 1, progres: palier(p.seances, 1) },
    { id: 'cinq', nom: '5 débats', desc: 'Participer à 5 débats', obtenu: p.debats >= 5, progres: palier(p.debats, 5) },
    { id: 'dix', nom: '10 débats', desc: 'Participer à 10 débats', obtenu: p.debats >= 10, progres: palier(p.debats, 10) },
    { id: 'vingt', nom: 'Pilier du Parlement', desc: 'Être présent à 20 séances', obtenu: p.seances >= 20, progres: palier(p.seances, 20) },
    { id: 'ouverture', nom: 'Premier mot', desc: "Prendre l'ouverture d'un débat", obtenu: nbRole(p, 'Ouverture') > 0 },
    { id: 'refutation', nom: 'Première réfutation', desc: 'Tenir le rôle de réfutation', obtenu: nbRole(p, 'Réfutation') > 0 },
    { id: 'conclusion', nom: 'Le mot de la fin', desc: 'Conclure un débat', obtenu: nbRole(p, 'Conclusion') > 0 },
    { id: 'polyvalent', nom: 'Toutes les casquettes', desc: 'Tenir les 4 types de rôle (ouverture, argument, réfutation, conclusion)', obtenu: typesRoles === 4, progres: palier(typesRoles, 4) },
    { id: 'argument', nom: 'Argument en or', desc: 'Voir un de ses arguments retenu par son camp', obtenu: p.arguments_retenus >= 1 },
    { id: 'stratege', nom: 'Stratège', desc: '10 arguments retenus par son camp', obtenu: p.arguments_retenus >= 10, progres: palier(p.arguments_retenus, 10) },
    { id: 'champion', nom: 'Champion d\'éloquence', desc: 'Remporter un tournoi d\'éloquence', obtenu: (p.tournois_gagnes ?? 0) >= 1 },
    { id: 'finaliste', nom: 'Finaliste', desc: 'Atteindre la finale d\'un tournoi d\'éloquence', obtenu: (p.finales ?? 0) >= 1 },
    { id: 'duelliste', nom: 'Duelliste', desc: 'Gagner 3 duels de tournoi', obtenu: (p.duels_gagnes ?? 0) >= 3, progres: palier(p.duels_gagnes ?? 0, 3) },
    { id: 'meilleur', nom: 'Meilleur orateur', desc: 'Être élu meilleur orateur d\'une séance par les présents', obtenu: (p.meilleur_orateur ?? 0) >= 1 },
    { id: 'tribun', nom: 'Tribun', desc: 'Être élu 5 fois meilleur orateur', obtenu: (p.meilleur_orateur ?? 0) >= 5, progres: palier(p.meilleur_orateur ?? 0, 5) },
    { id: 'jure', nom: 'Juré', desc: 'Voter pour le meilleur orateur après une séance', obtenu: (p.votes_orateur ?? 0) >= 1 },
    { id: 'deuxcamps', nom: "Avocat du diable", desc: 'Défendre au moins deux camps différents', obtenu: Object.keys(p.camps || {}).length >= 2 },
    { id: 'motion', nom: 'Faiseur de motions', desc: 'Proposer une motion', obtenu: p.motions_proposees >= 1 },
    { id: 'motionretenue', nom: 'Ordre du jour', desc: 'Voir une de ses motions retenue par le bureau', obtenu: p.motions_retenues >= 1 },
    { id: 'electeur', nom: 'Citoyen', desc: 'Voter à une élection du bureau', obtenu: (p.votes_elections ?? 0) >= 1 },
    { id: 'assidu', nom: 'Assiduité parfaite', desc: '5 séances sans aucune absence non excusée', obtenu: p.seances >= 5 && p.absences === 0, progres: p.absences ? undefined : palier(p.seances, 5) },
    { id: 'bureau', nom: p.poste || 'Au bureau', desc: p.poste ? 'Poste au bureau du Parlement' : 'Être membre du bureau', obtenu: !!p.poste || p.role === 'bureau' || p.role === 'admin' },
  ];
}
