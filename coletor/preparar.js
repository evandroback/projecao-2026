/*
 * Preparo dos dados de referência — roda uma vez na VM.
 * Lê os dados abertos do TSE (zips em BRUTOS) e grava em BASE:
 *   refs2026.json        1º turno de 2026 por município (Lula, Flávio, outros, válidos, eleitorado, comparecimento, brancos, nulos)
 *   refs2022.json        1º e 2º turnos de 2022 por município (Lula, Bolsonaro, válidos, eleitorado)
 *   refs2022_t1.json     1º turno de 2022 no formato das referências (para o ensaio com 2022)
 *   curvas2026.json      curvas do 1º turno de 2026 (Brasil por % e por minuto; estados por % e por horário)
 *   secoes_2026_1.json   seções do 1º turno de 2026 em ordem de totalização (ensaio)
 *   secoes_2022_2.json   seções do 2º turno de 2022 em ordem de totalização (ensaio)
 */
'use strict';
const {spawn, execSync} = require('child_process');
const readline = require('readline');
const fs = require('fs');

const BRUTOS = process.env.BRUTOS || '/opt/projecao/brutos';
const BASE = process.env.BASE || '/opt/projecao/base';
fs.mkdirSync(BASE, {recursive: true});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const REGIAO = require('./modelo.js').REG;   // UF -> N, NE, CO, SE, S, EX

// Usa o CSV do Brasil inteiro (_BR.csv); se o zip só tiver um CSV por estado, lê todos eles.
function membros(zip) {
  const nomes = execSync(`unzip -Z1 "${zip}"`, {maxBuffer: 64 << 20}).toString().split('\n').map(n => n.trim()).filter(Boolean);
  const br = nomes.find(n => /_BR\.csv$/i.test(n));
  if (br) return [br];
  const ufs = nomes.filter(n => /_[A-Z]{2}\.csv$/i.test(n));
  if (!ufs.length) throw new Error('nenhum CSV por estado ou do Brasil em ' + zip + ': ' + nomes.slice(0, 10).join(', '));
  log(`${zip}: sem _BR.csv, lendo ${ufs.length} arquivos por estado`);
  return ufs;
}
async function linhasZip(zip, precisa, cb) {
  let n = 0;
  for (const m of membros(zip)) n += (await linhas(zip, m, precisa, cb)).n;
  return {n};
}

// Divide uma linha do CSV do TSE (";" e aspas). Um campo entre aspas pode ter ";" dentro (ex.: endereço).
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

async function linhas(zip, membro, precisa, cb) {
  const p = spawn('unzip', ['-p', zip, membro]);
  p.stdout.setEncoding('latin1');
  const rl = readline.createInterface({input: p.stdout, crlfDelay: Infinity});
  let h = null, n = 0;
  for await (const linha of rl) {
    if (!linha) continue;
    const c = separar(linha);
    if (!h) {
      h = {}; c.forEach((k, i) => h[k.trim()] = i);
      const faltam = precisa.filter(k => !(k in h));
      if (faltam.length) { p.kill(); throw new Error(`${membro}: faltam as colunas ${faltam.join(', ')}. Colunas do arquivo: ${Object.keys(h).join(', ')}`); }
      continue;
    }
    cb(c, h); n++;
  }
  return {n, cabecalho: h};
}

// minutos depois das 17h do dia da eleição ("DD/MM/AAAA HH:MM:SS")
const minutos = (s, dia) => {
  if (!s || s.length < 19 || s[0] === '#') return NaN;
  return (+s.slice(0, 2) - dia) * 1440 + (+s.slice(11, 13) - 17) * 60 + (+s.slice(14, 16)) + (+s.slice(17, 19)) / 60;
};

