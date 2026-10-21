/*
 * Servidor de ENSAIO: imita os arquivos do TSE durante uma apuração, reprisando uma eleição
 * real seção por seção, na ordem em que as seções foram totalizadas.
 *
 *   node replay.js --secoes /opt/projecao/base/secoes_2022_2.json --porta 8081 --velocidade 4 --inicio -3
 *
 * --velocidade 4 = 4 minutos de apuração por minuto real; --inicio -3 = começa às 16h57.
 * Só os dois candidatos (13 e 22) entram nos arquivos, como num 2º turno.
 */
'use strict';
const http = require('http');
const fs = require('fs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SECOES = arg('secoes', '/opt/projecao/base/secoes_2026_1.json');
const PORTA = +arg('porta', 8081);
let VEL = +arg('velocidade', 4);
let INICIO = +arg('inicio', -3);
const ANO = arg('ano', '2026'), ELE = arg('ele', '6258');
const E6 = 'e' + ELE.padStart(6, '0');
const DATA = arg('data', '25/10/2026');
const RECUSAR = +arg('recusar', 0);   // teste: fração dos pedidos de município que recebe 403 (como um bloqueio do TSE)
let T0 = Date.now();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const S = JSON.parse(fs.readFileSync(SECOES, 'utf8'));
const N = S.mun.length;
let maxT = 0;
for (let i = 0; i < N; i++) if (S.tt[i] < 9000 && S.tt[i] > maxT) maxT = S.tt[i];

function novoGrupo() { return {tt: [], ap: [0], co: [0], pt: [0], ad: [0], br: [0], nu: [0], totAp: 0}; }
function somar(g, i) {
  const k = g.tt.length;
  g.tt.push(S.tt[i] >= 9000 ? maxT + 1 : S.tt[i]);
  g.ap.push(g.ap[k] + S.aptos[i]); g.co.push(g.co[k] + S.comp[i]); g.pt.push(g.pt[k] + S.pt[i]);
  g.ad.push(g.ad[k] + S.adv[i]); g.br.push(g.br[k] + S.bra[i]); g.nu.push(g.nu[k] + S.nul[i] + (S.anu ? S.anu[i] : 0));
  g.totAp += S.aptos[i];
}
const BR = novoGrupo(), UF = new Map(), MUN = new Map();
for (let i = 0; i < N; i++) {
  const uf = S.uf[i].toLowerCase(), m = S.mun[i];
  somar(BR, i);
  if (!UF.has(uf)) UF.set(uf, novoGrupo());
  somar(UF.get(uf), i);
  if (!MUN.has(m)) MUN.set(m, Object.assign(novoGrupo(), {uf}));
  somar(MUN.get(m), i);
}
log(`ensaio: ${N} seções, ${MUN.size} municípios, ${UF.size} UFs, última seção às ${(17 + maxT / 60).toFixed(2)}h`);

const tSim = () => INICIO + (Date.now() - T0) / 60000 * VEL;
function contar(g, t) { // seções com horário <= t
  let lo = 0, hi = g.tt.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (g.tt[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo;
}
function hora(t) {
  const min = Math.floor(17 * 60 + t);
  const s = Math.floor((t - Math.floor(t)) * 60);
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function arquivo(g, tp, cd, k, t) {
  const pt = g.pt[k], ad = g.ad[k];
  return {
    ele: ELE, t: '2', f: 'o', tpabr: tp, cdabr: cd, dg: DATA, hg: hora(Math.max(0, t)),
    s: {ts: String(g.tt.length), st: String(k)},
    e: {te: String(g.totAp), est: String(g.ap[k]), c: String(g.co[k]), a: String(g.ap[k] - g.co[k])},
    v: {vv: String(pt + ad), vb: String(g.br[k]), tvn: String(g.nu[k])},
    carg: [{cd: '1', agr: [{par: [{n: '13', cand: [{n: '13', vap: String(pt)}]}]}, {par: [{n: '22', cand: [{n: '22', vap: String(ad)}]}]}]}]
  };
}
function config() {
  const abr = [];
  for (const uf of [...UF.keys()].sort()) {
    const mu = [];
    for (const [m, g] of MUN) if (g.uf === uf) mu.push({cd: String(m).padStart(5, '0'), cdi: '', nm: '', c: 'n', z: []});
    abr.push({cd: uf, ds: uf.toUpperCase(), mu});
  }
  return {dg: DATA, hg: '00:00:00', f: 'o', abr};
}

const RX_UF = new RegExp(`^/oficial/ele${ANO}/${ELE}/dados/([a-z]{2})/([a-z]{2})(\\d{5})?-c0001-${E6}-u\\.json$`);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const t = tSim();
  const enviar = (obj, etag) => {
    if (etag && req.headers['if-none-match'] === etag) { res.writeHead(304, {ETag: etag}); return res.end(); }
    const corpo = JSON.stringify(obj);
    const h = {'Content-Type': 'application/json', 'Cache-Control': 'max-age=5', 'Access-Control-Allow-Origin': '*'};
    if (etag) h.ETag = etag;
    res.writeHead(200, h); res.end(corpo);
  };
  if (p === '/ensaio/status') return enviar({t, hora: hora(Math.max(0, t)), vel: VEL, apurado: contar(BR, t), total: N});
  if (p === '/ensaio/reiniciar') {
    INICIO = +(url.searchParams.get('inicio') || INICIO); VEL = +(url.searchParams.get('velocidade') || VEL); T0 = Date.now();
    log('reiniciado', INICIO, VEL);
    return enviar({ok: true, inicio: INICIO, vel: VEL});
  }
  if (p === `/oficial/ele${ANO}/${ELE}/config/mun-${E6}-cm.json`) return enviar(config(), '"cfg"');
  if (p === `/oficial/ele${ANO}/${ELE}/dados/br/br-c0001-${E6}-u.json`) { const k = contar(BR, t); return enviar(arquivo(BR, 'br', 'br', k, t), `"br-${k}"`); }
  const m = RX_UF.exec(p);
  if (m) {
    const uf = m[1];
    if (m[2] !== uf) { res.writeHead(404); return res.end(); }
    if (!m[3]) { const g = UF.get(uf); if (!g) { res.writeHead(404); return res.end(); } const k = contar(g, t); return enviar(arquivo(g, 'uf', uf, k, t), `"${uf}-${k}"`); }
    const g = MUN.get(parseInt(m[3], 10));
    if (!g) { res.writeHead(404); return res.end(); }
    if (RECUSAR && Math.random() < RECUSAR) { res.writeHead(403); return res.end(); }
    const k = contar(g, t);
    return enviar(arquivo(g, 'mu', m[3], k, t), `"${m[3]}-${k}"`);
  }
  res.writeHead(404); res.end();
}).listen(PORTA, '127.0.0.1', () => log(`ensaio ouvindo em 127.0.0.1:${PORTA} · velocidade ${VEL}× · início ${hora(Math.max(0, INICIO))}`));
