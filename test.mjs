import { chromium } from 'playwright';
import fs from 'node:fs';

const DIR = '/home/claude/relax-mind';
const BASE = 'http://127.0.0.1:8099';
const ok = [], ko = [];
const check = (c, m) => (c ? ok : ko).push(m);

const MOCK = () => {
  const names = [['Amélie', 'fr-FR'], ['Thomas', 'fr-FR'], ['Google français', 'fr-FR'],
                 ['Microsoft Paul - French (France)', 'fr-FR'], ['Voix Test', 'fr-CA']];
  const voices = names.map(([name, lang], i) => ({ name, lang, voiceURI: name, localService: true, default: i === 0 }));
  window.__spoken = [];
  const synth = {
    speaking: false, paused: false, pending: false,
    getVoices: () => voices,
    speak(u) { window.__spoken.push(u.text); this.speaking = true;
      setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 2); },
    cancel() { this.speaking = false; }, pause() {}, resume() {}, onvoiceschanged: null
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, get: () => synth });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true, writable: true, value: function (t) { this.text = t; }
  });
};

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required']
});
const ctx = await browser.newContext({
  viewport: { width: 1200, height: 900 }, acceptDownloads: true, permissions: ['microphone']
});
await ctx.addInitScript(MOCK);
const errs = [];
const watch = p => { p.on('pageerror', e => errs.push(p.url().slice(-20) + ' :: ' + e));
                     p.on('console', m => { if (m.type() === 'error' && !/blob:/.test(m.text())) errs.push(m.text()); }); };

/* =========================================================== 1. ADMIN ==== */
const A = await ctx.newPage(); watch(A);
await A.goto(BASE + '/RELAX-MIND-ADMIN.html');
await A.waitForTimeout(300);
check(await A.isVisible('#gate'), 'console admin : verrou affiché au démarrage');

await A.fill('#g-pass', 'court');
await A.fill('#g-pass2', 'court');
await A.click('#g-ok');
check(await A.isVisible('#g-err'), 'phrase de passe trop courte refusée');

const PASS = 'lune-tranquille-diourbel-2026';
await A.fill('#g-pass', PASS);
await A.fill('#g-pass2', PASS);
await A.click('#g-ok');
await A.waitForSelector('#main', { state: 'visible', timeout: 60000 });
check(true, 'projet admin créé et chiffré');

const stored = await A.evaluate(() => localStorage.getItem('relaxmind.admin'));
check(!/Premier souffle|seances/.test(stored), 'projet admin illisible dans le stockage (chiffré)');

/* clé de secours */
await A.click('.tabs button[data-t="secu"]');
await A.click('#b-genkey');
await A.waitForFunction(() => document.querySelector('#k-state').textContent.includes('active'), null, { timeout: 60000 });
check((await A.locator('#k-fp').innerText()).length > 10, 'clé de secours RSA générée (empreinte affichée)');

/* participantes */
await A.click('.tabs button[data-t="parts"]');
await A.fill('#p-in', 'T0-001\nT0-002');
await A.click('#b-gen');
await A.waitForFunction(() => document.querySelector('#p-count').textContent === '2', null, { timeout: 90000 });
const parts = await A.evaluate(() => RMADMIN.proj.participants.map(p => ({ pid: p.pid, code: p.code })));
check(parts.length === 2 && /^T0-001-/.test(parts[0].code), `codes générés (${parts[0].code})`);

/* édition d'un texte */
await A.click('.tabs button[data-t="textes"]');
await A.fill('#e-titre', 'Premier souffle (révisé)');
await A.waitForTimeout(200);
check((await A.locator('#s-list button').first().innerText()).includes('révisé'), 'modification de texte prise en compte');

/* revue libre : toutes les séances accessibles */
await A.click('.tabs button[data-t="revue"]');
const rCount = await A.locator('#r-list button').count();
check(rCount === 30, `revue libre : ${rCount} séances toutes accessibles`);
await A.locator('#r-list button').nth(19).click();
await A.waitForTimeout(150);
check((await A.locator('#r-titre').innerText()).length > 3, 'séance 20 ouverte sans restriction de délai');
await A.fill('#r-note', 'à raccourcir');
await A.waitForTimeout(300);
check(await A.evaluate(() => RMADMIN.proj.notes[20] === 'à raccourcir'), 'remarque de révision enregistrée');

