#!/usr/bin/env bash
# Teste do ritmo de domingo contra o TSE de verdade, usando o 1º turno de 2026 (que tem todos os dados).
#   teste_tse.sh [minutos]   (padrão 10)
# Para o coletor ao vivo, roda um coletor de teste no ritmo de domingo (40 pedidos/s, 12 em paralelo)
# gravando numa pasta separada (/opt/projecao/teste) — o site público não muda —, publica o resumo em
# /dados/teste_tse.json e religa o coletor ao vivo. Religa sempre, mesmo se o teste der erro.
set -uo pipefail
P=/opt/projecao
MIN=${1:-10}
[[ "$MIN" =~ ^[0-9]{1,2}$ ]] && [ "$MIN" -ge 1 ] && [ "$MIN" -le 30 ] || MIN=10
T=$P/teste
religar() { sudo systemctl start projecao-coletor; }
trap religar EXIT
rm -rf "$T" && mkdir -p "$T/saida" "$T/estado"
sudo systemctl stop projecao-coletor
INICIO=$(date '+%F %T')
# ACELERAR=20: as cidades do 1º turno já estão encerradas; sem isso o coletor pediria cada uma
# só a cada 10 minutos e o ritmo de domingo não seria testado.
TSE_BASE=https://resultados.tse.jus.br ANO=2026 ELEICAO=6257 REFS=$P/base/refs2026.json \
SAIDA=$T/saida ESTADO=$T/estado ENSAIO= TAXA=40 CONCORRENCIA=12 ACELERAR=20 \
  timeout $((MIN * 60)) node $P/app/coletor.js > "$T/coletor.log" 2>&1
FIM=$(date '+%F %T')
node $P/app/resumo_teste.js "$T/coletor.log" "$T/saida/nacional.json" "$P/saida/teste_tse.json" "$INICIO" "$FIM" "$MIN"
echo "teste do TSE terminado ($INICIO a $FIM); resumo em /dados/teste_tse.json"
