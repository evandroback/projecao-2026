// Resume o teste de ritmo contra o TSE (infra/teste_tse.sh): lê o log do coletor de teste e grava um JSON pequeno.
//   node resumo_teste.js LOG NACIONAL_JSON SAIDA_JSON INICIO FIM MINUTOS
'use strict';
const fs = require('fs');
const [log, nacArq, saida, inicio, fim, min] = process.argv.slice(2);
const linhas = (fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '').split('\n').filter(Boolean);
const porMinuto = [];
for (const l of linhas) {
  const m = /pedidos\/min (\d+) · ritmo ([\d.]+)\/s · na fila (\d+) · erros (\d+) \(([^)]*)\)/.exec(l);
  if (m) porMinuto.push({hora: l.slice(0, 8), pedidos: +m[1], ritmo: +m[2], naFila: +m[3], errosAteAqui: +m[4], ultimoErro: m[5]});
}
const recusas = linhas.filter(l => l.includes('TSE recus'));
let nac = null;
try { nac = JSON.parse(fs.readFileSync(nacArq, 'utf8')); } catch (e) {}
const r = {
  inicio, fim, minutos: +min, porMinuto,
  avisosDeRecusa: recusas.length, exemplosDeRecusa: recusas.slice(0, 5),
  saude: nac && nac.saude, apurado: nac && nac.br ? `${nac.br.st}/${nac.br.ts}` : null,
  ultimasLinhas: linhas.slice(-6)
};
fs.writeFileSync(saida + '.tmp', JSON.stringify(r));
fs.renameSync(saida + '.tmp', saida);
