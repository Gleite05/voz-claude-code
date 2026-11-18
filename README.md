<p align="center"><img src=".claude-plugin/icon.png" width="96" alt=""></p>

<h1 align="center">Voz para o Claude Code</h1>

<p align="center"><a href="https://github.com/Gleite05/voz-claude-code/actions/workflows/testes.yml"><img src="https://github.com/Gleite05/voz-claude-code/actions/workflows/testes.yml/badge.svg" alt="Testes"></a> <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-blue" alt="MIT"></p>

<p align="center">
  <b>Português</b> · <a href="README.en.md">English</a> · <a href="README.es.md">Español</a>
</p>

<p align="center">O Claude Code a falar contigo em <b>português de Portugal</b>, em tempo real — e uma barra no topo do Windows, ao estilo do macOS, para veres e responderes a todas as conversas.<br>Gratuito, local e sem contas.</p>

<p align="center"><img src="docs/imagens/barra-escuro.png" alt="A barra no topo do ecrã"></p>

## O que faz

- 🏝️ **Ilha dinâmica** — uma cápsula de vidro no centro da barra mostra a ação, a legenda enquanto fala, os pedidos de autorização e quando uma conversa termina.
- 🗣️ **Diz o que o Claude está a fazer** — «A editar config.ts», «A correr o npm», «A ligar a um servidor remoto» — e **lê as respostas enquanto aparecem**, sem código, tabelas nem links.
- 💬 **Conversas na barra** — um avatar animado por conversa (a rodar = a trabalhar, a pulsar = precisa de ti), a última mensagem de cada uma e uma caixa para **responder diretamente**.
- 🛡️ **Aprovar permissões pela barra** — o pedido aparece num cartão com o comando exato: *Permitir* ou *Recusar*.
- 🎤 **Falar com o Claude** — dita a resposta; o Whisper transcreve no teu PC.
- 🌍 **Vozes de 11 idiomas** — instala mais vozes, escolhe uma voz e um tom para cada conversa, e as respostas noutro idioma usam a voz desse idioma.
- 🌐 **Interface em português, inglês e espanhol** — a barra e as frases faladas seguem a língua do Windows (ou a que escolheres no clique direito).
- 🌙 **Não incomodar** — um botão (ou um horário, ex.: 22:00 → 08:00) sem voz nem avisos.
- 📊 **Tokens do dia** — gráfico dos últimos 7 dias e as conversas que mais gastaram.
- 🎚️ **Som afinável** — volume, altura, equalizador e predefinições (natural, calma, clara, quente, rádio).

| Conversas | Pedido de autorização e tokens | Centro de Controlo |
| :-: | :-: | :-: |
| <img src="docs/imagens/conversas-escuro.png" width="260" alt="Painel de conversas"> | <img src="docs/imagens/permissao.png" width="300" alt="Pedido de autorização"><br><br><img src="docs/imagens/tokens.png" width="300" alt="Tokens do dia"> | <img src="docs/imagens/centro-controlo.png" width="250" alt="Centro de Controlo do som"> |

<p align="center"><img src="docs/imagens/barra-claro.png" alt="A barra em modo claro"></p>

| Modo claro | Clique direito |
| :-: | :-: |
| <img src="docs/imagens/conversas-claro.png" width="280" alt="Conversas em modo claro"> | <img src="docs/imagens/clique-direito.png" width="210" alt="Menu do clique direito"> |

## Instalar

