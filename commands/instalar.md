---
description: Instala a voz neural pt-PT (voz), o ditado para falares com o Claude (ouvir), a barra do Windows (barra) ou tudo
argument-hint: "[voz|ouvir|barra|tudo]"
allowed-tools: Bash(node:*)
---
Corre este comando com a ferramenta Bash, com um timeout de 600000 ms (a instalação pode demorar alguns minutos):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" instalar $ARGUMENTS
```

Depois explica ao utilizador, em português de Portugal e em poucas frases, o resultado. Se falhar por falta de Python, diz-lhe que instale o Python 3.9 ou mais recente (https://www.python.org/downloads/) e volte a correr /voz:instalar; até lá a voz usa a voz do sistema.
