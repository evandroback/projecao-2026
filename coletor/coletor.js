/*
 * Coletor da apuração — roda na VM da Oracle.
 * Lê os arquivos públicos do TSE (Brasil, estados e municípios), calcula a projeção
 * e publica JSONs pequenos que o site lê.
 *
 * Respeita o TSE:
 *  - pergunta "mudou?" (If-None-Match / If-Modified-Since) antes de baixar de novo;
 *  - nunca pede um município antes de vencer o cache dele (max-age) nem acima de TAXA pedidos/s;
 *  - cidade encerrada só é conferida a cada 10 min; antes das 17h, quase nada é pedido;
 *  - se o TSE recusar (403/429), pausa e reduz o ritmo pela metade.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Modelo = require('./modelo.js');

const CFG = {
  base: process.env.TSE_BASE || 'https://resultados.tse.jus.br',
  ano: process.env.ANO || '2026',
  ele: process.env.ELEICAO || '6258',
  refs: process.env.REFS || '/opt/projecao/base/refs2026.json',
  saida: process.env.SAIDA || '/opt/projecao/saida',
  estado: process.env.ESTADO || '/opt/projecao/estado',
  ensaio: process.env.ENSAIO || '',
  conc: +(process.env.CONCORRENCIA || 12),
  taxa: +(process.env.TAXA || 40),             // pedidos de município por segundo, no máximo
  acelerar: Math.max(1, +(process.env.ACELERAR || 1)),   // no ensaio acelerado, encurta os intervalos na mesma proporção
  intNac: +(process.env.INT_NAC || 8000),
  intUF: +(process.env.INT_UF || 20000),
  candA: '13',
  candB: '22',
  ua: 'Mozilla/5.0 (compatible; projecao-apuracao/1.0)'
};
const E6 = 'e' + CFG.ele.padStart(6, '0');
const URL_BASE = `${CFG.base}/oficial/ele${CFG.ano}/${CFG.ele}`;
const urlNac = () => `${URL_BASE}/dados/br/br-c0001-${E6}-u.json`;
const urlUF = uf => `${URL_BASE}/dados/${uf}/${uf}-c0001-${E6}-u.json`;
const urlMun = (uf, cd) => `${URL_BASE}/dados/${uf}/${uf}${cd}-c0001-${E6}-u.json`;
const urlCfg = () => `${URL_BASE}/config/mun-${E6}-cm.json`;

fs.mkdirSync(CFG.saida, {recursive: true});
fs.mkdirSync(CFG.estado, {recursive: true});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dormir = ms => new Promise(r => setTimeout(r, ms));
// "HH:MM:SS" (horário de Brasília) -> minutos depois das 17h; de madrugada continua contando (01h = 480)
// relógio de Brasília (UTC−3) como "HH:MM:SS"
function horaBR(ms) { const d = new Date(ms - 3 * 3600000); return d.toISOString().slice(11, 19); }
function minDeHora(hg) {
  if (!hg || hg.length < 5) return NaN;
  let m = (+hg.slice(0, 2)) * 60 + (+hg.slice(3, 5)) + (hg.length >= 8 ? +hg.slice(6, 8) / 60 : 0) - 17 * 60;
  if (m < -660) m += 1440;
  return m;
}

// ---------- leitura dos arquivos do TSE ----------
function ler(j) {
  const s = j.s || {}, e = j.e || {}, v = j.v || {};
  const r = {ts: +s.ts || 0, st: +s.st || 0, te: +e.te || 0, est: +e.est || 0, c: +e.c || 0, a: +e.a || 0,
    vv: +v.vv || 0, vb: +v.vb || 0, tvn: +v.tvn || 0, A: 0, B: 0, dg: j.dg || '', hg: j.hg || ''};
  for (const carg of j.carg || []) for (const ag of carg.agr || []) for (const par of ag.par || []) for (const cand of par.cand || []) {
    if (String(cand.n) === CFG.candA) r.A = +cand.vap || 0;
    else if (String(cand.n) === CFG.candB) r.B = +cand.vap || 0;
  }
  return r;
}

const cache = new Map();
const saude = {ok: 0, erros: 0, seguidos: 0, ultimoOk: 0, ultimoErro: '', recusas: 0, ultimaRecusa: 0, pedidos: 0};
async function pegar(url, bruto) {
  const c = cache.get(url);
  const h = {'User-Agent': CFG.ua, 'Accept': 'application/json'};
  if (c && c.etag) h['If-None-Match'] = c.etag;
  if (c && c.lm) h['If-Modified-Since'] = c.lm;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 15000);
  saude.pedidos++;
  try {
    const r = await fetch(url, {headers: h, signal: ctl.signal});
    const ma = /max-age=(\d+)/.exec(r.headers.get('cache-control') || '');
    const maxAge = ma ? +ma[1] : 0;
    if (r.status === 304 && c) { saude.ok++; saude.seguidos = 0; saude.ultimoOk = Date.now(); return {mudou: false, dados: c.dados, maxAge}; }
    if (!r.ok) {
      saude.erros++; saude.seguidos++; saude.ultimoErro = 'HTTP ' + r.status;
      if (r.status === 403 || r.status === 429) { saude.recusas++; saude.ultimaRecusa = Date.now(); }
      return {erro: r.status, maxAge};
    }
    const j = await r.json();
    const dados = bruto ? j : ler(j);
    cache.set(url, {etag: r.headers.get('etag'), lm: r.headers.get('last-modified'), dados});
    saude.ok++; saude.seguidos = 0; saude.ultimoOk = Date.now();
    return {mudou: true, dados, maxAge};
  } catch (e) {
    saude.erros++; saude.seguidos++; saude.ultimoErro = String(e && e.name || e);
    return {erro: saude.ultimoErro};
  } finally { clearTimeout(tm); }
}

async function emParalelo(itens, n, fn) {
  let i = 0;
  const trab = Array.from({length: Math.min(n, itens.length)}, async () => { while (i < itens.length) { const k = i++; await fn(itens[k], k); } });
  await Promise.all(trab);
}

function gravarJSON(nome, obj) {
  const destino = path.join(CFG.saida, nome), tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, destino);
}
function lerEstado(nome, padrao) {
  try { return JSON.parse(fs.readFileSync(path.join(CFG.estado, nome), 'utf8')); } catch (e) { return padrao; }
}
function gravarEstado(nome, obj) {
  const destino = path.join(CFG.estado, nome), tmp = destino + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, destino);
}

// ---------- estado ----------
let LISTA = [];          // [{cod, cd, uf, ufl}]
let U = null;            // unidades do modelo
let MUN = [];            // dados mais recentes de cada município
let NAC = null, NAC_TSE = null;
const UF = {};
let PROJ = null;
const chave = (CFG.ensaio ? 'ensaio-' : 'ao-vivo-') + CFG.ele;
let HIST = lerEstado(`hist-${chave}.json`, []);
let HIST_UF = lerEstado(`histuf-${chave}.json`, {});
let CRAVOU = lerEstado(`cravou-${chave}.json`, null);
// antes da apuração começar (Brasil com 0 seções), o coletor quase não pede nada
const antesDaApuracao = () => !CFG.ensaio && (!NAC || NAC.st === 0);

async function carregarLista() {
  for (let tent = 1; ; tent++) {
    const r = await pegar(urlCfg(), true);
    if (r.dados && r.dados.abr) {
      const lista = [];
      for (const a of r.dados.abr) for (const m of a.mu || []) lista.push({cod: parseInt(m.cd, 10), cd: m.cd, uf: a.cd.toUpperCase(), ufl: a.cd.toLowerCase()});
      gravarEstado('municipios-cache.json', lista);
      return lista;
    }
    const cacheLista = lerEstado('municipios-cache.json', null);
    if (cacheLista && tent >= 3) { log('usando lista de municípios em cache'); return cacheLista; }
    log('aguardando lista de municípios do TSE…', r.erro);
    await dormir(10000);
  }
}

function montarModelo() {
  const refs = JSON.parse(fs.readFileSync(CFG.refs, 'utf8'));
  U = Modelo.unidades(LISTA.map(m => ({cod: m.cod, uf: m.uf, A: 0})), refs);
  MUN = LISTA.map(() => null);
  log(`modelo: ${U.n} municípios, ${U.semRef} sem referência (usam a média do estado)`);
}

// ---------- projeção ----------
function calcular() {
  const n = U.n;
  const st = {a: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), v: new Float64Array(n)};
  let secSom = 0, secTot = 0, comDados = 0;
  for (let u = 0; u < n; u++) {
    const m = MUN[u];
    if (!m) continue;
    if (m.te > 0) U.A[u] = m.te;
    st.a[u] = m.est; st.x[u] = m.A; st.y[u] = m.B; st.v[u] = m.vv;
    secSom += m.st; secTot += m.ts;
    if (m.st > 0) comDados++;
  }
  const pct = secTot > 0 ? 100 * secSom / secTot : 0;
  if (secSom === 0) { PROJ = {pct: 0, pronto: false, status: 'aguardando', comDados}; return; }
  const r = Modelo.projetar(U, st);
  const pl2 = 100 * r.pt / (r.pt + r.adv);
  const av = Modelo.avaliar(pl2, pct);
  const porUF = {}, somaReg = {}, porReg = {};
  for (const [uf, g] of Object.entries(r.porUF)) {
    porUF[uf] = +(100 * g.pt / (g.pt + g.adv)).toFixed(2);
    const k = Modelo.REG[uf] || 'EX', a = somaReg[k] || (somaReg[k] = {pt: 0, adv: 0});
    a.pt += g.pt; a.adv += g.adv;
  }
  for (const [k, a] of Object.entries(somaReg)) porReg[k] = +(100 * a.pt / (a.pt + a.adv)).toFixed(2);
  const pu = new Array(n);
  let somaX = 0, somaY = 0;
  for (let u = 0; u < n; u++) { pu[u] = Number.isFinite(r.pu[u]) ? Math.round(10000 * r.pu[u]) : -1; somaX += st.x[u]; somaY += st.y[u]; }
  const falta = Math.max(0, r.pt + r.adv - somaX - somaY);       // votos dos dois que a projeção espera nas seções que faltam
  const agora = Date.now();
  // horário da noite: no ensaio, o simulado (do arquivo do TSE falso); ao vivo, o relógio de Brasília
  const hNoite = CFG.ensaio && NAC_TSE && NAC_TSE.hg ? NAC_TSE.hg : horaBR(agora);
  // "Cravou": a 1ª vez que a chance do líder passa de 99%. Depois disso o site mantém "vence"
  // enquanto o mesmo líder tiver pelo menos 95% (evita piscar entre "vence" e "vantagem").
  if (CRAVOU && !CRAVOU.desfeito && av.pronto && (av.lider !== CRAVOU.lider || av.ch < 0.95)) {
    CRAVOU.desfeito = {t: agora, hg: hNoite, pct: +pct.toFixed(2)};
    gravarEstado(`cravou-${chave}.json`, CRAVOU);
    log('*** a projeção deixou de cravar:', av.lider, pl2.toFixed(2), 'chance', av.ch.toFixed(3));
  }
  if ((!CRAVOU || CRAVOU.desfeito) && av.pronto && av.ch >= 0.99) {
    CRAVOU = {t: agora, hg: hNoite, pct: +pct.toFixed(2), lider: av.lider, l2: +pl2.toFixed(2), antes: CRAVOU || null};
    gravarEstado(`cravou-${chave}.json`, CRAVOU);
    log('*** projeção cravou:', av.lider, pl2.toFixed(2), 'com', pct.toFixed(2), '%');
  }
  const status = CRAVOU && !CRAVOU.desfeito && av.pronto ? 'vence' : av.status;
  PROJ = {pct: +pct.toFixed(3), l2: +pl2.toFixed(3), sig: +av.sig.toFixed(3), m2: +av.m2.toFixed(3), chAdv: +av.chAdv.toFixed(5), lider: av.lider,
    status, pronto: av.pronto, uf: porUF, reg: porReg, comDados, falta: Math.round(falta), faltaL: falta > 0 ? +((r.pt - somaX) / falta).toFixed(4) : null, pu};
  // histórico (com o horário do TSE, que no ensaio é o horário simulado)
  const mTSE = minDeHora(hNoite);
  const bruto = NAC && NAC.A + NAC.B > 0 ? 100 * NAC.A / (NAC.A + NAC.B) : null;
  const ult = HIST[HIST.length - 1];
  if (av.pronto && (!ult || pct - ult[1] >= 0.2 || agora - ult[0] > 90000 || (pct >= 100 && ult[1] < 100))) {
    HIST.push([agora, +pct.toFixed(2), bruto == null ? null : +bruto.toFixed(3), +pl2.toFixed(3), +av.sig.toFixed(3), Number.isFinite(mTSE) ? +mTSE.toFixed(1) : null]);
    if (HIST.length > 900) HIST = HIST.filter((_, i) => i % 2 === 0 || i === HIST.length - 1);
    gravarEstado(`hist-${chave}.json`, HIST);
  }
}

function registrarHistUF() {
  let mudou = false;
  for (const [uf, d] of Object.entries(UF)) {
    if (!d || d.ts === 0 || d.A + d.B === 0) continue;
    const pm = Math.round(1000 * d.st / d.ts);
    if (pm < 5) continue;                                  // abaixo de 0,5% das seções o número é só ruído
    const l2 = Math.round(10000 * d.A / (d.A + d.B));
    const h = HIST_UF[uf] || (HIST_UF[uf] = []);
    const u = h[h.length - 1];
    if (!u || pm - u[0] >= 10 || (pm === 1000 && u[0] !== 1000)) { h.push([pm, l2]); mudou = true; }
  }
  if (mudou) { gravarEstado(`histuf-${chave}.json`, HIST_UF); gravarJSON('ufs_hist.json', {gerado: Date.now(), uf: HIST_UF}); }
}

// ---------- publicação ----------
let ultimaPub = 0;
function publicar(forcar) {
  const agora = Date.now();
  if (!forcar && agora - ultimaPub < 1500) return;
  ultimaPub = agora;
  let status = 'ok';
  if (saude.recusas > 20 && agora - saude.ultimaRecusa < 120000 && agora - saude.ultimoOk > 60000) status = 'sem_acesso';
  else if (agora - saude.ultimoOk > 90000) status = 'atrasado';
  const enx = d => d && {ts: d.ts, st: d.st, te: d.te, est: d.est, c: d.c, a: d.a, vv: d.vv, vb: d.vb, tvn: d.tvn, A: d.A, B: d.B};
  const ufs = {};
  for (const [uf, d] of Object.entries(UF)) ufs[uf] = enx(d);
  const proj = PROJ ? Object.assign({}, PROJ) : null;
  if (proj) delete proj.pu;
  gravarJSON('nacional.json', {
    v: 1, gerado: agora, ensaio: CFG.ensaio || null, status, tse: NAC_TSE,
    saude: {ok: saude.ok, erros: saude.erros, ultimoErro: saude.ultimoErro, ultimoOk: saude.ultimoOk, ritmo: +taxa.toFixed(1), munAtualizado: ultimoMunOk},
    br: enx(NAC), uf: ufs, proj, cravou: CRAVOU, hist: HIST
  });
}
function publicarCidades() {
  const c = [];
  for (let u = 0; u < U.n; u++) {
    const m = MUN[u];
    if (!m || m.ts === 0) continue;
    c.push([U.cod[u], m.st, m.ts, m.A, m.B, m.vv, PROJ && PROJ.pu ? PROJ.pu[u] : -1]);
  }
  gravarJSON('cidades.json', {v: 1, gerado: Date.now(), ensaio: CFG.ensaio || null, c});
}

// ---------- laços ----------
async function laçoNacional() {
  for (;;) {
    const t0 = Date.now();
    const antes = NAC ? NAC.st : 0;
    const r = await pegar(urlNac());
    if (r.dados) {
      NAC = r.dados; NAC_TSE = {dg: r.dados.dg, hg: r.dados.hg};
      if (antes === 0 && NAC.st > 0 && PROX) { log('*** apuração começou: pedindo todos os municípios'); PROX.fill(0); }
    }
    publicar();
    await dormir(Math.max(1000, CFG.intNac * (saude.seguidos > 3 ? 3 : 1) - (Date.now() - t0)));
  }
}
async function laçoUF() {
  const ufs = [...new Set(LISTA.map(m => m.ufl))];
  for (;;) {
    const t0 = Date.now();
    await emParalelo(ufs, 4, async uf => { const r = await pegar(urlUF(uf)); if (r.dados) UF[uf.toUpperCase()] = r.dados; });
    registrarHistUF();
    publicar();
    const intervalo = antesDaApuracao() ? 5 * 60000 : CFG.intUF;
    // dorme em pedaços para acordar logo quando a apuração começar
    for (let fim = t0 + intervalo; Date.now() < fim;) { await dormir(Math.min(5000, fim - Date.now())); if (!antesDaApuracao() && intervalo > CFG.intUF) break; }
  }
}

// Municípios: fila com prioridade. Cada município tem uma hora "pode pedir de novo" (PROX).
let PROX = null, EMUSO = null;
let taxa = CFG.taxa, fichas = 0, ultimaFicha = Date.now(), pausaAte = 0;
let mudaram = 0, ultimoMunOk = 0;
async function pegarFicha() {          // limite de ritmo (balde de fichas)
  for (;;) {
    const agora = Date.now();
    if (agora < pausaAte) { await dormir(pausaAte - agora); continue; }
    const t = antesDaApuracao() ? Math.min(taxa, 8) : taxa;   // antes das 17h, bem devagar
    fichas = Math.min(Math.max(1, t / 4), fichas + (agora - ultimaFicha) / 1000 * t);
    ultimaFicha = agora;
    if (fichas >= 1) { fichas -= 1; return; }
    await dormir(Math.max(5, Math.ceil((1 - fichas) / t * 1000)));
  }
}
function intervaloMun(u, m, maxAge) {
  if (antesDaApuracao()) return 30 * 60000;
  if (m.ts > 0 && m.st >= m.ts) return 10 * 60000 / CFG.acelerar;   // encerrado: só confere de vez em quando
  const porTamanho = (U.A[u] >= 100000 ? 15000 : U.A[u] >= 20000 ? 25000 : 40000) / CFG.acelerar;
  return Math.max(porTamanho, (maxAge || 0) * 1000);
}
function escolher() {                   // o mais atrasado primeiro; empate, o maior
  const agora = Date.now();
  let best = -1, bp = Infinity;
  for (let u = 0; u < PROX.length; u++) {
    if (EMUSO[u]) continue;
    const p = PROX[u];
    if (p <= agora && (p < bp || (p === bp && U.A[u] > U.A[best]))) { best = u; bp = p; }
  }
  return best;
}
async function trabalhador() {
  for (;;) {
    const u = escolher();
    if (u < 0) { await dormir(300); continue; }
    EMUSO[u] = 1;
    await pegarFicha();
    const m = LISTA[u];
    const r = await pegar(urlMun(m.ufl, m.cd));
    EMUSO[u] = 0;
    const recusa = r.erro === 403 || r.erro === 429;
    registrarResposta(!recusa);
    if (r.dados) {
      if (r.mudou) mudaram++;
      MUN[u] = r.dados; ultimoMunOk = Date.now();
      PROX[u] = Date.now() + intervaloMun(u, r.dados, r.maxAge);
    } else {
      PROX[u] = Date.now() + 30000;
      if (recusa) reagirRecusa(r.erro);
    }
  }
}
// Recusas do TSE: olha os últimos 30 s. Muitas (>50%) = parece bloqueio: pausa 20 s e corta o ritmo pela metade.
// Algumas (5–50%) = reduz 20% a cada 10 s, sem parar e sem cair abaixo de 10/s. Poucas (<5%) = volta a acelerar.
const janela = [];
let ultimaPausa = 0, ultimaReducao = 0, ultimoAviso = 0;
function registrarResposta(ok) {
  const t = Date.now();
  janela.push(t * 2 + (ok ? 1 : 0));                 // tempo e resultado num número só
  while (janela.length && janela[0] / 2 < t - 30000) janela.shift();
}
function fracaoRecusas() {
  if (janela.length < 10) return 0;
  let rec = 0;
  for (const x of janela) if (x % 2 === 0) rec++;
  return rec / janela.length;
}
function reagirRecusa(cod) {
  const agora = Date.now(), f = fracaoRecusas();
  if (f > 0.5 && agora > pausaAte && agora - ultimaPausa > 60000) {
    taxa = Math.max(3, taxa / 2); pausaAte = agora + 20000; ultimaPausa = agora;
    log(`TSE recusando ${(100 * f).toFixed(0)}% dos pedidos (${cod}): pausa de 20 s, ritmo ${taxa.toFixed(1)}/s`);
  } else if (f > 0.05 && agora - ultimaReducao > 10000) {
    taxa = Math.max(Math.min(10, taxa), taxa * 0.8); ultimaReducao = agora;
    if (agora - ultimoAviso > 30000) { ultimoAviso = agora; log(`TSE recusou ${(100 * f).toFixed(0)}% dos pedidos (${cod}): ritmo ${taxa.toFixed(1)}/s`); }
  }
}
async function laçoMunicipios() {
  PROX = new Float64Array(LISTA.length);    // tudo zero = pode pedir já
  EMUSO = new Uint8Array(LISTA.length);
  for (let i = 0; i < CFG.conc; i++) trabalhador();
  let ultCalc = 0, ultCid = 0, ultLog = 0, pedidosAntes = 0;
  for (;;) {
    await dormir(2500);
    const agora = Date.now();
    if (mudaram > 0 || agora - ultCalc > 30000) {
      mudaram = 0; ultCalc = agora;
      calcular();
      publicar(true);
    }
    if (agora - ultCid > 15000) { ultCid = agora; publicarCidades(); }
    // recupera o ritmo aos poucos depois de uma recusa
    if (taxa < CFG.taxa && fracaoRecusas() < 0.05 && agora - saude.ultimaRecusa > 15000) taxa = Math.min(CFG.taxa, taxa * 1.1);
    if (agora - ultLog > 60000) {
      const fila = PROX.reduce((s, p) => s + (p <= agora ? 1 : 0), 0);
      log(`pedidos/min ${saude.pedidos - pedidosAntes} · ritmo ${taxa.toFixed(1)}/s · na fila ${fila} · erros ${saude.erros} (${saude.ultimoErro || '—'}) · apurado ${PROJ ? PROJ.pct : 0}% · projeção Lula ${PROJ && PROJ.l2 != null ? PROJ.l2 : '—'} (${PROJ ? PROJ.status : '—'})`);
      pedidosAntes = saude.pedidos; ultLog = agora;
    }
  }
}

(async () => {
  log('coletor iniciando', CFG.ensaio ? `(ENSAIO: ${CFG.ensaio})` : '(ao vivo)', URL_BASE, `· até ${CFG.taxa} pedidos/s, ${CFG.conc} em paralelo`);
  LISTA = await carregarLista();
  log(`${LISTA.length} municípios na lista do TSE`);
  montarModelo();
  publicar(true);
  gravarJSON('ufs_hist.json', {gerado: Date.now(), uf: HIST_UF});
  laçoNacional();
  laçoUF();
  laçoMunicipios();
})().catch(e => { console.error(e); process.exit(1); });
