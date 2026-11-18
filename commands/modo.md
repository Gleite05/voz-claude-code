---
description: Escolhe o que é dito: tudo, acoes (o que está a fazer) ou respostas (o que escreve)
argument-hint: "<tudo|acoes|respostas>"
allowed-tools: Bash(node:*)
---
Corre exatamente este comando com a ferramenta Bash (sem mais nada) e depois responde ao utilizador numa frase curta, em português de Portugal, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" modo $ARGUMENTS
```