async function carregar(ano, turnos) {
  const SS = {};
  for (const t of Object.keys(turnos)) SS[t] = {key: new Map(), uf: [], mun: [], aptos: [], comp: [], tt: [], semchave: 0};
  const zDet = `${BRUTOS}/detalhe_votacao_secao_${ano}.zip`;
  log('lendo', zDet);
  const r1 = await linhasZip(zDet, ['CD_CARGO', 'NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'QT_APTOS', 'QT_COMPARECIMENTO', 'DT_PRIM_TOT_PARCIAL_HOR_TSE'], (c, h) => {
    if (c[h.CD_CARGO] !== '1') return;
    const T = c[h.NR_TURNO], S = SS[T];
    if (!S) return;
    const k = c[h.SG_UF] + '|' + parseInt(c[h.CD_MUNICIPIO], 10) + '|' + parseInt(c[h.NR_ZONA], 10) + '|' + parseInt(c[h.NR_SECAO], 10);
    let i = S.key.get(k);
    if (i === undefined) { i = S.uf.length; S.key.set(k, i); S.uf.push(c[h.SG_UF]); S.mun.push(parseInt(c[h.CD_MUNICIPIO], 10)); S.aptos.push(0); S.comp.push(0); S.tt.push(NaN); }
    S.aptos[i] += +c[h.QT_APTOS] || 0;
    S.comp[i] += +c[h.QT_COMPARECIMENTO] || 0;
    const t = minutos(c[h.DT_PRIM_TOT_PARCIAL_HOR_TSE], turnos[T]);
    if (!(S.tt[i] <= t)) S.tt[i] = t;
  });
  log('detalhe:', r1.n, 'linhas');
  for (const S of Object.values(SS)) {
    const N = S.uf.length;
    S.pt = new Int32Array(N); S.adv = new Int32Array(N); S.out = new Int32Array(N); S.bra = new Int32Array(N); S.nul = new Int32Array(N); S.anu = new Int32Array(N);
    S.codigos = {};
  }
  const zVot = `${BRUTOS}/votacao_secao_${ano}_BR.zip`;
  log('lendo', zVot);
  const r2 = await linhasZip(zVot, ['CD_CARGO', 'NR_TURNO', 'SG_UF', 'CD_MUNICIPIO', 'NR_ZONA', 'NR_SECAO', 'NR_VOTAVEL', 'QT_VOTOS'], (c, h) => {
    if (c[h.CD_CARGO] !== '1') return;
    const S = SS[c[h.NR_TURNO]];
    if (!S) return;
    const k = c[h.SG_UF] + '|' + parseInt(c[h.CD_MUNICIPIO], 10) + '|' + parseInt(c[h.NR_ZONA], 10) + '|' + parseInt(c[h.NR_SECAO], 10);
    const i = S.key.get(k);
    if (i === undefined) { S.semchave++; return; }
    const nr = c[h.NR_VOTAVEL], v = +c[h.QT_VOTOS] || 0, cod = +nr;
    if (nr === '13') S.pt[i] += v;
    else if (nr === '22') S.adv[i] += v;
    else if (cod === 95) S.bra[i] += v;
    else if (cod === 96) S.nul[i] += v;
    else if (cod > 96) S.anu[i] += v;          // anulados (97, 98...): conferidos contra o TSE no montar_site.js
    else S.out[i] += v;
    if (!(cod > 0 && cod < 95) || nr === '13' || nr === '22') S.codigos[nr] = (S.codigos[nr] || 0) + v;
  });
  log('votação:', r2.n, 'linhas');
  for (const [t, S] of Object.entries(SS)) log(`turno ${t}: ${S.uf.length} seções, ${S.semchave} linhas sem seção; votos por código especial:`, JSON.stringify(S.codigos));
  return SS;
}

function porMunicipio(S) {
  const R = {};
  for (let i = 0; i < S.uf.length; i++) {
    const m = S.mun[i];
    const r = R[m] || (R[m] = {uf: S.uf[i], pt: 0, adv: 0, out: 0, val: 0, aptos: 0, comp: 0, bra: 0, nul: 0, anu: 0, sec: 0});
    r.pt += S.pt[i]; r.adv += S.adv[i]; r.out += S.out[i]; r.val += S.pt[i] + S.adv[i] + S.out[i];
    r.aptos += S.aptos[i]; r.comp += S.comp[i]; r.bra += S.bra[i]; r.nul += S.nul[i]; r.anu += S.anu[i]; r.sec++;
  }
  return R;
}

function ordem(S) {
  const N = S.uf.length;
  const o = Array.from({length: N}, (_, i) => i);
  o.sort((a, b) => {
    const ta = S.tt[a], tb = S.tt[b];
    if (isNaN(ta)) return isNaN(tb) ? 0 : 1;
    if (isNaN(tb)) return -1;
    return ta - tb;
  });
  return o;
}

