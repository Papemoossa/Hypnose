import { chromium } from 'playwright';
import fs from 'node:fs';

const DIR = '/home/claude/relax-mind';
const BASE = 'http://127.0.0.1:8123/index.html';
const ok = [], ko = [];
const check = (c, m) => (c ? ok : ko).push(m);

const MOCK = () => {
  const noms = [['Amélie','fr-FR'],['Thomas','fr-FR'],['Google français','fr-FR'],['Microsoft Paul - French (France)','fr-FR']];
  const voices = noms.map(([name, lang], i) => ({ name, lang, voiceURI: name, localService: true, default: i === 0 }));
  window.__dit = [];
  const synth = {
    speaking: false, paused: false, pending: false,
    getVoices: () => voices,
    speak(u) { window.__dit.push(u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 2); },
    cancel() { this.speaking = false; }, pause() {}, resume() {}, onvoiceschanged: null
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, writable: true, value: function (t) { this.text = t; } });
};

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, permissions: ['microphone'] });
await ctx.addInitScript(MOCK);
const errs = [];
const watch = p => { p.on('pageerror', e => errs.push(String(e)));
                     p.on('console', m => { if (m.type() === 'error' && !/blob:|favicon/.test(m.text())) errs.push(m.text()); }); };

const P = await ctx.newPage(); watch(P);
await P.goto(BASE); await P.waitForTimeout(500);

/* ─────────────────────────── 1. PORTE ─────────────────────────── */
check(await P.isVisible('#v-porte'), "écran d'accueil avec le logo affiché");
check((await P.locator('.logo-grand').getAttribute('src')).includes('logo'), 'logo fourni utilisé sur l\'accueil');

await P.click('#ong-porte button[data-r="adm"]');
await P.fill('#in-adm', 'mauvais');
await P.click('#b-entrer');
await P.waitForTimeout(1200);
check(await P.isVisible('#err-porte'), 'mot de passe administrateur erroné refusé');

await P.fill('#in-adm', 'RELAX@my_mind2026');
await P.click('#b-entrer');
await P.waitForSelector('#v-admin.on', { timeout: 30000 });
check(true, 'mot de passe RELAX@my_mind2026 accepté');

/* ─────────────────────────── 2. ADMIN ─────────────────────────── */
await P.click('#ong-admin button[data-t="users"]');
await P.fill('#u-in', 'T0-001\nT0-002');
await P.fill('#u-groupe', 'intervention');
await P.click('#b-u-add');
await P.waitForTimeout(400);
check(await P.locator('#u-nb').innerText() === '3', 'participantes créées (+ compte de test)');
const users = await P.evaluate(() => RM.db.users.map(u => ({ pid: u.pid, pin: u.pin, test: !!u.test })));
const u1 = users.find(u => u.pid === 'T0-001');
check(/^\d{4}$/.test(u1.pin), `code à 4 chiffres généré (${u1.pin})`);
check(users.some(u => u.pid === 'TEST' && u.test), 'compte de test présent');

await P.click('#ong-admin button[data-t="bord"]');
await P.waitForTimeout(300);
check((await P.locator('#tbl-progression').innerText()).includes('T0-001'), 'tableau de progression alimenté');

/* textes + cadence */
await P.click('#ong-admin button[data-t="textes"]');
await P.waitForTimeout(300);
check(await P.locator('#l-textes button').count() === 30, '30 séances éditables');
await P.fill('#t-titre', 'Premier souffle (révisé)');
await P.waitForTimeout(250);
check((await P.locator('#l-textes button').first().innerText()).includes('révisé'), 'modification du texte enregistrée');
await P.check('#c-perso');
await P.locator('#c-rate').evaluate(e => { e.value = '0.7'; e.dispatchEvent(new Event('input', { bubbles: true })); });
await P.waitForTimeout(250);
const cad = await P.evaluate(() => RM.db.cadence[1]);
check(cad && cad.perso && Math.abs(cad.rate - 0.7) < 0.01, 'cadence propre à la séance enregistrée');