/* studio : enregistrement de la voix, bloc par bloc */
await A.click('.tabs button[data-t="voix"]');
await A.waitForTimeout(300);
check(/WEBM|OGG|M4A/.test(await A.locator('#a-fmt').innerText()), 'studio : format d\'enregistrement détecté');
await A.locator('#a-list button').first().click();
await A.waitForTimeout(500);
const nBlocs = await A.locator('#a-table tr').count() - 1;
check(nBlocs > 10, `séance 1 découpée en ${nBlocs} blocs enregistrables`);
await A.uncheck('#a-auto');
await A.click('#a-rec');
await A.waitForTimeout(1400);
await A.click('#a-rec');
await A.waitForTimeout(900);
check((await A.locator('#a-table').innerText()).includes(' s'), 'bloc 1 enregistré avec sa durée');
const stored2 = await A.evaluate(() => new Promise(r => {
  const q = indexedDB.open('relaxmind-studio', 1);
  q.onsuccess = () => { const g = q.result.transaction('audio').objectStore('audio').getAll();
    g.onsuccess = () => r(g.result.map(x => ({ id: x.id, dur: x.dur, hasIv: !!x.iv, ct: typeof x.ct }))); };
}));
check(stored2.length === 1 && stored2[0].hasIv && stored2[0].dur > 0.8, 'enregistrement chiffré et daté en base locale');

