#!/usr/bin/env bash
# Liga (ou religa) o processo do modelo novo do /nova. Não toca no coletor principal nem no TSE.
#   nova_ligar.sh            liga lendo /opt/projecao/saida (o que o site principal publica)
#   nova_ligar.sh desligar   desliga
set -uo pipefail
P=/opt/projecao
sudo systemctl stop projecao-nova 2>/dev/null || true
sudo systemctl reset-failed projecao-nova 2>/dev/null || true
[ "${1:-}" = "desligar" ] && { echo "/nova desligado"; exit 0; }
if [ ! -s "$P/base/curvas_nova2026.json" ]; then echo "falta $P/base/curvas_nova2026.json (rode nova_preparar)"; exit 1; fi
sudo systemd-run --quiet --unit=projecao-nova --uid=ubuntu -p Restart=always -p RestartSec=10 \
  -p StandardOutput=append:$P/nova/nova.log -p StandardError=append:$P/nova/nova.log \
  /usr/bin/env node $P/nova/nova.js
sleep 3
systemctl is-active --quiet projecao-nova && echo "/nova ligado" || { echo "/nova não ligou"; exit 1; }
