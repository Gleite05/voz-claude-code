---
description: Vozes — lista, catálogo (vários idiomas), instalar, remover, escolher a principal, uma voz por conversa
argument-hint: "[catalogo [língua]|instalar <id>|remover <id>|padrao <id>|conversas auto|igual]"
allowed-tools: Bash(node:*)
---
Corre este comando com a ferramenta Bash (timeout de 600000 ms, porque instalar descarrega a voz) e depois responde ao utilizador em português de Portugal com o que o comando escreveu (resume listas longas):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/voz.js" vozes $ARGUMENTS
```
