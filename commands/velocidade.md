---
description: Muda a velocidade da voz (0.5 a 2.0)
argument-hint: "<0.5-2.0>"
allowed-tools: Bash(node:*)
---
Corre exatamente este comando com a ferramenta Bash (sem mais nada) e depois responde ao utilizador numa frase curta, em português de Portugal, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" velocidade $ARGUMENTS
```
