/*
 * Gera estatico/votos_cidades.json: votos de Lula e do adversário em cada cidade, no 1º turno de 2026 e no
 * 2º turno de 2022, a partir das referências já conferidas (base/refs2026.json e base/refs2022.json).
 * Não baixa nada. O site só busca este arquivo quando a seção Cidades aparece na tela.
 *   formato: {gerado, v: {codigoTSE: [lula2026, flavio2026, lula2022, bolsonaro2022]}}   (-1 = sem dado)
 */
'use strict';
const fs = require('fs');
const BASE = process.env.BASE || '/opt/projecao/base';
const SITE = process.env.SITE || '/opt/projecao/site';
const r26 = JSON.parse(fs.readFileSync(`${BASE}/refs2026.json`, 'utf8'));
const r22 = JSON.parse(fs.readFileSync(`${BASE}/refs2022.json`, 'utf8'));
const v = {};
for (const cod of new Set([...Object.keys(r26), ...Object.keys(r22)])) {
  const a = r26[cod], b = r22[cod] && r22[cod].t2;
  v[cod] = [a ? a.pt : -1, a ? a.adv : -1, b ? b.pt : -1, b ? b.adv : -1];
}
const soma = k => Object.values(v).reduce((s, x) => s + (x[k] > 0 ? x[k] : 0), 0);
const destino = `${SITE}/estatico/votos_cidades.json`;
fs.writeFileSync(destino + '.tmp', JSON.stringify({gerado: Date.now(), v}));
fs.renameSync(destino + '.tmp', destino);
console.log(`votos_cidades.json: ${Object.keys(v).length} cidades · 1º turno 2026 ${soma(0)} × ${soma(1)} · 2º turno 2022 ${soma(2)} × ${soma(3)} · ${(fs.statSync(destino).size / 1e3).toFixed(0)} KB`);
