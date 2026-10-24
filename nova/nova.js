/*
 * Projeção com o MODELO NOVO, para a página /nova (teste interno; o site principal não muda).
 *
 * Não pede nada ao TSE: lê o que o coletor principal já publica em /opt/projecao/saida
 * (nacional.json, cidades.json, ufs_hist.json), refaz a projeção com nova/modelo_nova.js e grava
 * os mesmos três arquivos em /opt/projecao/saida/nova (o site lê em /dados/nova/).
 *   ENTRADA  pasta lida (padrão /opt/projecao/saida)
 *   SAIDA    pasta gravada (padrão /opt/projecao/saida/nova)
 *   ESTADO   histórico da noite e "cravou" deste processo (padrão /opt/projecao/estado/nova)
 *   REFS     1º turno por cidade (padrão /opt/projecao/base/refs2026.json)
 *   CURVAS   urnas do 1º turno na ordem de chegada (padrão /opt/projecao/base/curvas_nova2026.json)
 *   LISTA    cidades do TSE com UF (padrão /opt/projecao/estado/municipios-cache.json; se faltar, usa REFS)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const MN = require('./modelo_nova.js');

const P = '/opt/projecao';
const CFG = {
  entrada: process.env.ENTRADA || `${P}/saida`,
  saida: process.env.SAIDA || `${P}/saida/nova`,
  estado: process.env.ESTADO || `${P}/estado/nova`,
  refs: process.env.REFS || `${P}/base/refs2026.json`,
  curvas: process.env.CURVAS || `${P}/base/curvas_nova2026.json`,
  lista: process.env.LISTA || `${P}/estado/municipios-cache.json`,
  intervalo: +(process.env.INTERVALO || 2000),
  umaVez: process.env.UMA_VEZ === '1'
};
fs.mkdirSync(CFG.saida, {recursive: true});
fs.mkdirSync(CFG.estado, {recursive: true});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const lerJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
function gravar(pasta, nome, obj) {
  const destino = path.join(pasta, nome), tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, destino);
}
const lerEstado = (nome, padrao) => { try { return lerJSON(path.join(CFG.estado, nome)); } catch (e) { return padrao; } };
function horaBR(ms) { return new Date(ms - 3 * 3600000).toISOString().slice(11, 19); }
function minDeHora(hg) {
  if (!hg || hg.length < 5) return NaN;
  let m = (+hg.slice(0, 2)) * 60 + (+hg.slice(3, 5)) + (hg.length >= 8 ? +hg.slice(6, 8) / 60 : 0) - 17 * 60;
  if (m < -660) m += 1440;
  return m;
}

// ---------- modelo ----------
const refs = lerJSON(CFG.refs);
const curvas = lerJSON(CFG.curvas);                       // sem curvas não há modelo novo: o processo para (e o systemd tenta de novo)
const porCod = new Map();
try { for (const m of lerJSON(CFG.lista)) porCod.set(+m.cod, m.uf); } catch (e) { log('lista do TSE indisponível; usando as cidades das referências'); }
for (const [cod, r] of Object.entries(refs)) if (!porCod.has(+cod) && r && r.uf) porCod.set(+cod, r.uf);
const LISTA = [...porCod].map(([cod, uf]) => ({cod, uf}));
const U = MN.montar(LISTA, refs, curvas);
const IDX = new Map(); for (let u = 0; u < U.n; u++) IDX.set(U.cod[u], u);
log(`modelo novo: ${U.n} cidades, ${U.C.comCurva} com a ordem de chegada do 1º turno, ${U.semRef} sem referência · LAM ${MN.LAM} · faixa x${MN.FATOR}`);

// ---------- estado da noite ----------
let chave = null, HIST = [], CRAVOU = null;
function trocarChave(nac) {
  const k = nac && nac.ensaio ? 'ensaio-' + String(nac.ensaio).replace(/[^a-z0-9]+/gi, '_').slice(0, 60) : 'ao-vivo';
  if (k === chave) return;
  chave = k;
  HIST = lerEstado(`hist-${chave}.json`, []);
  CRAVOU = lerEstado(`cravou-${chave}.json`, null);
  log('noite:', chave, `(${HIST.length} pontos no histórico)`);
}
const gravarEstado = (nome, obj) => gravar(CFG.estado, nome, obj);

// ---------- projeção ----------
let PROJ = null, PU = null, MODO = null;
function calcular(nac, cid) {
  const n = U.n, F = () => new Float64Array(n);
  const st = {x: F(), y: F(), v: F(), sc: F(), ts: F(), a: F(), A: F()};
  let secSom = 0, secTot = 0, comDados = 0, comEleitorado = 0, linhas = 0;
  for (const r of cid.c || []) {
    const u = IDX.get(+r[0]);
    if (u === undefined) continue;
    linhas++;
    st.sc[u] = +r[1] || 0; st.ts[u] = +r[2] || 0; st.x[u] = +r[3] || 0; st.y[u] = +r[4] || 0; st.v[u] = +r[5] || 0;
    if (r.length >= 9 && r[8] > 0) { st.a[u] = +r[7] || 0; st.A[u] = +r[8]; comEleitorado++; }
    secSom += st.sc[u]; secTot += st.ts[u];
    if (st.sc[u] > 0) comDados++;
  }
  MODO = linhas > 0 && comEleitorado === linhas ? 'eleitorado' : 'secoes';
  const pct = secTot > 0 ? 100 * secSom / secTot : 0;
  if (secSom === 0) { PROJ = {pct: 0, pronto: false, status: 'aguardando', comDados}; PU = null; return; }
  const r = MN.projetar(U, st, MODO);
  const pl2 = 100 * r.l2;
  const av = MN.avaliar(pl2, pct, MODO);
  const porUF = {}, somaReg = {}, porReg = {};
  for (const [uf, g] of Object.entries(r.porUF)) {
    porUF[uf] = +(100 * g.pt / (g.pt + g.adv)).toFixed(2);
    const k = MN.REG[uf] || 'EX', a = somaReg[k] || (somaReg[k] = {pt: 0, adv: 0});
    a.pt += g.pt; a.adv += g.adv;
  }
  for (const [k, a] of Object.entries(somaReg)) porReg[k] = +(100 * a.pt / (a.pt + a.adv)).toFixed(2);
  PU = new Map();
  let somaX = 0, somaY = 0;
  for (let u = 0; u < n; u++) { PU.set(U.cod[u], Number.isFinite(r.pu[u]) ? Math.round(10000 * r.pu[u]) : -1); somaX += st.x[u]; somaY += st.y[u]; }
  const falta = Math.max(0, r.pt + r.adv - somaX - somaY);
  const agora = Date.now();
  const hNoite = nac.ensaio && nac.tse && nac.tse.hg ? nac.tse.hg : horaBR(agora);
  // "cravou": mesma regra do site principal
  if (CRAVOU && !CRAVOU.desfeito && av.pronto && (av.lider !== CRAVOU.lider || av.ch < 0.95)) {
    CRAVOU.desfeito = {t: agora, hg: hNoite, pct: +pct.toFixed(2)};
    gravarEstado(`cravou-${chave}.json`, CRAVOU);
    log('*** deixou de cravar:', av.lider, pl2.toFixed(2), 'chance', av.ch.toFixed(3));
  }
  if ((!CRAVOU || CRAVOU.desfeito) && av.pronto && av.ch >= 0.99) {
    CRAVOU = {t: agora, hg: hNoite, pct: +pct.toFixed(2), lider: av.lider, l2: +pl2.toFixed(2), antes: CRAVOU || null};
    gravarEstado(`cravou-${chave}.json`, CRAVOU);
    log('*** cravou:', av.lider, pl2.toFixed(2), 'com', pct.toFixed(2), '%');
  }
  const status = CRAVOU && !CRAVOU.desfeito && av.pronto ? 'vence' : av.status;
  PROJ = {pct: +pct.toFixed(3), l2: +pl2.toFixed(3), sig: +av.sig.toFixed(3), m2: +av.m2.toFixed(3), chAdv: +av.chAdv.toFixed(5), lider: av.lider,
    status, pronto: av.pronto, uf: porUF, reg: porReg, comDados, falta: Math.round(falta), faltaL: falta > 0 ? +((r.pt - somaX) / falta).toFixed(4) : null};
  const mTSE = minDeHora(hNoite);
  const br = nac.br;
  const bruto = br && br.A + br.B > 0 ? 100 * br.A / (br.A + br.B) : null;
  const ult = HIST[HIST.length - 1];
  if (av.pronto && (!ult || pct - ult[1] >= 0.2 || agora - ult[0] > 90000 || (pct >= 100 && ult[1] < 100))) {
    HIST.push([agora, +pct.toFixed(2), bruto == null ? null : +bruto.toFixed(3), +pl2.toFixed(3), +av.sig.toFixed(3), Number.isFinite(mTSE) ? +mTSE.toFixed(1) : null]);
    if (HIST.length > 900) HIST = HIST.filter((_, i) => i % 2 === 0 || i === HIST.length - 1);
    gravarEstado(`hist-${chave}.json`, HIST);
  }
}

// ---------- laço: refaz quando o coletor principal publica ----------
const visto = {nac: 0, cid: 0, uh: 0};
const mt = f => { try { return fs.statSync(path.join(CFG.entrada, f)).mtimeMs; } catch (e) { return 0; } };
let ultimoErro = '', voltas = 0, ultimaConta = 0;
function volta() {
  const tNac = mt('nacional.json'), tCid = mt('cidades.json'), tUh = mt('ufs_hist.json');
  if (tNac === visto.nac && tCid === visto.cid && tUh === visto.uh) return false;
  const nac = lerJSON(path.join(CFG.entrada, 'nacional.json'));
  trocarChave(nac);
  if (tCid !== visto.cid || !PROJ) {
    const cid = lerJSON(path.join(CFG.entrada, 'cidades.json'));
    if ((cid.ensaio || null) === (nac.ensaio || null)) {
      calcular(nac, cid); ultimaConta = Date.now();
      gravar(CFG.saida, 'cidades.json', {v: 1, gerado: cid.gerado, ensaio: cid.ensaio || null,
        c: (cid.c || []).map(r => [r[0], r[1], r[2], r[3], r[4], r[5], PU && PU.has(+r[0]) ? PU.get(+r[0]) : -1])});
    }
    visto.cid = tCid;
  }
  if (tUh !== visto.uh && tUh) { try { fs.copyFileSync(path.join(CFG.entrada, 'ufs_hist.json'), path.join(CFG.saida, '.ufs_hist.tmp')); fs.renameSync(path.join(CFG.saida, '.ufs_hist.tmp'), path.join(CFG.saida, 'ufs_hist.json')); } catch (e) {} visto.uh = tUh; }
  const saida = Object.assign({}, nac, {proj: PROJ, cravou: CRAVOU, hist: HIST,
    nova: {modelo: 'ordem de chegada do 1º turno', lam: MN.LAM, fator: MN.FATOR, modo: MODO, calculadoEm: ultimaConta}});
  gravar(CFG.saida, 'nacional.json', saida);
  visto.nac = tNac;
  return true;
}
function situacao(ok) {
  try { gravar(CFG.saida, 'situacao.json', {ok, erro: ultimoErro, voltas, modo: MODO, cidades: U.n, comCurva: U.C.comCurva, semRef: U.semRef, pct: PROJ ? PROJ.pct : 0, l2: PROJ ? PROJ.l2 : null, status: PROJ ? PROJ.status : null, em: Date.now()}); } catch (e) {}
}
(async () => {
  for (;;) {
    let ok = true;
    try { if (volta()) voltas++; ultimoErro = ''; }
    catch (e) { ok = false; const m = String(e && e.message || e); if (m !== ultimoErro) log('erro:', m); ultimoErro = m; }
    if (voltas % 10 === 0 || !ok) situacao(ok);
    if (CFG.umaVez) { situacao(ok); break; }
    await new Promise(r => setTimeout(r, CFG.intervalo));
  }
})();