function curvas(S) {
  const N = S.uf.length, o = ordem(S);
  const UFS = [...new Set(S.uf)].sort();
  // Brasil por % apurado (0,5% a 100%)
  const nacPct = [];
  let k = 0;
  const acc = {sec: 0, aptos: 0, comp: 0, pt: 0, adv: 0, out: 0, bra: 0, nul: 0, anu: 0};
  const somar = (A, i) => { A.sec++; A.aptos += S.aptos[i]; A.comp += S.comp[i]; A.pt += S.pt[i]; A.adv += S.adv[i]; A.out += S.out[i]; A.bra += S.bra[i]; A.nul += S.nul[i]; A.anu += S.anu[i]; };
  for (let s = 1; s <= 200; s++) {
    const alvo = Math.ceil(s / 200 * N);
    while (k < alvo) somar(acc, o[k++]);
    nacPct.push([acc.sec, acc.aptos, acc.comp, acc.pt, acc.adv, acc.out, acc.bra, acc.nul, acc.anu]);
  }
  // Brasil por minuto (17h00 até 01h00)
  const nacMin = [];
  k = 0;
  const acc2 = {sec: 0, aptos: 0, comp: 0, pt: 0, adv: 0, out: 0, bra: 0, nul: 0, anu: 0};
  for (let m = 0; m <= 480; m++) {
    while (k < N && S.tt[o[k]] <= m) somar(acc2, o[k++]);
    nacMin.push([acc2.sec, acc2.pt, acc2.adv, acc2.aptos, acc2.comp, acc2.bra, acc2.nul, acc2.anu]);
  }
  // um grupo de seções (um estado ou uma região), já em ordem de totalização:
  // Lula (só os dois) em 1%..100% das seções do grupo e a cada 5 minutos da noite
  function curvaGrupo(l) {
    const pct = [], min = [];
    let q = 0, pt = 0, adv = 0;
    for (let s = 1; s <= 100; s++) {
      const alvo = Math.ceil(s / 100 * l.length);
      while (q < alvo) { const i = l[q++]; pt += S.pt[i]; adv += S.adv[i]; }
      pct.push(pt + adv > 0 ? Math.round(10000 * pt / (pt + adv)) : -1);
    }
    q = 0; pt = 0; adv = 0;
    for (let m = 0; m <= 480; m += 5) {
      while (q < l.length && S.tt[l[q]] <= m) { const i = l[q++]; pt += S.pt[i]; adv += S.adv[i]; }
      min.push([q, pt + adv > 0 ? Math.round(10000 * pt / (pt + adv)) : -1]);
    }
    return {pct, min, tot: l.length};
  }
  // estados
  const porUF = {};
  for (const i of o) (porUF[S.uf[i]] || (porUF[S.uf[i]] = [])).push(i);
  const ufPct = {}, ufMin = {}, ufTot = {};
  for (const uf of UFS) { const c = curvaGrupo(porUF[uf] || []); ufPct[uf] = c.pct; ufMin[uf] = c.min; ufTot[uf] = c.tot; }
  // regiões (Norte, Nordeste, Centro-Oeste, Sudeste, Sul, Exterior)
  const porReg = {};
  for (const i of o) { const r = REGIAO[S.uf[i]] || 'EX'; (porReg[r] || (porReg[r] = [])).push(i); }
  const regPct = {}, regMin = {}, regTot = {};
  for (const r of Object.keys(porReg)) { const c = curvaGrupo(porReg[r]); regPct[r] = c.pct; regMin[r] = c.min; regTot[r] = c.tot; }
  return {N, nacPct, nacMin, ufPct, ufMin, ufTot, regPct, regMin, regTot};
}

function secoesEnsaio(S) {
  const o = ordem(S);
  const pick = (arr, f) => o.map(i => f ? f(arr[i]) : arr[i]);
  return {
    mun: pick(S.mun), uf: pick(S.uf),
    tt: pick(S.tt, t => isNaN(t) ? 9999 : Math.round(t * 100) / 100),
    aptos: pick(S.aptos), comp: pick(S.comp), pt: pick(S.pt), adv: pick(S.adv), out: pick(S.out), bra: pick(S.bra), nul: pick(S.nul), anu: pick(S.anu)
  };
}

const gravar = (nome, obj) => { fs.writeFileSync(`${BASE}/${nome}`, JSON.stringify(obj)); log('gravado', nome, (fs.statSync(`${BASE}/${nome}`).size / 1e6).toFixed(1), 'MB'); };

(async () => {
  const S26 = (await carregar(2026, {'1': 4}))['1'];
  const R26 = porMunicipio(S26);
  gravar('refs2026.json', R26);
  gravar('curvas2026.json', curvas(S26));
  gravar('secoes_2026_1.json', secoesEnsaio(S26));
  const t26 = Object.values(R26).reduce((a, r) => (a.pt += r.pt, a.adv += r.adv, a.val += r.val, a), {pt: 0, adv: 0, val: 0});
  log('conferência 2026, 1º turno: Lula', (100 * t26.pt / t26.val).toFixed(2), '% Flávio', (100 * t26.adv / t26.val).toFixed(2), '% dos válidos');

  const SS22 = await carregar(2022, {'1': 2, '2': 30});
  const A = porMunicipio(SS22['1']), B = porMunicipio(SS22['2']);
  const R22 = {};
  for (const m of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const a = A[m], b = B[m];
    R22[m] = {uf: (a || b).uf, t1: a ? {pt: a.pt, adv: a.adv, val: a.val, aptos: a.aptos} : null, t2: b ? {pt: b.pt, adv: b.adv, val: b.val, aptos: b.aptos} : null};
  }
  gravar('refs2022.json', R22);
  gravar('refs2022_t1.json', A);
  gravar('secoes_2022_2.json', secoesEnsaio(SS22['2']));
  const t22 = Object.values(B).reduce((a, r) => (a.pt += r.pt, a.adv += r.adv, a), {pt: 0, adv: 0});
  log('conferência 2022, 2º turno: Lula', (100 * t22.pt / (t22.pt + t22.adv)).toFixed(3), '%');
  log('pronto');
})().catch(e => { console.error(e); process.exit(1); });