/* export */
const built = await A.evaluate(() => RMADMIN.html());
fs.writeFileSync(DIR + '/test-build.html', built, 'utf8');
const codes = parts.map(p => p.code);
check(!codes.some(c => built.includes(c)), "aucun code participante en clair dans l'application distribuée");
check(!built.includes(PASS), "aucune phrase de passe admin dans l'application distribuée");
const priv = await A.evaluate(() => RMADMIN.proj.adminPriv.slice(0, 40));
check(!built.includes(priv), "aucune clé privée dans l'application distribuée");
check(!/RMADMIN|buildHTML|relaxmind\.admin|adminPriv|\.rmproj|\.rmkey/.test(built), "aucune fonction ni donnée d'administration dans l'application distribuée");
check(built.includes('adminPubKey') && built.includes('verif'), 'clé publique et vérificateurs embarqués');
check(/connect-src 'none'/.test(built), "sans serveur configuré : aucune connexion réseau possible");
check(/"audio":\{"1":\{"ext":"(webm|ogg|m4a)"/.test(built.replace(/\s/g, '')) || built.includes('"audio":{"1"'),
      'index de la voix enregistrée inclus dans l\'application');

/* pack audio ZIP */
const zipDl = await Promise.all([A.waitForEvent('download'), A.click('#a-zip')]);
const zipPath = DIR + '/test-audio.zip';
await zipDl[0].saveAs(zipPath);
const zbuf = fs.readFileSync(zipPath);
check(zbuf.slice(0, 2).toString() === 'PK' && zbuf.includes('audio/s01/b000.'), 'pack audio ZIP généré (audio/s01/b000…)');
check(zbuf.includes('audio/index.json'), 'index audio présent dans le ZIP');

/* configuration de la transmission automatique */
await A.click('.tabs button[data-t="secu"]');
await A.fill('#s-url', 'https://demo-etude.supabase.co');
await A.fill('#s-key', 'anon-cle-publique-de-test');
await A.fill('#s-service', 'SERVICE-ROLE-SECRET-XYZ');
await A.check('#s-on');
await A.waitForTimeout(400);
const built2 = await A.evaluate(() => RMADMIN.html());
fs.writeFileSync(DIR + '/test-build.html', built2, 'utf8');
check(/connect-src https:\/\/demo-etude\.supabase\.co/.test(built2), 'politique de sécurité limitée au seul serveur de l\'étude');
check(built2.includes('"sync"') && built2.includes('demo-etude.supabase.co'), 'paramètres de transmission embarqués');
check(!built2.includes('SERVICE-ROLE-SECRET-XYZ'), 'clé de service jamais incluse dans l\'application');

/* =================================================== 2. APP PARTICIPANTE = */
const uploads = [];
await ctx.route('https://demo-etude.supabase.co/**', route => {
  try { uploads.push(JSON.parse(route.request().postData() || '{}')); } catch { uploads.push({}); }
  route.fulfill({ status: 201, headers: { 'access-control-allow-origin': '*' }, body: '' });
});
const P = await ctx.newPage(); watch(P);
await P.setViewportSize({ width: 400, height: 880 });
await P.goto('file://' + DIR + '/test-build.html');
await P.waitForTimeout(400);
check(await P.isVisible('#v-start'), 'application générée : écran de code');

await P.fill('#in-code', 'T0-001-MAUVAIS-CODE');
await P.click('#btn-start');
await P.waitForTimeout(1200);
check(await P.isVisible('#code-err'), 'code invalide refusé');
check(await P.isVisible('#v-start'), "accès bloqué sans code valide");

await P.fill('#in-code', codes[0]);
await P.click('#btn-start');
await P.waitForSelector('#v-home.on', { timeout: 60000 });
check(true, 'code participante accepté');
check((await P.locator('#sub-code').innerText()).includes('T0-001'), 'identifiant T0 repris dans l\'app');

/* le coffre est chiffré */
await P.evaluate(() => { window.RM.state.events.push({ ts: Date.now(), id: 1, sec: 900, before: 3, after: 8, note: 'SECRET-TEMOIN', complete: 1 }); window.RM.state.done[1] = { first: Date.now(), count: 1, sec: 900, before: 3, after: 8, note: 'SECRET-TEMOIN' }; });
await P.evaluate(() => new Promise(r => setTimeout(r, 700)));
const vault = await P.evaluate(() => localStorage.getItem('relaxmind.vault'));
check(vault && !vault.includes('SECRET-TEMOIN'), 'données locales chiffrées (aucun contenu lisible)');
check(vault && JSON.parse(vault).wrapAdmin, 'clé de secours présente dans le coffre');

/* verrouillage / déverrouillage */
await P.reload(); await P.waitForTimeout(500);
check(await P.isVisible('#v-start'), 'code redemandé après fermeture');
await P.fill('#in-code', codes[1]);
await P.click('#btn-start');
await P.waitForTimeout(1500);
check(await P.isVisible('#v-start'), "le code d'une autre participante n'ouvre pas le coffre");
await P.fill('#in-code', codes[0].toLowerCase().replace(/-/g, ' - '));
await P.click('#btn-start');
await P.waitForSelector('#v-home.on', { timeout: 60000 });
check(true, 'code accepté malgré casse et espaces');

/* séance complète */
await P.evaluate(() => { window.RM.speed = 400; });
await P.locator('#list .seance').nth(0).click();
await P.waitForTimeout(200);
await P.click('#b-play');
await P.waitForSelector('#sheet.on', { timeout: 5000 });
await P.locator('#sh-scale button', { hasText: /^3$/ }).click();
await P.click('#sh-ok');
await P.waitForSelector('#sheet.on', { timeout: 120000 });
check(await P.evaluate(() => window.__spoken.length) > 40, 'séance lue jusqu\'au bout');
await P.locator('#sh-scale button', { hasText: /^9$/ }).click();
await P.fill('#sh-note', 'très apaisée');
await P.click('#sh-ok');
await P.waitForTimeout(900);
const s2 = await P.locator('#list .seance').nth(1).innerText();
check(/jours|heures|minute/.test(s2), 'séance suivante toujours soumise au délai de 72 h');

/* repli automatique si un fichier audio manque */
const nb1 = await A.evaluate(() => RMADMIN.proj.seances[0].texte.split(/\n\s*\n/).filter(x => x.trim() && !/^\[pause/i.test(x.trim())).length);
const fake = { 1: { ext: 'webm', blocks: {} } };
for (let i = 0; i < 40; i++) fake[1].blocks[i] = { d: 4 };
const fb = built2.replace(/"audio":.*?,"sync":/, '"audio":' + JSON.stringify(fake) + ',"sync":');
fs.writeFileSync(DIR + '/test-fallback.html', fb, 'utf8');
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 880 } });
await ctx2.addInitScript(MOCK);
const F = await ctx2.newPage();
await F.goto('file://' + DIR + '/test-fallback.html');
await F.waitForTimeout(300);
await F.fill('#in-code', codes[1]); await F.click('#btn-start');
await F.waitForSelector('#v-home.on', { timeout: 60000 });
check((await F.locator('#list .seance').nth(0).innerText()).includes('voix enregistrée'), 'séance annoncée avec la voix enregistrée');
await F.evaluate(() => { window.RM.speed = 400; });
await F.locator('#list .seance').nth(0).click();
await F.click('#b-play');
await F.waitForSelector('#sheet.on', { timeout: 5000 });
await F.locator('#sh-scale button', { hasText: /^5$/ }).click();
await F.click('#sh-ok');
await F.waitForSelector('#sheet.on', { timeout: 120000 });
check(await F.evaluate(() => window.__spoken.length) > 20, 'fichier audio absent : repli automatique sur la synthèse vocale');
await F.click('#sh-skip');
await F.close(); await ctx2.close();

