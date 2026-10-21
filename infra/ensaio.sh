#!/usr/bin/env bash
# Liga um ENSAIO: um servidor local reprisa uma eleição real seção por seção, e o coletor lê dele
# em vez do TSE. O site mostra a faixa "Ensaio". Para voltar ao normal: /opt/projecao/ao_vivo.sh
#   ensaio.sh 2022 [velocidade] [inicio]   2º turno de 2022, com o 1º turno de 2022 como referência (teste de verdade da projeção)
#   ensaio.sh 2026 [velocidade] [inicio]   1º turno de 2026 como se fosse 2º turno (teste do site com nomes e números de 2026)
# velocidade 4 = 4 minutos de apuração por minuto real; inicio -3 = começa às 16h57.
set -euo pipefail
P=/opt/projecao
QUAL=${1:-2022}; VEL=${2:-4}; INI=${3:--3}
case "$QUAL" in
  2022) SECOES=$P/base/secoes_2022_2.json; REFS=$P/base/refs2022_t1.json; NOME="reprise do 2º turno de 2022, em velocidade ${VEL}x";;
  2026) SECOES=$P/base/secoes_2026_1.json; REFS=$P/base/refs2026.json;    NOME="reprise do 1º turno de 2026 só com Lula e Flávio, em velocidade ${VEL}x";;
  *) echo "use: ensaio.sh 2022|2026 [velocidade] [inicio]"; exit 1;;
esac
printf 'SECOES=%s\nVELOCIDADE=%s\nINICIO=%s\n' "$SECOES" "$VEL" "$INI" > $P/ensaio.env
cat > $P/coletor.env <<EOF
TSE_BASE=http://127.0.0.1:8081
ANO=2026
ELEICAO=6258
REFS=$REFS
SAIDA=$P/saida
ESTADO=$P/estado
ENSAIO=$NOME
TAXA=300
CONCORRENCIA=24
ACELERAR=$VEL
EOF
sudo systemctl stop projecao-coletor
rm -f $P/estado/*ensaio* $P/saida/*.json
sudo systemctl restart projecao-ensaio
sleep 2
sudo systemctl start projecao-coletor
# volta sozinho para o modo ao vivo depois de DURACAO minutos (padrão 120), mesmo que ninguém lembre.
# Pelo controle.txt, a duração é o 4º número: "ensaio 2022 4 -3 1440" segura o ensaio por 24 horas.
DUR=${DURACAO:-}
if [ -z "$DUR" ]; then DUR=$(head -n1 $P/repo/controle.txt 2>/dev/null | tr -cd 'a-z0-9 .-' | awk '{print $5}'); fi
[[ "$DUR" =~ ^[0-9]{1,4}$ ]] && [ "$DUR" -ge 1 ] || DUR=120
sudo systemctl stop projecao-volta-ao-vivo.timer 2>/dev/null || true
sudo systemctl reset-failed projecao-volta-ao-vivo.service 2>/dev/null || true
sudo systemd-run --quiet --unit=projecao-volta-ao-vivo --uid=ubuntu --on-active="${DUR}m" /opt/projecao/ao_vivo.sh
echo "Ensaio ligado: $NOME. Volta sozinho ao modo ao vivo em ${DUR} minutos. Acompanhe com /opt/projecao/status.sh"
