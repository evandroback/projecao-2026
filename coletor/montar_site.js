/*
 * Monta os dados fixos do site (estatico/base.json) a partir das referências preparadas
 * e da lista oficial de municípios do TSE. Roda na VM depois do preparar.js.
 */
'use strict';
const fs = require('fs');
const BASE = process.env.BASE || '/opt/projecao/base';
const SITE = process.env.SITE || '/opt/projecao/site';
const CFG_URL = process.env.CFG_URL || 'https://resultados.tse.jus.br/oficial/ele2026/6258/config/mun-e006258-cm.json';
const URL_1T = process.env.URL_1T || 'https://resultados.tse.jus.br/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json';
const UA = {'User-Agent': 'Mozilla/5.0 (compatible; projecao-apuracao/1.0)'};
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO','ZZ'];
const NOMES_UF = {AC:'Acre',AL:'Alagoas',AM:'Amazonas',AP:'Amapá',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',GO:'Goiás',MA:'Maranhão',MG:'Minas Gerais',MS:'Mato Grosso do Sul',MT:'Mato Grosso',PA:'Pará',PB:'Paraíba',PE:'Pernambuco',PI:'Piauí',PR:'Paraná',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RO:'Rondônia',RR:'Roraima',RS:'Rio Grande do Sul',SC:'Santa Catarina',SE:'Sergipe',SP:'São Paulo',TO:'Tocantins',ZZ:'Exterior'};
const PEQ = new Set(['de', 'da', 'do', 'das', 'dos', 'e', "d'", 'del']);
const titulo = s => s.toLowerCase().split(' ').map((w, i) => (i > 0 && PEQ.has(w)) ? w : w.replace(/^(d')?(\p{L})/u, (m, a, b) => (a || '') + b.toUpperCase())).join(' ');

(async () => {
  const cfg = await (await fetch(CFG_URL, {headers: UA})).json();
  fs.writeFileSync(`${BASE}/config_6258.json`, JSON.stringify(cfg));
  const r26 = JSON.parse(fs.readFileSync(`${BASE}/refs2026.json`, 'utf8'));
  const r22 = JSON.parse(fs.readFileSync(`${BASE}/refs2022.json`, 'utf8'));
  const curvas = JSON.parse(fs.readFileSync(`${BASE}/curvas2026.json`, 'utf8'));
  const bp = (a, b) => a + b > 0 ? Math.round(10000 * a / (a + b)) : -1;

  const mun = [];
  let semRef = 0;
  for (const a of cfg.abr) {
    const uf = a.cd.toUpperCase(), j = UFS.indexOf(uf);
    for (const m of a.mu) {
      const cod = parseInt(m.cd, 10), x = r26[cod], y = r22[cod];
      if (!x) semRef++;
      mun.push([cod, j, titulo(m.nm || String(cod)), m.c === 's' ? 1 : 0,
        x ? bp(x.pt, x.adv) : -1, x ? x.val : 0,
        y && y.t2 ? bp(y.t2.pt, y.t2.adv) : -1]);
    }
  }
  // totais do 1º turno de 2026 (Brasil e estados) e do 2º turno de 2022
  const soma = () => ({pt: 0, adv: 0, out: 0, val: 0, aptos: 0, comp: 0, bra: 0, nul: 0, anu: 0, sec: 0});
  const t26 = {br: soma(), uf: {}};
  for (const r of Object.values(r26)) {
    for (const g of [t26.br, t26.uf[r.uf] || (t26.uf[r.uf] = soma())]) for (const k of Object.keys(g)) g[k] += r[k] || 0;
  }
  const t22 = {br: {pt: 0, adv: 0}, uf: {}};
  for (const r of Object.values(r22)) {
    if (!r.t2) continue;
    t22.br.pt += r.t2.pt; t22.br.adv += r.t2.adv;
    const g = t22.uf[r.uf] || (t22.uf[r.uf] = {pt: 0, adv: 0});
    g.pt += r.t2.pt; g.adv += r.t2.adv;
  }
  // Conferência: o 1º turno somado dos dados abertos bate com o arquivo final do TSE?
  // Também decide se "nulos" do TSE inclui os anulados (código 97+), para comparar igual com igual.
  let nulDef = 'nul';
  try {
    const j = await (await fetch(URL_1T, {headers: UA})).json();
    const e = j.e || {}, v = j.v || {};
    let A = 0, Bv = 0;
    for (const carg of j.carg || []) for (const ag of carg.agr || []) for (const par of ag.par || []) for (const c of par.cand || []) { if (String(c.n) === '13') A = +c.vap; if (String(c.n) === '22') Bv = +c.vap; }
    const t = t26.br;
    const linhas = [['seções', +(j.s || {}).ts, t.sec], ['eleitorado', +e.te, t.aptos], ['comparecimento', +e.c, t.comp], ['válidos', +v.vv, t.val],
      ['Lula', A, t.pt], ['Flávio', Bv, t.adv], ['brancos', +v.vb, t.bra], ['nulos (só 96)', +v.tvn, t.nul], ['nulos + anulados', +v.tvn, t.nul + t.anu]];
    console.log('conferência do 1º turno (arquivo final do TSE × dados abertos):');
    for (const [k, a, b] of linhas) console.log(`  ${k.padEnd(18)} TSE ${String(a).padStart(12)}  dados abertos ${String(b).padStart(12)}  diferença ${(a ? 100 * (b - a) / a : 0).toFixed(3)}%`);
    nulDef = Math.abs(+v.tvn - t.nul - t.anu) < Math.abs(+v.tvn - t.nul) ? 'nul+anu' : 'nul';
    console.log('  nulos comparados como:', nulDef);
  } catch (e) { console.log('conferência do 1º turno indisponível:', e.message); }
  const out = {gerado: Date.now(), UFS, NOMES_UF, nulDef, mun, ref26: t26, ref22: t22, curvas};
  fs.mkdirSync(`${SITE}/estatico`, {recursive: true});
  fs.writeFileSync(`${SITE}/estatico/base.json`, JSON.stringify(out));
  console.log(`base.json: ${mun.length} municípios (${semRef} sem referência do 1º turno), ${(fs.statSync(`${SITE}/estatico/base.json`).size / 1e3).toFixed(0)} KB`);
  console.log('1º turno 2026, Lula só os dois:', (100 * t26.br.pt / (t26.br.pt + t26.br.adv)).toFixed(2), '· 2º turno 2022, Lula:', (100 * t22.br.pt / (t22.br.pt + t22.br.adv)).toFixed(2));
})().catch(e => { console.error(e); process.exit(1); });
