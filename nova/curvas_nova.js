/*
 * Monta, para o modelo novo, as urnas do 1º turno de cada cidade na ordem em que chegaram ao TSE.
 *   node curvas_nova.js 2026        usa base/secoes_2026_1.json (já conferido no preparo da base)
 *   node curvas_nova.js 2022        lê os zips do TSE em brutos/ (1º turno de 2022; para o ensaio do /nova)
 * Grava base/curvas_nova<ano>.json  {cod: [eleitorado, Lula, adversário, válidos, ...urna seguinte...]}
 * e confere os totais de cada cidade contra base/refs2026.json ou base/refs2022_t1.json.
 */
'use strict';
const {spawn, execSync} = require('child_process');
const readline = require('readline');
const fs = require('fs');
const BRUTOS = process.env.BRUTOS || '/opt/projecao/brutos';
const BASE = process.env.BASE || '/opt/projecao/base';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---- leitura dos zips (mesmo jeito do coletor/preparar.js) ----
function membros(zip) {
  const nomes = execSync(`unzip -Z1 "${zip}"`, {maxBuffer: 64 << 20}).toString().split('\n').map(n => n.trim()).filter(Boolean);
  const br = nomes.find(n => /_BR\.csv$/i.test(n));
  if (br) return [br];
  const ufs = nomes.filter(n => /_[A-Z]{2}\.csv$/i.test(n));
  if (!ufs.length) throw new Error('nenhum CSV em ' + zip);
  return ufs;
}
function separar(linha) {
  const c = linha.split(';');
  for (let i = 0; i < c.length; i++) {
    const s = c[i];
    if (!s.length || s.charCodeAt(0) !== 34) continue;
    if (s.length >= 2 && s.charCodeAt(s.length - 1) === 34) { c[i] = s.slice(1, -1); continue; }
    let j = i, t = s;
    while (j + 1 < c.length && !(t.length >= 2 && t.charCodeAt(t.length - 1) === 34)) t += ';' + c[++j];
    c.splice(i, j - i + 1, t.length >= 2 ? t.slice(1, -1) : t);
  }
  return c;
}
async function linhas(zip, precisa, cb) {
  let n = 0;
  for (const membro of membros(zip)) {
    const p = spawn('unzip', ['-p', zip, membro]);
    p.stdout.setEncoding('latin1');
    const rl = readline.createInterface({input: p.stdout, crlfDelay: Infinity});
    let h = null;
    for await (const linha of rl) {
      if (!linha) continue;
      const c = separar(linha);
      if (!h) { h = {}; c.forEach((k, i) => h[k.trim()] = i); const f = precisa.filter(k => !(k in h)); if (f.length) { p.kill(); throw new Error(`${membro}: faltam ${f.join(', ')}`); } continue; }
      cb(c, h); n++;
    }
  }
  return n;
}
const minutos = (s, dia) => (!s || s.length < 19 || s[0] === '#') ? NaN : (+s.slice(0, 2) - dia) * 1440 + (+s.slice(11, 13) - 17) * 60 + (+s.slice(14, 16)) + (+s.slice(17, 19)) / 60;

// 1º turno de um ano, por seção, direto dos zips: {mun, uf, tt, aptos, pt, adv, val}
async function lerZips(ano, dia, adv) {
  const key = new Map(), S = {mun: [], uf: [], tt: [], aptos: [], pt: [], adv: [], val: []};
  const k = (c, h) => c[h.SG_UF] + '|' + parseInt(c[h.CD_MUNICIPIO], 10) + '|' + parseInt(c[h.NR_ZONA], 10) + '|' + parseInt(c[h.NR_SECAO], 10);
  await linhas(`${BRUTOS}/detalhe_votacao_secao_${ano}.zip`, ['CD_CARGO', 'NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'QT_APTOS', 'DT_PRIM_TOT_PARCIAL_HOR_TSE'], (c, h) => {
    if (c[h.CD_CARGO] !== '1' || c[h.NR_TURNO] !== '1') return;
    const kk = k(c, h);
    let i = key.get(kk);
    if (i === undefined) { i = S.mun.length; key.set(kk, i); S.mun.push(parseInt(c[h.CD_MUNICIPIO], 10)); S.uf.push(c[h.SG_UF]); S.tt.push(NaN); S.aptos.push(0); S.pt.push(0); S.adv.push(0); S.val.push(0); }
    S.aptos[i] += +c[h.QT_APTOS] || 0;
    const t = minutos(c[h.DT_PRIM_TOT_PARCIAL_HOR_TSE], dia);
    if (!(S.tt[i] <= t)) S.tt[i] = t;
  });
  let semChave = 0;
  await linhas(`${BRUTOS}/votacao_secao_${ano}_BR.zip`, ['CD_CARGO', 'NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'NR_VOTAVEL', 'QT_VOTOS'], (c, h) => {
    if (c[h.CD_CARGO] !== '1' || c[h.NR_TURNO] !== '1') return;
    const i = key.get(k(c, h));
    if (i === undefined) { semChave++; return; }
    const nr = +c[h.NR_VOTAVEL], v = +c[h.QT_VOTOS] || 0;
    if (nr === 13) S.pt[i] += v; else if (nr === adv) S.adv[i] += v;
    if (nr > 0 && nr < 95) S.val[i] += v;
  });
  log(`${ano}: ${S.mun.length} seções do 1º turno; ${semChave} linhas de voto sem seção`);
  const o = S.mun.map((_, i) => i).sort((a, b) => { const ta = S.tt[a], tb = S.tt[b]; if (isNaN(ta)) return isNaN(tb) ? 0 : 1; if (isNaN(tb)) return -1; return ta - tb; });
  const pick = arr => o.map(i => arr[i]);
  return {mun: pick(S.mun), uf: pick(S.uf), tt: pick(S.tt), aptos: pick(S.aptos), pt: pick(S.pt), adv: pick(S.adv), val: pick(S.val)};
}

