/*
 * Gera os mapas por município de cada estado (estatico/mapas/UF.json), já projetados em SVG.
 * Fonte: malhas do IBGE reorganizadas em github.com/tbrugz/geodata-br. Roda na VM.
 * Precisa de: npm install mapshaper d3-geo (na pasta FERR).
 */
'use strict';
const fs = require('fs');
const {execFileSync} = require('child_process');
const FERR = process.env.FERR || '/opt/projecao/ferramentas';
const d3 = require(`${FERR}/node_modules/d3-geo`);
const BASE = process.env.BASE || '/opt/projecao/base';
const SITE = process.env.SITE || '/opt/projecao/site';
const TMP = '/tmp/mapas';
fs.mkdirSync(TMP, {recursive: true});
fs.mkdirSync(`${SITE}/estatico/mapas`, {recursive: true});
const IBGE_UF = {RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29, MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53};

const cfg = JSON.parse(fs.readFileSync(`${BASE}/config_6258.json`, 'utf8'));
const ibge2tse = {};
for (const a of cfg.abr) for (const m of a.mu) if (m.cdi) ibge2tse[m.cdi] = parseInt(m.cd, 10);

// Algumas malhas antigas guardam ilhas como "buracos" de um polígono. Refaz os polígonos:
// o maior anel vira contorno; um anel dentro de um contorno vira buraco; fora de todos, vira outra parte.
function areaPlana(r) { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a / 2); }
function dentro(pt, r) {
  let d = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) d = !d;
  }
  return d;
}
function consertarAneis(fc) {
  let mudou = 0;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const aneis = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat().filter(r => r && r.length >= 4);
    if (aneis.length < 2) continue;
    aneis.sort((a, b) => areaPlana(b) - areaPlana(a));
    const partes = [];
    for (const r of aneis) {
      const pai = partes.find(p => dentro(r[0], p[0]) && !p.slice(1).some(h => dentro(r[0], h)));
      if (pai) pai.push(r); else partes.push([r]);
    }
    const novo = partes.length === 1 ? {type: 'Polygon', coordinates: partes[0]} : {type: 'MultiPolygon', coordinates: partes};
    if (JSON.stringify(novo) !== JSON.stringify(g)) { f.geometry = novo; mudou++; }
  }
  return mudou;
}

function corrigirSentido(fc) {
  const rev = rings => rings.map(r => r.slice().reverse());
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') { if (d3.geoArea({type: 'Polygon', coordinates: g.coordinates}) > 2 * Math.PI) g.coordinates = rev(g.coordinates); }
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(p => d3.geoArea({type: 'Polygon', coordinates: p}) > 2 * Math.PI ? rev(p) : p);
  }
}

const fonte = {};
(async () => {
  let total = 0;
  for (const [uf, cod] of Object.entries(IBGE_UF)) {
    const bruto = `${TMP}/${uf}.json`, simpl = `${TMP}/${uf}_s.json`;
    if (!fs.existsSync(bruto)) {
      // 1º: malha atual da API do IBGE; se falhar, a cópia de 2010 no GitHub (sem os municípios criados depois)
      let ok = false;
      try {
        const r = await fetch(`https://servicodados.ibge.gov.br/api/v3/malhas/estados/${cod}?formato=application/vnd.geo%2Bjson&qualidade=intermediaria&intrarregiao=municipio`, {signal: AbortSignal.timeout(60000)});
        if (r.ok) { const t = Buffer.from(await r.arrayBuffer()); if (t.length > 1000 && JSON.parse(t).features) { fs.writeFileSync(bruto, t); ok = true; fonte[uf] = 'IBGE'; } }
      } catch (e) {}
      if (!ok) {
        const r = await fetch(`https://raw.githubusercontent.com/tbrugz/geodata-br/master/geojson/geojs-${cod}-mun.json`);
        if (!r.ok) throw new Error(`malha ${uf}: HTTP ${r.status}`);
        fs.writeFileSync(bruto, Buffer.from(await r.arrayBuffer()));
        fonte[uf] = 'GitHub (2010)';
      }
    }
    const pctSimpl = ['MG', 'SP', 'RS', 'BA', 'GO', 'PI', 'PB', 'SC'].includes(uf) ? '6%' : '9%';
    const fcBruto = JSON.parse(fs.readFileSync(bruto, 'utf8'));
    const consertados = consertarAneis(fcBruto);
    const limpo = `${TMP}/${uf}_limpo.json`;
    fs.writeFileSync(limpo, JSON.stringify(fcBruto));
    execFileSync(`${FERR}/node_modules/.bin/mapshaper`, [limpo, '-simplify', pctSimpl, 'keep-shapes', '-o', 'format=geojson', simpl], {stdio: 'pipe'});
    if (consertados) console.log(`${uf}: ${consertados} municípios com ilhas/anéis refeitos`);
    const fc = JSON.parse(fs.readFileSync(simpl, 'utf8'));
    corrigirSentido(fc);
    const W = 620;
    const tmp = d3.geoMercator().fitWidth(W - 12, fc);
    const b = d3.geoPath(tmp).bounds(fc);
    const H = Math.max(300, Math.min(720, Math.round((b[1][1] - b[0][1]) + 12)));
    const proj = d3.geoMercator().fitExtent([[6, 6], [W - 6, H - 6]], fc);
    const caminho = d3.geoPath(proj).digits(1);
    const p = {};
    let semCod = 0;
    for (const f of fc.features) {
      const t = ibge2tse[String(f.properties.codarea || f.properties.id)];
      if (!t) { semCod++; continue; }
      const d = caminho(f);
      if (!d) { semCod++; continue; }
      p[t] = d;
    }
    const dest = `${SITE}/estatico/mapas/${uf}.json`;
    fs.writeFileSync(dest, JSON.stringify({w: W, h: H, p}));
    const kb = fs.statSync(dest).size / 1e3;
    total += kb;
    console.log(`${uf}: ${Object.keys(p).length} municípios${semCod ? `, ${semCod} sem código TSE` : ''}, ${kb.toFixed(0)} KB (${fonte[uf] || 'cache'})`);
  }
  console.log(`mapas prontos: ${total.toFixed(0)} KB no total`);
})().catch(e => { console.error(e); process.exit(1); });
