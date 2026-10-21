/*
 * Modelo de projeção da apuração (2º turno), compartilhado entre o coletor (Node) e o site (navegador).
 *
 * As funções pooled, nuHat e swing são cópia fiel das versões usadas nos testes
 * (codigo/backtest_navegador.js, conferido byte a byte em 20/10/2026).
 * Modelo: "Virada vs 1º turno do mesmo ano — município + UF + região".
 */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Modelo = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;
  const REG = {
    AC: 'N', AM: 'N', AP: 'N', PA: 'N', RO: 'N', RR: 'N', TO: 'N',
    AL: 'NE', BA: 'NE', CE: 'NE', MA: 'NE', PB: 'NE', PE: 'NE', PI: 'NE', RN: 'NE', SE: 'NE',
    DF: 'CO', GO: 'CO', MS: 'CO', MT: 'CO',
    ES: 'SE', MG: 'SE', RJ: 'SE', SP: 'SE',
    PR: 'S', RS: 'S', SC: 'S', ZZ: 'EX'
  };
  const KAP_HIER = [200000, 20000, 300];   // região, UF, município (em votos)
  const KAP_NU = [2000, 500, 50];          // comparecimento válido

  const logit = p => { p = Math.min(Math.max(p, EPS), 1 - EPS); return Math.log(p / (1 - p)); };
  const expit = x => 1 / (1 + Math.exp(-x));

  // ---- cópia fiel (M.pooled) ----
  function pooled(U, val, w, kap) {
    const n = U.n; let sw = 0, swv = 0;
    for (let u = 0; u < n; u++) { sw += w[u]; swv += w[u] * val[u]; }
    const prior = sw > 0 ? swv / sw : 0;
    const est = new Float64Array(n).fill(prior);
    const niveis = [U.reg, U.uf, null];
    for (let L = 0; L < 3; L++) {
      const kappa = kap[L];
      if (niveis[L] === null) { for (let u = 0; u < n; u++) est[u] = (w[u] * val[u] + kappa * est[u]) / (w[u] + kappa); continue; }
      const g = niveis[L], acc = new Map();
      for (let u = 0; u < n; u++) { let a = acc.get(g[u]); if (!a) { a = {wv: 0, w: 0, pri: est[u]}; acc.set(g[u], a); } a.wv += w[u] * val[u]; a.w += w[u]; }
      for (let u = 0; u < n; u++) { const a = acc.get(g[u]); est[u] = (a.wv + kappa * a.pri) / (a.w + kappa); }
    }
    return est;
  }

  // ---- cópia fiel (M.nuHat) ----
  function nuHat(U, st, kap) {
    const n = U.n, ratio = new Float64Array(n), w = new Float64Array(n);
    for (let u = 0; u < n; u++) { if (st.a[u] > 0) { ratio[u] = st.v[u] / Math.max(st.a[u] * U.nu_ref[u], 1); w[u] = st.a[u] / 100; } else { ratio[u] = 1; w[u] = 0; } }
    const est = pooled(U, ratio, w, kap || KAP_NU);
    for (let u = 0; u < n; u++) est[u] *= U.nu_ref[u];
    return est;
  }

  // ---- cópia fiel (M.swing) ----
  function swing(U, num, den, ref, kap) {
    const n = U.n, d = new Float64Array(n), w = new Float64Array(n), out = new Float64Array(n);
    for (let u = 0; u < n; u++) { if (den[u] > 0) { d[u] = logit((num[u] + 0.5) / (den[u] + 1)) - logit(ref[u]); w[u] = den[u]; } }
    const s = pooled(U, d, w, kap);
    for (let u = 0; u < n; u++) out[u] = expit(logit(ref[u]) + s[u]);
    return out;
  }

  /*
   * Monta as unidades (municípios) com as referências do 1º turno.
   * lista: [{cod, uf, A}]  (A = eleitorado do 2º turno; se faltar, usa o do 1º)
   * refs:  {cod: {pt, adv, val, aptos}}  (resultado final do 1º turno no município)
   * Sem referência: média do estado (como no teste).
   */
  function unidades(lista, refs) {
    const n = lista.length;
    const U = {n, cod: new Array(n), uf: new Array(n), reg: new Array(n), A: new Float64Array(n), r_1t: new Float64Array(n), nu_ref: new Float64Array(n), semRef: 0};
    const ok = new Uint8Array(n), acc = {};
    for (let u = 0; u < n; u++) {
      const m = lista[u], c = refs[m.cod];
      U.cod[u] = m.cod; U.uf[u] = m.uf; U.reg[u] = REG[m.uf] || 'EX';
      U.A[u] = m.A > 0 ? m.A : (c ? c.aptos : 0);
      const a = acc[m.uf] || (acc[m.uf] = {pt: 0, adv: 0, val: 0, ap: 0});
      if (c && c.val > 0 && (c.pt + c.adv) > 0 && c.aptos > 0) {
        U.r_1t[u] = c.pt / (c.pt + c.adv); U.nu_ref[u] = c.val / c.aptos; ok[u] = 1;
        a.pt += c.pt; a.adv += c.adv; a.val += c.val; a.ap += c.aptos;
      }
    }
    for (let u = 0; u < n; u++) if (!ok[u]) {
      U.semRef++;
      const a = acc[U.uf[u]];
      U.r_1t[u] = a && (a.pt + a.adv) > 0 ? a.pt / (a.pt + a.adv) : 0.5;
      U.nu_ref[u] = a && a.ap > 0 ? a.val / a.ap : 0.8;
    }
    return U;
  }

  /*
   * Projeta o resultado final.
   * st: {a, x, y, v} por unidade — a = eleitorado das seções já totalizadas,
   *     x = votos Lula, y = votos do adversário, v = votos válidos.
   * Retorna totais projetados do Brasil, por UF e a fatia projetada de Lula em cada unidade.
   */
  function projetar(U, st) {
    const n = U.n, xy = new Float64Array(n);
    for (let u = 0; u < n; u++) xy[u] = st.x[u] + st.y[u];
    const p = swing(U, st.x, xy, U.r_1t, KAP_HIER);
    const nu = nuHat(U, st);
    const porUF = {};
    let PT = 0, ADV = 0, VAL = 0;
    const pu = new Float64Array(n);
    for (let u = 0; u < n; u++) {
      const rem = Math.max(U.A[u] - st.a[u], 0) * nu[u];
      const a = st.x[u] + rem * p[u], b = st.y[u] + rem * (1 - p[u]), c = st.v[u] + rem;
      PT += a; ADV += b; VAL += c;
      const g = porUF[U.uf[u]] || (porUF[U.uf[u]] = {pt: 0, adv: 0, val: 0});
      g.pt += a; g.adv += b; g.val += c;
      pu[u] = (a + b) > 0 ? a / (a + b) : NaN;
    }
    return {pt: PT, adv: ADV, val: VAL, l2: PT / (PT + ADV), porUF, pu};
  }

  // ---- incerteza calibrada nos testes (erro na margem, em pontos) ----
  const TESTE = {"pontos":[0.5,1,2,3,5,7.5,10,11,15,20,25,30,40,50,60,70,80,85,90,95,98],"m":[[4.21,3.4,1.59,0.43,-0.75,-0.5,-0.39,-0.7,-0.82,-1.14,-1.01,-1.13,-0.82,-0.63,-0.55,-0.48,-0.33,-0.28,-0.25,-0.17,-0.11],[-0.04,1.79,1.34,0.77,0,-0.4,-0.56,-0.76,-0.63,-0.75,-0.91,-1.18,-1.09,-1.05,-0.89,-0.64,-0.33,-0.24,-0.18,-0.1,-0.05],[3.47,4.58,4.3,1.82,1.38,1,0.29,-0.13,-0.29,-0.68,-1.07,-1.04,-0.85,-0.67,-0.38,-0.37,-0.23,-0.23,-0.19,-0.03,-0.01]],"b":[[-4.47,-4.8,-5.41,-6.3,-7.24,-7.9,-8.3,-8.57,-8.63,-8.48,-8.13,-7.8,-7.25,-6.59,-5.82,-4.94,-3.78,-3.1,-2.25,-1.32,-0.69],[-12.48,-14.48,-15,-12.42,-8.37,-6.96,-5.85,-5.55,-5.01,-4.92,-4.33,-3.91,-3.08,-2.41,-2.05,-1.7,-1.23,-0.97,-0.74,-0.49,-0.26],[-6.19,-8.38,-19.63,-14.51,-9.62,-13.32,-8.64,-9.62,-5.45,-4.63,-4.75,-4.1,-3.19,-2.01,-1.53,-1.58,-1.46,-1.17,-0.66,-0.91,-0.47]]};
  const RMS = TESTE.pontos.map((_, i) => Math.sqrt((TESTE.m[0][i] ** 2 + TESTE.m[1][i] ** 2 + TESTE.m[2][i] ** 2) / 3));
  function sigmaBruto(p) {
    const X = TESTE.pontos;
    let r = RMS[RMS.length - 1];
    if (p <= X[0]) r = RMS[0];
    else for (let i = 1; i < X.length; i++) if (p <= X[i]) { const w = (p - X[i - 1]) / (X[i] - X[i - 1]); r = RMS[i - 1] + w * (RMS[i] - RMS[i - 1]); break; }
    return Math.max(0.15, 1.5 * r);
  }
  // A faixa nunca encolhe antes da hora: nos testes, o erro do meio da noite foi maior que o de 10%.
  function sigma(pct) {
    if (pct >= 99.999) return 0;
    let s = sigmaBruto(pct);
    for (const q of TESTE.pontos) if (q >= pct) s = Math.max(s, sigmaBruto(q));
    return s;
  }
  function Phi(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  // pl2 = fatia projetada de Lula (0–100, só os dois); pct = % de seções apuradas (0–100)
  function avaliar(pl2, pct) {
    const sig = sigma(pct);
    const m2 = 100 - 2 * pl2;                       // adversário menos Lula, em pontos
    const chAdv = sig === 0 ? (m2 > 0 ? 1 : m2 < 0 ? 0 : 0.5) : Phi(m2 / sig);
    const pronto = pct >= 0.5;
    const lider = m2 > 0 ? 'adv' : 'lula';
    const ch = Math.max(chAdv, 1 - chAdv);
    let status = 'aguardando';
    // "Empate técnico" = chance do líder abaixo de 90%. Até 21/10 também valia "diferença menor que 1,5 ponto",
    // mas no ensaio de 2022 isso pôs "Empate técnico" ao lado de 99% de chance (18h42–18h52).
    if (pronto) status = ch < 0.9 ? 'empate' : ch < 0.99 ? 'vantagem' : 'vence';
    return {sig, m2, chAdv, lider, ch, pronto, status};
  }

  return {EPS, REG, KAP_HIER, KAP_NU, logit, expit, pooled, nuHat, swing, unidades, projetar, TESTE, sigma, Phi, avaliar};
});
