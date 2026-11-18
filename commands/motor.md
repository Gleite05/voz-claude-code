---
description: Escolhe o motor de voz: auto, piper ou sistema
argument-hint: "<auto|piper|sistema>"
allowed-tools: Bash(node:*)
---
Corre exatamente este comando com a ferramenta Bash (sem mais nada) e depois responde ao utilizador numa frase curta, em português de Portugal, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" motor $ARGUMENTS
```
