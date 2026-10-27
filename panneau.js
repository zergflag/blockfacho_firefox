const ANNUAIRE = 'https://blockfacho.readymoss8.chatgpt.site';
const CATEGORIES = ['RN', 'Reconquête', 'Groupes', 'Autres'];
const TERMINES = ['bloque', 'deja', 'introuvable'];
const LIBELLES = { bloque: 'bloqué', deja: 'déjà bloqué', introuvable: 'introuvable ou suspendu', serait_bloque: 'serait bloqué', a_verifier_plus_tard: 'blocage envoyé, confirmation différée (à vérifier)' };

const $ = (id) => document.getElementById(id);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let comptes = [];
let etat = {};
let arret = false;

function log(texte, classe = '') {
  const ligne = document.createElement('div');
  ligne.textContent = texte;
  ligne.className = classe;
  $('journal').append(ligne);
  $('journal').scrollTop = $('journal').scrollHeight;
}

async function recuperer(chemin) {
  const reponse = await fetch(ANNUAIRE + chemin, { cache: 'no-store' });
  if (!reponse.ok) throw new Error(`${chemin} : HTTP ${reponse.status}`);
  return reponse;
}

const handleDepuisUrl = (url) => url?.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(\w{1,15})/i)?.[1];

// Même fusion que le site : la liste de base, complétée par les propositions validées de l'API.
async function chargerComptes() {
  // accounts.js est du JS : on n'exécute jamais son code, on extrait le tableau en JSON.
  const js = await (await recuperer('/accounts.js')).text();
  const base = JSON.parse(js.slice(js.indexOf('['), js.lastIndexOf(']') + 1));
  const parId = new Map(base.map((c) => [(c.id ?? c.handle).toLowerCase(), c]));

  try {
    const { entries } = await (await recuperer('/api/accounts')).json();
    for (const e of entries) {
      const cle = String(e.type === 'new' ? e.id : e.target_id).toLowerCase();
      if (e.type === 'new' && !parId.has(cle)) {
        parId.set(cle, { id: e.id, name: e.name, handle: '', category: CATEGORIES.includes(e.category) ? e.category : 'Autres' });
      }
      const compte = parId.get(cle);
      if (compte && e.platform === 'x') compte.handle = handleDepuisUrl(e.profile_url) ?? compte.handle;
    }
  } catch (e) {
    log(`Propositions validées indisponibles (${e.message}), liste de base seule.`, 'err');
  }

  return [...parId.values()].filter((c) => c.handle);
}

function afficherResume() {
  const faits = comptes.filter((c) => TERMINES.includes(etat[c.handle.toLowerCase()])).length;
  $('resume').textContent = `${comptes.length} comptes dans l'annuaire, ${faits} déjà traités.`;
}

function afficherCategories() {
  const parCat = comptes.reduce((groupes, c) => {
    (groupes[c.category] ??= []).push(c);
    return groupes;
  }, {});
  $('categories').replaceChildren(
    ...Object.entries(parCat).map(([cat, liste]) => {
      const restants = liste.filter((c) => !TERMINES.includes(etat[c.handle.toLowerCase()])).length;
      const coche = Object.assign(document.createElement('input'), { type: 'checkbox', checked: restants > 0, value: cat });
      const label = document.createElement('label');
      label.append(coche, `${cat} (${restants} sur ${liste.length} à bloquer)`);
      return label;
    }),
  );
}

