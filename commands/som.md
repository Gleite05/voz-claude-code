---
description: Afina o som da voz — volume, altura, graves/médios/agudos ou uma predefinição (natural, calma, clara, quente, radio)
argument-hint: "[volume|altura|graves|medios|agudos <valor>] ou [natural|calma|clara|quente|radio]"
allowed-tools: Bash(node:*)
---
Corre exatamente este comando com a ferramenta Bash (sem mais nada) e depois responde ao utilizador numa frase curta, em português de Portugal, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" som $ARGUMENTS
```
