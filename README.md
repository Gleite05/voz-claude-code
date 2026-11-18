# Voz para o Claude Code 🔊🇵🇹

Um plugin para o [Claude Code](https://code.claude.com) que **narra em voz alta, em português de Portugal e em tempo real**, o que o Claude está a fazer e o que te está a escrever:

- 🛠️ **O que está a fazer**: «A editar config.ts», «A usar o git», «A ligar a um servidor remoto», «A pesquisar na internet»…
- 💬 **O que escreve**: lê as respostas **enquanto vão aparecendo no ecrã**, sem blocos de código, tabelas, links nem caminhos compridos.
- 🔔 **Quando precisa de ti**: «Preciso da tua autorização», «Tenho uma pergunta para ti», «O plano está pronto para aprovares».
- 🗂️ **Várias sessões**: só a sessão onde escreveste por último fala tudo; as outras dizem apenas «A sessão de *pasta* terminou».
- 🎚️ **Som afinável**: volume, altura (tom), equalizador de graves/médios/agudos e predefinições (natural, calma, clara, quente, rádio).
- 🖥️ **Barra no Windows** ao estilo da barra de menus do macOS: a sessão, o que está a fazer, a legenda do que diz, as outras sessões, o contexto e um Centro de Controlo do som.

**Gratuito e 100 % local.** Não precisa de conta, chave de API nem internet (só para instalar a voz uma vez). Nada do que o Claude escreve sai do teu computador.

## Instalar

No terminal (ou na caixa de mensagens do Claude Code, com `/plugin …`):

```bash
claude plugin marketplace add Gleite05/voz-claude-code
```

```bash
claude plugin install voz@voz
```

Reinicia o Claude Code (ou corre `/reload-plugins`). A partir daí já fala com a voz do sistema.

Para a **voz natural em português de Portugal** (recomendado), corre uma vez dentro do Claude Code:

```
/voz:instalar
```

Isto cria um ambiente Python isolado em `~/.claude/voz/python`, instala o [Piper](https://github.com/OHF-Voice/piper1-gpl) e descarrega a voz «tugão» (pt-PT, ~63 MB), com verificação SHA-256. Demora um ou dois minutos.

### Requisitos

- **Claude Code** recente (o tempo real usa o evento `MessageDisplay`; em versões sem ele, a voz lê a resposta final de uma vez).
- **Node.js 18+** no `PATH` (é o que corre os ganchos).
- Para a voz pt-PT natural: **Python 3.9+**. Sem Python, usa a voz do sistema:
  - **Windows**: SAPI. Para ter uma voz pt-PT do sistema, instala a «Helia» em *Definições → Hora e idioma → Voz → Adicionar vozes → Português (Portugal)*.
  - **macOS**: `say` (escolhe sozinho a «Joana» se existir).
  - **Linux**: `espeak-ng` (`sudo apt install espeak-ng`), e `paplay`/`aplay` para o Piper.

Testado em **Windows 11** (terminal e app de ambiente de trabalho do Claude). macOS e Linux estão implementados mas pouco testados.

## Comandos

| Comando | O que faz |
| --- | --- |
| `/voz:estado` | Diz se está ligada, que voz usa e as opções |
| `/voz:ligar` / `/voz:desligar` | Liga ou desliga em todas as sessões |
| `/voz:parar` | Cala a voz agora (continua ligada). Escrever uma mensagem nova também a cala |
| `/voz:testar [texto]` | Diz uma frase de teste |
| `/voz:velocidade 0.9` | Velocidade de 0.5 a 2.0 (predefinição 0.88, calma) |
| `/voz:som` | Mostra o som; `/voz:som graves 3`, `altura -1`, `volume 0.8`, ou uma predefinição: `/voz:som calma` |
| `/voz:barra instalar` | Instala e abre a barra do Windows (ver abaixo) |
| `/voz:barra ligar|desligar` | Abre ou fecha a barra |
| `/voz:barra posicao …` | `topo`, `escondida`, `flutuante`, `esquerda`, `direita` ou `fundo` |
| `/voz:barra arranque …` | `windows` (com o Windows), `claude` (só com o Claude Code) ou `mao` (só à mão) |
| `/voz:modo tudo\|acoes\|respostas` | Tudo, só o que está a fazer, ou só o que escreve |
| `/voz:sessao ativa\|todas` | Só a sessão ativa fala tudo (predefinição), ou todas |
| `/voz:motor auto\|piper\|sistema` | Força a voz do sistema ou o Piper |
| `/voz:instalar` | Instala a voz neural pt-PT |

Fora do Claude Code: `node <pasta-do-plugin>/scripts/voz.js estado` (e os mesmos subcomandos).

As opções ficam em `~/.claude/voz/config.json`:

```json
{
  "ligado": true,
  "anunciarAcoes": true,
  "lerRespostas": true,
  "velocidade": 0.88,
  "ruido": 0.4,
  "ruidoDuracao": 0.5,
  "volume": 1.0,
  "altura": 0,
  "graves": 0,
  "medios": 0,
  "agudos": 0,
  "maxCaracteres": 1200,
  "soSessaoAtiva": true,
  "avisarOutrasSessoes": true,
  "motor": "auto",
  "vozSistema": "",
  "pronuncias": { "Claude": "Cláude" }
}
```

`ruido` e `ruidoDuracao` afinam o Piper (valores mais baixos = voz mais estável e menos metálica). `maxCaracteres` é o máximo lido por mensagem (o resto fica só no ecrã). `vozSistema` escolhe uma voz do sistema pelo nome (por exemplo `"Helia"`). `pronuncias` diz como ler certas palavras (só no áudio; a legenda mantém o original) — por omissão «Claude» lê-se «Cláude».

## A barra (Windows)

```
/voz:barra instalar
```

Uma barra fina e translúcida, ao estilo da barra de menus do macOS:

- **À esquerda:** ✻ **Claude** · a sessão (clica para ver todas, a legenda e os tokens) · o que está a fazer agora · a legenda do que está a dizer.
- **À direita:** a onda (quando fala; clica para saltar a frase) · pontos das outras sessões (verde a trabalhar, amarelo precisa de ti, cinza parada) · anel do contexto usado · ⚟ Centro de Controlo do som · tempo do pedido.
- **Clicar na estrela:** posição (topo, escondida, flutuante, esquerda, direita, fundo por cima da barra do Windows), módulos visíveis (liga, desliga e arrasta para ordenar), arranque e tema (segue o Windows, escuro ou claro).

Como é feita: um anfitrião pequeno em C# (`barra/anfitriao/VozBarra.cs`) compilado no teu PC pelo `csc.exe` que já vem com o .NET Framework 4.8, com a WebView2 do Windows 11 a desenhar a interface (`barra/`). Encaixa no ecrã como a barra de tarefas (as janelas maximizadas não a tapam) e usa o desfoque acrílico do Windows. O instalador só descarrega o kit WebView2 do NuGet da Microsoft (~9 MB, SHA-512 verificado). Se o vidro der problemas, cria o ficheiro vazio `~/.claude/voz/barra/sem-vidro` para um fundo opaco.

A interface fala com o servidor da voz em `http://127.0.0.1:47821` (só local, com token). O arranque «com o Windows» usa uma entrada em `HKCU…Run` (sem administrador); `/voz:barra arranque mao` remove-a.

## Como funciona

```
Claude Code ──(ganchos: PreToolUse, MessageDisplay, Stop, Notification…)──▶ gancho.js
                                                                              │ pipe local
                                                                              ▼
                                     servidor.js (um por utilizador, arranca sozinho, sai após 10 min parado)
                                       • decide o que dizer (português, sem código nem tabelas)
                                       • uma voz de cada vez; anúncios velhos ou repetidos são saltados
                                       • sintetiza a frase seguinte enquanto a atual toca
                                                                              │
                                                     Piper «tugão» (Python)  ou  voz do sistema
```

- Os ganchos são **assíncronos**: nunca atrasam o Claude nem o ecrã.
- O texto é lido a partir do evento `MessageDisplay`, que recebe as linhas à medida que são mostradas.
- Nas sessões sem ninguém a ver (tarefas agendadas) fica calado. Define `VOZ_SILENCIO=1` para calar uma sessão em particular.
- Os subagentes não falam (só a sessão principal).

## Privacidade

Tudo corre no teu computador. Os únicos acessos à rede são o `/voz:instalar`, que descarrega o `piper-tts` do PyPI e a voz do Hugging Face (`rhasspy/piper-voices`), e o `/voz:barra instalar`, que descarrega o kit WebView2 do NuGet. Não há telemetria. A barra lê do histórico local das sessões (`~/.claude/projects`) só o modelo e a contagem de tokens.

## Desinstalar

```bash
claude plugin uninstall voz@voz
```

Antes, se instalaste a barra: `/voz:barra desinstalar`. Depois apaga a pasta `~/.claude/voz` (voz, Python, barra e configuração).

## Créditos e licenças

- Este plugin: [MIT](LICENSE).
- [Piper](https://github.com/OHF-Voice/piper1-gpl) (GPL-3.0), instalado à parte pelo `/voz:instalar`, não incluído neste repositório.
- [WebView2](https://www.nuget.org/packages/Microsoft.Web.WebView2) (Microsoft), descarregado pelo `/voz:barra instalar`, não incluído neste repositório.
- Voz [«tugão»](https://huggingface.co/rhasspy/piper-voices/tree/main/pt/pt_PT/tug%C3%A3o/medium) (dados CC0).