Precisas do [Claude Code](https://code.claude.com) e do [Node.js 20+](https://nodejs.org). No terminal:

```bash
claude plugin marketplace add Gleite05/voz-claude-code
```

```bash
claude plugin install voz@voz
```

Reinicia o Claude Code e corre, dentro dele:

```
/voz:instalar tudo
```

Isto instala a **voz portuguesa** (Piper + «tugão»), o **ditado** (Whisper) e, no Windows, a **barra**. Se não tiveres Python, o instalador descarrega o [uv](https://github.com/astral-sh/uv), que traz o seu próprio Python. Também podes instalar por partes: `/voz:instalar voz`, `/voz:instalar ouvir`, `/voz:barra instalar`.

**Requisitos da barra:** Windows 10/11 com o WebView2 (já vem no Windows 11) e o .NET Framework 4.8 (vem no Windows). A barra é compilada no teu PC — não há executáveis neste repositório.

## Usar

**Na barra:** clica no nome da conversa, nos avatares, no anel do contexto (tokens) ou no ⚟ (som). **Clique direito** em qualquer ponto: conversas, som, tokens, não incomodar, **posição** (topo, escondida, flutuante, esquerda, direita, fundo), **ecrã**, aspeto, definições e fechar. Na estrela: definições completas (módulos visíveis e ordem, vozes, horário de silêncio, arranque com o Windows / só com o Claude Code / à mão).

**Atalhos** (em qualquer lado): `Ctrl+Shift+Alt` + `V` falar · `P` pausar · `N` saltar · `C` conversas · `D` não incomodar.

**Comandos:**

| Comando | O que faz |
| --- | --- |
| `/voz:estado` | Estado e opções |
| `/voz:ligar` · `/voz:desligar` · `/voz:parar` | Liga, desliga, cala agora |
| `/voz:silencio ligar\|desligar\|horario 22:00 08:00` | Não incomodar |
| `/voz:som [graves 3 \| altura -1 \| calma …]` | Afinar o som |
| `/voz:vozes [catalogo pt \| instalar <id> \| padrao <id>]` | Vozes e idiomas |
| `/voz:modo tudo\|acoes\|respostas` | O que é dito |
| `/voz:barra ligar\|desligar\|posicao …\|arranque …` | A barra |
| `/voz:testar [texto]` | Frase de teste |

As opções ficam em `~/.claude/voz/config.json` (ex.: `idioma` — `auto`, `pt`, `en` ou `es`; `pronuncias` para corrigir a pronúncia de palavras — «Claude» lê-se «Cláude»).

## Como funciona

- **Ganchos** do Claude Code (`PreToolUse`, `MessageDisplay` para o texto em tempo real, `Stop`, `Notification`, `PermissionRequest`) enviam os eventos para um **servidor local** (um por utilizador, por um pipe; arranca sozinho).
- O servidor decide o que dizer, sintetiza com o **Piper** (a frase seguinte prepara-se enquanto a atual toca) e serve a barra em `http://127.0.0.1:47821` (só local, com token).
- **Responder pela barra** usa um gancho `Stop` com `asyncRewake`: no fim de cada resposta fica à escuta e, quando escreves na barra, o Claude acorda com a tua mensagem. Na conversa, a tua resposta aparece como mensagem do gancho.
- **Permissões:** na app do Claude, o gancho corre ao lado do diálogo normal (vale quem decidir primeiro). No terminal não espera (para não atrasar o diálogo).
- **A barra** é um anfitrião pequeno em C# (`barra/anfitriao/VozBarra.cs`) com a WebView2, encaixado no ecrã como a barra de tarefas, com o vidro acrílico do Windows. Recompila-se sozinha quando o plugin atualiza.

## Privacidade e segurança

- Tudo corre no teu computador: **nenhum texto, áudio ou dado sai do PC**. Sem telemetria.
- Acessos à rede só nos instaladores: `piper-tts`, `faster-whisper` e `sounddevice` (PyPI), vozes (Hugging Face, `rhasspy/piper-voices`, MD5 verificado), modelo Whisper (Hugging Face), `uv` (GitHub, SHA-256 verificado) e o kit WebView2 (NuGet, SHA-512 verificado).
- O servidor local só aceita ligações de `127.0.0.1`, exige um token aleatório guardado na tua pasta de utilizador e verifica o cabeçalho `Host` (contra *DNS rebinding*).
- A barra lê do histórico local (`~/.claude/projects`) apenas o título das conversas e a contagem de tokens.

## Limites conhecidos

- A voz pt-PT é a melhor gratuita e local que existe hoje («tugão», Piper); não é tão natural como uma voz paga.
- A barra é só para Windows; a voz funciona em macOS e Linux mas está pouco testada.
- Cada conversa parada deixa um pequeno processo `node` à escuta de respostas (até 12 h).

## Desinstalar

```
/voz:barra desinstalar
```

```bash
claude plugin uninstall voz@voz
```

Depois apaga a pasta `~/.claude/voz` (vozes, Python, barra e configuração).

## Licença e créditos

- Este projeto: [MIT](LICENSE) © 2026 Gleite05.
- [Piper](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0), [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), [uv](https://github.com/astral-sh/uv) (MIT/Apache-2.0) e [WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) (Microsoft) — descarregados pelos instaladores, não incluídos neste repositório.
- Vozes do [piper-voices](https://huggingface.co/rhasspy/piper-voices) (cada voz tem a sua licença; a «tugão» usa dados CC0).
- Não é um produto oficial da Anthropic.
