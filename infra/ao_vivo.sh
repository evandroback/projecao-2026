#!/usr/bin/env bash
# Volta o coletor para o TSE de verdade (modo AO VIVO) e desliga o servidor de ensaio.
#   ao_vivo.sh              troca e reinicia
#   ao_vivo.sh --so-config  só grava a configuração (usado pelo instalar.sh)
set -euo pipefail
P=/opt/projecao
cat > $P/coletor.env <<EOF
TSE_BASE=https://resultados.tse.jus.br
ANO=2026
ELEICAO=6258
REFS=$P/base/refs2026.json
SAIDA=$P/saida
ESTADO=$P/estado
ENSAIO=
TAXA=40
CONCORRENCIA=12
ACELERAR=1
EOF
[ "${1:-}" = "--so-config" ] && exit 0
sudo systemctl stop projecao-volta-ao-vivo.timer 2>/dev/null || true   # cancela a volta automática agendada pelo ensaio
sudo systemctl stop projecao-coletor
sudo systemctl stop projecao-ensaio 2>/dev/null || true
rm -f $P/estado/*ensaio* $P/saida/*.json
sudo systemctl start projecao-coletor
echo "Coletor AO VIVO, lendo resultados.tse.jus.br. Acompanhe com /opt/projecao/status.sh"