// Si la page ne finit jamais de charger, on rend la main quand même : agirSurProfil remontera l'erreur.
async function chargerOnglet(tabId, url) {
  // Firefox peut créer la fenêtre sur about:blank avant de lancer la navigation.
  // Attendre explicitement l'URL cible ET la fin du chargement.
  await chrome.tabs.update(tabId, { url });
  const cible = new URL(url);
  const debut = Date.now();
  while (Date.now() - debut < 45000) {
    const tab = await chrome.tabs.get(tabId);
    const actuelle = tab.url || '';
    let correspond = false;
    try {
      const u = new URL(actuelle);
      correspond = (u.hostname === cible.hostname || u.hostname === 'www.' + cible.hostname)
        && u.pathname.replace(/\/$/, '') === cible.pathname.replace(/\/$/, '');
    } catch (_) {}
    if (correspond && tab.status === 'complete') return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  const tab = await chrome.tabs.get(tabId);
  throw new Error(`Chargement X non terminé (onglet : ${tab.url || 'URL inconnue'})`);
}

async function agirSurProfil(bloquer) {
  const q = (s) => document.querySelector(s);
  const attendre = async (test, ms) => {
    const debut = Date.now();
    while (Date.now() - debut < ms) {
      const r = test();
      if (r) return r;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };
  if (!(await attendre(() => q('[data-testid="SideNav_AccountSwitcher_Button"]'), 15000))) return 'deconnecte';
  const statut = await attendre(
    () =>
      (q('[data-testid$="-unblock"]') && 'deja') ||
      (q('[data-testid="userActions"]') && 'a_bloquer') ||
      (q('[data-testid="emptyState"]') && 'introuvable'),
    20000,
  );
  if (statut !== 'a_bloquer') return statut ?? 'erreur: page de profil non reconnue';
  if (!bloquer) return 'serait_bloque';
  q('[data-testid="userActions"]').click();
  const menu = await attendre(() => q('[data-testid="block"]'), 10000);
  if (!menu) return 'erreur: entrée Bloquer absente du menu';
  menu.click();
  const confirmer = await attendre(() => q('[data-testid="confirmationSheetConfirm"]'), 10000);
  if (!confirmer) return 'erreur: confirmation absente';
  confirmer.click();
  return (await attendre(() => q('[data-testid$="-unblock"]'), 5000)) ? 'bloque' : 'a_verifier';
}

function reperesDeLaPage() {
  return [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid))].join(', ');
}

async function executer(tabId, func, args = []) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(tab.url ?? '')) throw new Error(`Onglet inattendu : ${tab.url || 'URL inaccessible'}`);
  const injections = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  if (!injections?.length) throw new Error('Firefox n’a retourné aucun résultat d’injection');
  return injections[0].result;
}

// Dans une fenêtre en arrière-plan, X n'affiche pas toujours le bouton « Débloquer » après coup :
// on recharge le profil pour lire l'état réel côté serveur.
async function traiterCompte(tabId, handle, bloquer) {
  const url = `https://x.com/${encodeURIComponent(handle)}`;
  await chargerOnglet(tabId, url);
  const resultat = await executer(tabId, agirSurProfil, [bloquer]);
  if (resultat !== 'a_verifier') return resultat;
  // Ne jamais cliquer une seconde fois : vérifier uniquement l'état distant.
  // Les changements d'état de X peuvent être visibles avec retard.
  for (let tentative = 1; tentative <= 4; tentative++) {
    await pause(tentative === 1 ? 2500 : 3500);
    await chargerOnglet(tabId, url);
    const verification = await executer(tabId, agirSurProfil, [false]);
    if (verification === 'deja') return 'bloque';
    if (verification === 'deconnecte' || verification === 'introuvable') return verification;
  }
  // État incertain : ne pas enregistrer comme succès ni répéter le blocage.
  return 'a_verifier_plus_tard';
}

