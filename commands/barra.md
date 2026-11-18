---
description: Barra superior do Windows ao estilo macOS — instalar, ligar, desligar, posição, arranque
argument-hint: "[instalar|ligar|desligar|posicao <topo|escondida|flutuante|esquerda|direita|fundo>|arranque <windows|claude|mao>|desinstalar]"
allowed-tools: Bash(node:*)
---
Corre este comando com a ferramenta Bash (com um timeout de 300000 ms, porque a instalação descarrega e compila) e depois responde ao utilizador em português de Portugal, numa ou duas frases, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" barra $ARGUMENTS
```