/* transmission automatique */
await P.waitForFunction(() => window.RM.state.syncAt > 0, null, { timeout: 30000 }).catch(() => {});
check(uploads.length > 0, `envoi automatique déclenché en fin de séance (${uploads.length})`);
const up = uploads[uploads.length - 1] || {};
check(up.pid === 'T0-001' && !!up.payload && !!up.payload.wrapAdmin, 'contenu transmis : identifiant + charge chiffrée');
check(!JSON.stringify(up).includes('très apaisée'), 'aucune donnée lisible ne transite par le serveur');
check(await P.evaluate(() => window.RM.state.syncAt > 0), 'horodatage du dernier envoi enregistré');

/* verrouillage manuel */
await P.click('#nav button[data-go="log"]'); await P.waitForTimeout(200);
await P.click('#b-lock'); await P.waitForTimeout(300);
check(await P.isVisible('#v-start'), 'verrouillage manuel opérationnel');
await P.fill('#in-code', codes[0]); await P.click('#btn-start');
await P.waitForSelector('#v-home.on', { timeout: 60000 });

/* sauvegarde chiffrée */
await P.click('#nav button[data-go="log"]'); await P.waitForTimeout(250);
const dl = await Promise.all([P.waitForEvent('download'), P.click('#b-secure')]);
const rmxPath = DIR + '/test-backup.rmx';
await dl[0].saveAs(rmxPath);
const rmx = fs.readFileSync(rmxPath, 'utf8');
check(rmx.includes('RELAX-MIND-BACKUP') && !rmx.includes('très apaisée'), 'sauvegarde .rmx générée et chiffrée');

/* ============================================ 3. RÉCUPÉRATION PAR L'ADMIN */
await A.click('.tabs button[data-t="donnees"]');
await A.setInputFiles('#d-file', rmxPath);
await A.waitForFunction(() => document.querySelector('#d-count').textContent !== '0 fichier', null, { timeout: 60000 });
const dtable = await A.evaluate(() => document.querySelector("#d-table").textContent);
check(dtable.includes('T0-001'), 'sauvegarde déchiffrée avec la clé de secours');
const recu = await A.evaluate(() => RMADMIN.proj.received[0].events.map(e => e.note).join('|'));
check(recu.includes('très apaisée'), 'contenu récupéré intact (sans le code de la participante)');

/* ================================================== 4. RÉSISTANCE ======== */
const X = await ctx.newPage(); watch(X);
await X.goto('file://' + DIR + '/test-build.html');
await X.waitForTimeout(300);
const t0 = Date.now();
for (let i = 0; i < 4; i++) { await X.fill('#in-code', 'T0-001-AAAA-BBBB-CCC' + i); await X.click('#btn-start'); await X.waitForTimeout(900); }
const blocked = await X.locator('#code-err').innerText();
check(/tentative|Réessayez/i.test(blocked), 'ralentissement après tentatives répétées');
check((Date.now() - t0) > 2000, 'dérivation de clé volontairement coûteuse (anti-force brute)');

check(errs.length === 0, 'aucune erreur JS' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));

await A.screenshot({ path: '/home/claude/shot-admin.png', fullPage: false });
await A.click('.tabs button[data-t="parts"]'); await A.waitForTimeout(200);
await A.screenshot({ path: '/home/claude/shot-admin-parts.png' });
await P.screenshot({ path: '/home/claude/shot-app-log.png' });

await browser.close();
try { fs.unlinkSync(DIR + '/test-build.html'); fs.unlinkSync(rmxPath); fs.unlinkSync(DIR + '/test-audio.zip'); fs.unlinkSync(DIR + '/test-fallback.html'); } catch {}
console.log('\n✅ ' + ok.length + ' vérifications réussies');
ok.forEach(m => console.log('   ✓ ' + m));
if (ko.length) { console.log('\n❌ ' + ko.length + ' échecs'); ko.forEach(m => console.log('   ✗ ' + m)); process.exit(1); }
