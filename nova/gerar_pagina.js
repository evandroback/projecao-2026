/*
 * Gera site/nova/index.html a partir de site/index.html (a página principal NÃO é alterada).
 * Roda no computador de quem mexe no repositório:  node nova/gerar_pagina.js
 * Diferenças da cópia: lê /dados/nova (ou /dados/nova_ensaio com ?dados=nova_ensaio), mostra uma faixa
 * "versão de teste", não aparece em buscadores e o painel de erro mostra os testes do modelo novo.
 */
'use strict';
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..');
let s = fs.readFileSync(path.join(R, 'site/index.html'), 'utf8');
function troca(velho, novo) {
  const n = s.split(velho).length - 1;
  if (n !== 1) throw new Error(`esperava 1 ocorrência, achei ${n}: ${velho.slice(0, 80)}`);
  s = s.replace(velho, () => novo);
}
troca('<title>Projeção da Apuração 2026</title>',
  '<title>Modelo novo (teste) · Projeção da Apuração 2026</title>\n<meta name="robots" content="noindex, nofollow">');
troca("const DADOS = SIM ? '/simulacao/dados' : '/dados';",
  "const DADOS = new URLSearchParams(location.search).get('dados') === 'nova_ensaio' ? '/dados/nova_ensaio' : '/dados/nova';   // /nova: números do modelo novo");
troca('<script src="/estatico/modelo.js"></script>',
  '<script src="/estatico/modelo.js"></script>\n<script src="/nova/modelo_nova.js"></script>\n<script>Modelo.TESTE = {pontos: ModeloNovo.TESTE.pontos, m: ModeloNovo.TESTE.m.eleitorado, b: ModeloNovo.TESTE.b};</script>');
troca('const media = arr => X.map((p, i) => [p, (Math.abs(arr[0][i]) + Math.abs(arr[1][i]) + Math.abs(arr[2][i])) / 3]);',
  'const media = arr => X.map((p, i) => [p, arr.reduce((t, l) => t + Math.abs(l[i]), 0) / arr.length]);');
troca("${SIM ? 'Simulação 2022 · ' : ''}", "${SIM ? 'Simulação 2022 · ' : 'Modelo novo · '}");
troca('<body>\n', '<body>\n<div role="note" style="background:#f2b33d;color:#1a1200;padding:8px 16px;font:600 14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;text-align:center">Versão de teste do <b>modelo novo</b> — uso interno, não divulgar. O site oficial é a <a href="/" style="color:inherit;text-decoration:underline">página principal</a>.</div>\n');
troca('Média de três noites: 1º turno de 2026, 2º turno de 2022 e 2º turno de 2018.',
  'Modelo novo. Média de seis noites: 2º turnos de 2002, 2006, 2010, 2014, 2018 e 2022 (2018 e 2022 com a ordem real de chegada das urnas; as outras, com a ordem de 2022).');
troca('Cidades com poucos votos apurados puxam a estimativa do estado e da região.</p>',
  'Cidades com poucos votos apurados puxam a estimativa do estado e da região.</p>\n          <p><b>Nesta versão de teste</b>, cada cidade é comparada com o 1º turno das mesmas urnas que já chegaram (pela ordem de chegada de 4 de outubro), e o que falta é estimado pelo 1º turno das urnas que faltam.</p>');
troca('foram calibradas com só três eleições de teste.', 'foram calibradas com seis eleições de teste, com a mesma regra da página principal.');
fs.mkdirSync(path.join(R, 'site/nova'), {recursive: true});
fs.writeFileSync(path.join(R, 'site/nova/index.html'), s);
console.log('site/nova/index.html gerado', s.length, 'bytes');