function montar(S, refs) {
  const C = {};
  let secoes = 0, semHora = 0;
  for (let i = 0; i < S.mun.length; i++) {
    if (!(S.aptos[i] > 0)) continue;
    const cod = S.mun[i];
    (C[cod] || (C[cod] = [])).push(S.aptos[i], S.pt[i], S.adv[i], S.val[i]);
    secoes++; if (!Number.isFinite(S.tt[i]) || S.tt[i] >= 9999) semHora++;
  }
  // conferência contra as referências do 1º turno
  let cidades = 0, iguais = 0, difVotos = 0, difEleitorado = 0;
  const tot = {pt: 0, adv: 0, val: 0, aptos: 0}, totRef = {pt: 0, adv: 0, val: 0, aptos: 0};
  for (const [cod, c] of Object.entries(C)) {
    cidades++;
    const s = {aptos: 0, pt: 0, adv: 0, val: 0};
    for (let j = 0; j < c.length; j += 4) { s.aptos += c[j]; s.pt += c[j + 1]; s.adv += c[j + 2]; s.val += c[j + 3]; }
    for (const k in tot) tot[k] += s[k];
    const r = refs[cod];
    if (!r) continue;
    const dv = Math.abs(s.pt - r.pt) + Math.abs(s.adv - r.adv) + Math.abs(s.val - r.val);
    difVotos += dv; difEleitorado += Math.abs(s.aptos - r.aptos);
    if (dv === 0) iguais++;
  }
  for (const r of Object.values(refs)) for (const k in totRef) totRef[k] += r[k] || 0;
  return {C, resumo: {cidades, secoes, semHora, cidadesComVotosIguaisAsReferencias: iguais, difVotos, difEleitorado, totais: tot, totaisReferencias: totRef}};
}

(async () => {
  const resumos = {};
  for (const ano of process.argv.slice(2)) {
    let S, refs;
    if (ano === '2026') {
      const s = JSON.parse(fs.readFileSync(`${BASE}/secoes_2026_1.json`, 'utf8'));
      S = {mun: s.mun, uf: s.uf, tt: s.tt, aptos: s.aptos, pt: s.pt, adv: s.adv, val: s.pt.map((x, i) => x + s.adv[i] + s.out[i])};
      refs = JSON.parse(fs.readFileSync(`${BASE}/refs2026.json`, 'utf8'));
    } else if (ano === '2022') {
      S = await lerZips(2022, 2, 22);
      refs = JSON.parse(fs.readFileSync(`${BASE}/refs2022_t1.json`, 'utf8'));
    } else { log('ano não previsto:', ano); continue; }
    const {C, resumo} = montar(S, refs);
    const destino = `${BASE}/curvas_nova${ano}.json`;
    fs.writeFileSync(destino + '.tmp', JSON.stringify(C));
    fs.renameSync(destino + '.tmp', destino);
    resumo.mb = +(fs.statSync(destino).size / 1e6).toFixed(1);
    resumos[ano] = resumo;
    log(ano, JSON.stringify(resumo));
  }
  if (process.env.RESUMO) fs.writeFileSync(process.env.RESUMO, JSON.stringify({gerado: Date.now(), anos: resumos}));
})().catch(e => { console.error(e); process.exit(1); });