async function lancer() {
  // Firefox MV3 : les autorisations d'hôte sont déclarées dans le manifeste.
  // Contrôler leur octroi effectif avant toute tentative d'injection.
  const acces = await chrome.permissions.contains({ origins: ['https://x.com/*'] });
  if (!acces) {
    log('Accès à x.com non accordé. Dans about:addons → Blockfacho → Permissions, autorise l’accès à x.com, puis recharge l’extension.', 'err');
    return;
  }

  const categories = [...document.querySelectorAll('#categories input:checked')].map((i) => i.value);
  const max = Number($('max').value);
  const [dMin, dMax] = [Number($('delaiMin').value), Number($('delaiMax').value)];
  const aBlanc = $('aBlanc').checked;
  const aTraiter = comptes
    .filter((c) => categories.includes(c.category))
    .filter((c) => !TERMINES.includes(etat[c.handle.toLowerCase()]))
;

  log(`${aTraiter.length} comptes restants, ${max} blocages au plus${aBlanc ? ' (à blanc)' : ''}.`);
  if (!aTraiter.length) return;

  arret = false;
  $('lancer').disabled = true;
  $('arreter').disabled = false;
  let fenetre;
  let tabId;
  try {
    fenetre = await chrome.windows.create({ url: 'about:blank', focused: false });
    // Firefox peut remplacer l'onglet initial pendant la création de la fenêtre.
    // Créer un onglet stable dans cette fenêtre puis utiliser son ID réel.
    const onglet = await chrome.tabs.create({ windowId: fenetre.id, url: 'https://x.com/home', active: true });
    tabId = onglet.id;
    if (tabId == null) throw new Error('Impossible de créer un onglet X stable');
    await chargerOnglet(tabId, 'https://x.com/home');
    log('Onglet X chargé, démarrage du contrôle…', 'gris');
  } catch (e) {
    log(`Erreur de création de fenêtre : ${e.message}`, 'err');
    if (fenetre?.id) await chrome.windows.remove(fenetre.id).catch(() => {});
    $('lancer').disabled = false;
    $('arreter').disabled = true;
    return;
  }
  let erreursDeSuite = 0;
  let actions = 0;

  try {
    for (const [i, c] of aTraiter.entries()) {
      if (arret || actions >= max) break;
      const cle = c.handle.toLowerCase();
      const prefixe = `[${i + 1}/${aTraiter.length}] @${c.handle} (${c.name})`;
      const result = await traiterCompte(tabId, c.handle, !aBlanc);

      if (result === 'deconnecte') {
        log('Pas de session X dans ce navigateur : connecte-toi sur x.com puis relance.', 'err');
        break;
      }
      if (result.startsWith('erreur')) {
        etat[cle] = 'erreur';
        erreursDeSuite++;
        log(`${prefixe} : ${result}`, 'err');
        log(`  repères présents : ${await executer(tabId, reperesDeLaPage)}`, 'gris');
      } else {
        if (result !== 'serait_bloque') etat[cle] = result;
        erreursDeSuite = 0;
        log(`${prefixe} : ${LIBELLES[result]}`, result === 'bloque' ? 'ok' : 'gris');
      }
      await chrome.storage.local.set({ etat });

      // Plusieurs échecs d'affilée = limite de débit X ou interface changée : insister risque un verrouillage du compte.
      if (erreursDeSuite >= 3) {
        log('3 erreurs de suite, arrêt. Réessaie plus tard.', 'err');
        break;
      }
      if (result === 'bloque' || result === 'serait_bloque' || result === 'a_verifier_plus_tard') actions++;
      // Seuls les blocages comptent dans la limite de X : un profil simplement consulté n'a pas besoin de pause.
      const aAgi = result === 'bloque' || result === 'a_verifier_plus_tard' || result.startsWith('erreur');
      if (aAgi && actions < max && i < aTraiter.length - 1 && !arret) await pause((dMin + Math.random() * (dMax - dMin)) * 1000);
    }
  } catch (e) {
    log(`Erreur Firefox : ${e?.message ?? String(e)}`, 'err');
    console.error('Blockfacho : erreur pendant le traitement', e);
  } finally {
    await chrome.windows.remove(fenetre.id).catch(() => {});
    $('lancer').disabled = false;
    $('arreter').disabled = true;
    log(arret ? 'Arrêté.' : 'Terminé.');
    afficherResume();
    afficherCategories();
  }
}

$('lancer').onclick = lancer;
$('arreter').onclick = () => {
  arret = true;
  log('Arrêt demandé, fin après le compte en cours.', 'gris');
};

({ etat = {} } = await chrome.storage.local.get('etat'));
try {
  comptes = await chargerComptes();
  afficherResume();
  afficherCategories();
  $('lancer').disabled = false;
} catch (e) {
  $('resume').textContent = `Annuaire injoignable (${e.message}). Recharge la page plus tard.`;
}