/* studio multi-voix */
await P.click('#ong-admin button[data-t="studio"]');
await P.waitForTimeout(300);
check(/WEBM|OGG|M4A/.test(await P.locator('#a-fmt').innerText()), 'studio : format d\'enregistrement détecté');
P.on('dialog', d => d.accept('Ma voix douce'));
await P.click('#b-jeu-new');
await P.waitForTimeout(400);
await P.evaluate(() => { const id = 'v' + Date.now().toString(36) + 'b'; RM.db.jeux.push({ id, nom: 'Voix grave', cree: Date.now() }); });
await P.click('#ong-admin button[data-t="bord"]'); await P.click('#ong-admin button[data-t="studio"]');
await P.waitForTimeout(300);
check(await P.locator('#s-jeu option').count() === 2, 'plusieurs jeux de voix pour les mêmes textes');
await P.locator('#l-studio button').first().click();
await P.waitForTimeout(400);
const nb = await P.locator('#tbl-blocs tr').count() - 1;
check(nb > 10, `séance 1 découpée en ${nb} blocs enregistrables`);
await P.uncheck('#ch-auto');
await P.click('#b-enr'); await P.waitForTimeout(1300); await P.click('#b-enr'); await P.waitForTimeout(900);
const clips = await P.evaluate(() => Object.keys(RM.db.clips).length);
check(clips === 1, 'bloc enregistré et stocké');

/* ─────────────────────────── 3. PARTICIPANTE ─────────────────────────── */
await P.click('#b-adm-sortir'); await P.waitForTimeout(400);
check(await P.isVisible('#v-porte'), 'déconnexion administrateur');

await P.click('#ong-porte button[data-r="part"]');
await P.fill('#in-pid', 'T0-001'); await P.fill('#in-pin', '0000');
await P.click('#b-entrer'); await P.waitForTimeout(400);
check(await P.isVisible('#err-porte'), 'code incorrect refusé');

await P.fill('#in-pin', u1.pin);
await P.click('#b-entrer');
await P.waitForSelector('#v-seances.on', { timeout: 15000 });
check(true, 'connexion participante avec identifiant T0 + code');
check(await P.locator('#liste-seances .seance').count() === 30, '30 séances listées');
const c1 = await P.locator('#liste-seances .seance').nth(0).getAttribute('class');
const c2 = await P.locator('#liste-seances .seance').nth(1).getAttribute('class');
check(!c1.includes('verrou') && c2.includes('verrou'), 'séance 1 ouverte, séance 2 verrouillée');

/* séance complète */
await P.evaluate(() => { window.RM.vitesse = 500; });
await P.locator('#liste-seances .seance').nth(0).click();
await P.waitForTimeout(300);
await P.click('#b-lire');
await P.waitForSelector('#feuille.on', { timeout: 6000 });
check((await P.locator('#fe-titre').innerText()).includes('Avant'), 'évaluation AVANT la séance demandée');
await P.locator('#fe-ech button', { hasText: /^3$/ }).click();
await P.click('#fe-ok');
await P.waitForSelector('#feuille.on', { timeout: 180000 });
check(await P.evaluate(() => window.__dit.length) > 40, 'séance lue jusqu\'au bout');
check((await P.locator('#fe-titre').innerText()).includes('Après'), 'évaluation APRÈS la séance demandée');
check(await P.isVisible('#fe-etoiles-w'), 'notation de la qualité du texte proposée');
check(await P.locator('#fe-etoiles button').count() === 10, 'échelle de 1 à 10 étoiles');
await P.locator('#fe-ech button', { hasText: /^9$/ }).click();
await P.locator('#fe-etoiles button').nth(7).click();
await P.fill('#fe-rem', 'très apaisant');
await P.click('#fe-ok');
await P.waitForTimeout(1200);

const ses = await P.evaluate(() => RM.db.sessions[0]);
check(ses && ses.avant === 3 && ses.apres === 9 && ses.etoiles === 8, 'évaluations enregistrées (avant 3, après 9, 8★)');
check(ses.remarque === 'très apaisant', 'remarque libre enregistrée');

/* délai de 48 h */
const h = await P.evaluate(() => {
  const t = RM.db.sessions[0].fin + RM.db.cfg.delaiHeures * 3600000 - Date.now();
  return Math.round(t / 3600000);
});
check(h >= 47 && h <= 48, `délai de déblocage = ${h} h (attendu 48)`);
const s2 = await P.locator('#liste-seances .seance').nth(1).innerText();
check(/jours|heures|minute/.test(s2), 'séance 2 annoncée avec son délai');
check((await P.locator('#liste-seances .seance').nth(0).getAttribute('class')).includes('fait'), 'séance 1 marquée comme faite');
await P.locator('#liste-seances .seance').nth(0).click();
await P.waitForTimeout(300);
check(await P.isVisible('#v-lecteur'), 'séance déjà débloquée reste accessible à souhait');
await P.click('#b-retour');

