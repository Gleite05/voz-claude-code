---
description: Não incomodar — sem voz nem avisos no ecrã (ligar, desligar ou horário de silêncio)
argument-hint: "[ligar|desligar|horario 22:00 08:00|horario desligar]"
allowed-tools: Bash(node:*)
---
Corre exatamente este comando com a ferramenta Bash e responde ao utilizador numa frase curta, em português de Portugal, com o que o comando escreveu:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" silencio $ARGUMENTS
```
