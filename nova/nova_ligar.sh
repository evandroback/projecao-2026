#!/usr/bin/env bash
# Liga (ou religa) o processo do modelo novo do /nova e o gravador da noite. Não toca no coletor principal nem no TSE.
#   nova_ligar.sh            liga o /nova (lendo /opt/projecao/saida) e (re)liga o gravador da noite
#   nova_ligar.sh desligar   desliga só o /nova (o gravador da noite continua e para sozinho na segunda, 6h)
set -uo pipefail
P=/opt/projecao
sudo systemctl stop projecao-nova 2>/dev/null || true
sudo systemctl reset-failed projecao-nova 2>/dev/null || true
[ "${1:-}" = "desligar" ] && { echo "/nova desligado"; exit 0; }
if [ ! -s "$P/base/curvas_nova2026.json" ]; then echo "falta $P/base/curvas_nova2026.json (rode nova_preparar)"; exit 1; fi
sudo systemd-run --quiet --unit=projecao-nova --uid=ubuntu -p Restart=always -p RestartSec=10 \
  -p StandardOutput=append:$P/nova/nova.log -p StandardError=append:$P/nova/nova.log \
  /usr/bin/env node $P/nova/nova.js
# gravador da noite (fotos para a análise de segunda): religa; ao voltar, continua do índice que já existe
if [ -s "$P/nova/gravar_noite.js" ]; then
  sudo systemctl stop projecao-noite 2>/dev/null || true
  sudo systemctl reset-failed projecao-noite 2>/dev/null || true
  sudo systemd-run --quiet --unit=projecao-noite --uid=ubuntu -p Restart=on-failure -p RestartSec=10 \
    -p StandardOutput=append:$P/nova/noite.log -p StandardError=append:$P/nova/noite.log \
    /usr/bin/env node $P/nova/gravar_noite.js
fi
sleep 3
systemctl is-active --quiet projecao-noite && echo "gravador da noite ligado" || echo "gravador da noite NÃO ligou"
systemctl is-active --quiet projecao-nova && echo "/nova ligado" || { echo "/nova não ligou"; exit 1; }