/* journal */
await P.click('#nav button[data-v="journal"]'); await P.waitForTimeout(400);
check(await P.locator('#k-faites').innerText() === '1', 'compteur de séances du journal');
check(await P.locator('#k-gain').innerText() === '+6.0', 'gain de détente calculé (+6)');
check(await P.locator('#k-etoiles').innerText() === '8.0', 'note moyenne des textes');

/* ─────────────────────────── 4. COMPTE DE TEST ─────────────────────────── */
await P.click('#b-sortir'); await P.waitForTimeout(400);
await P.fill('#in-pid', 'TEST'); await P.fill('#in-pin', '0000');
await P.click('#b-entrer');
await P.waitForSelector('#v-seances.on', { timeout: 15000 });
const verrous = await P.locator('#liste-seances .seance.verrou').count();
check(verrous === 0, 'compte de test : les 30 séances sont ouvertes, sans attente');
check((await P.locator('#sous-titre').innerText()).includes('illimité'), 'compte de test signalé comme illimité');

/* ─────────────────────────── 5. SYNTHÈSE & EXPORTS ─────────────────────────── */
await P.click('#nav button[data-v="journal"]'); await P.waitForTimeout(300);
await P.click('#b-sortir'); await P.waitForTimeout(300);
await P.click('#ong-porte button[data-r="adm"]');
await P.fill('#in-adm', 'RELAX@my_mind2026');
await P.click('#b-entrer');
await P.waitForSelector('#v-admin.on', { timeout: 30000 });
await P.click('#ong-admin button[data-t="synthese"]');
await P.waitForTimeout(400);
check(await P.locator('#s-n').innerText() === '1', 'synthèse : séances comptabilisées');
check(await P.locator('#s-gain').innerText() === '+6.0', 'synthèse : gain moyen');
check(await P.locator('#s-et').innerText() === '8.0', 'synthèse : qualité moyenne des textes');
check((await P.locator('#tbl-remarques').innerText()).includes('très apaisant'), 'remarques compilées');

const dl = await Promise.all([P.waitForEvent('download'), P.click('#b-s-csv')]);
const csv = fs.readFileSync(await dl[0].path(), 'utf8');
check(csv.includes('qualite_texte_sur_10') && csv.includes('T0-001'), 'export CSV complet des données');
const dl2 = await Promise.all([P.waitForEvent('download'), P.click('#b-s-syn')]);
const csv2 = fs.readFileSync(await dl2[0].path(), 'utf8');
check(csv2.split('\n').length === 31, 'export CSV de synthèse : 30 lignes de séances');

/* persistance */
await P.reload(); await P.waitForTimeout(700);
const garde = await P.evaluate(() => RM.db.sessions.length + '|' + RM.db.users.length + '|' + RM.db.jeux.length);
check(garde === '1|3|2', 'données conservées après rechargement');

check(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));

/* captures */
await P.setViewportSize({ width: 420, height: 900 });
await P.waitForTimeout(600);
await P.screenshot({ path: '/home/claude/cap-accueil.png' });
await P.click('#ong-porte button[data-r="part"]');
await P.fill('#in-pid', 'TEST'); await P.fill('#in-pin', '0000'); await P.click('#b-entrer');
await P.waitForSelector('#v-seances.on'); await P.waitForTimeout(900);
await P.screenshot({ path: '/home/claude/cap-seances.png' });
await P.locator('#liste-seances .seance').nth(2).click(); await P.waitForTimeout(700);
await P.screenshot({ path: '/home/claude/cap-lecteur.png' });
await P.click('#b-retour'); await P.click('#nav button[data-v="journal"]');
await P.waitForTimeout(300); await P.click('#b-sortir'); await P.waitForTimeout(300);
await P.setViewportSize({ width: 1200, height: 900 });
await P.click('#ong-porte button[data-r="adm"]'); await P.fill('#in-adm', 'RELAX@my_mind2026'); await P.click('#b-entrer');
await P.waitForSelector('#v-admin.on', { timeout: 30000 }); await P.waitForTimeout(600);
await P.screenshot({ path: '/home/claude/cap-admin.png' });
await P.click('#ong-admin button[data-t="studio"]'); await P.waitForTimeout(500);
await P.locator('#l-studio button').first().click(); await P.waitForTimeout(500);
await P.screenshot({ path: '/home/claude/cap-studio.png' });

await browser.close();
console.log('\n✅ ' + ok.length + ' vérifications réussies');
ok.forEach(m => console.log('   ✓ ' + m));
if (ko.length) { console.log('\n❌ ' + ko.length + ' échecs'); ko.forEach(m => console.log('   ✗ ' + m)); process.exit(1); }
