# Histórico de versões

## 1.1.0

- **Interface em inglês e espanhol:** a barra (menus, definições, conversas, tokens, permissões) e as frases faladas («A ler config.ts», «Preciso da tua autorização»…) existem em português, inglês e espanhol.
- **Língua automática:** segue a língua do Windows (`idioma: "auto"`); muda-se no clique direito ou nas definições. Se não houver voz instalada para a língua escolhida, a barra oferece o download da voz recomendada (tugão, lessac, davefx).
- Os anúncios usam uma voz instalada na língua da interface, e o ditado transcreve nessa língua por omissão (`ditadoIdioma: "auto"`).

## 1.0.0

Primeira versão estável, pronta para quem a quiser instalar.

- **Aprovar permissões pela barra:** os pedidos de autorização aparecem num cartão com o comando exato e os botões *Permitir* / *Recusar*. Na app do Claude corre ao lado do diálogo normal (vale quem decidir primeiro).
- **Falar com o Claude:** botão 🎤 na barra e em cada conversa (ou `Ctrl+Shift+Alt+V`); grava, transcreve localmente com o Whisper e põe o texto na caixa de resposta para reveres. Instala-se com `/voz:instalar ouvir`.
- **Atalhos globais** `Ctrl+Shift+Alt` + `V` (falar), `P` (pausar), `N` (saltar), `C` (conversas), `D` (não incomodar).
- **Não incomodar:** botão na barra, no clique direito e no atalho, e horário de silêncio (ex.: 22:00 → 08:00). Sem voz nem avisos no ecrã.
- **Vozes e idiomas:** catálogo com as vozes Piper de 11 idiomas, download com verificação MD5, voz principal, voz e tom por conversa, e idioma automático (uma resposta em inglês usa a voz inglesa instalada). `/voz:vozes`.
- **Tokens do dia:** gráfico dos últimos 7 dias, totais de hoje e as conversas que mais gastaram (clica no anel do contexto).
- **Clique direito na barra:** conversas, som, tokens, não incomodar, posição, ecrã, aspeto, definições e fechar.
- **Vários monitores:** escolhe em que ecrã fica a barra.
- **Instalação mais fácil:** sem Python no sistema, o instalador usa o `uv` (traz o seu próprio Python); `/voz:instalar tudo`.
- **A barra recompila-se sozinha** quando uma atualização do plugin traz uma versão nova do anfitrião.
- Porta do servidor local livre automaticamente (47821 ou as seguintes), ícone do plugin, testes automáticos no GitHub (Windows, Linux, macOS).

## 0.4.x

- Conversas na barra: avatares animados, painel com a última mensagem e respostas diretas (gancho `asyncRewake`); aviso no canto quando uma conversa termina.
- Modo claro ao estilo macOS e botão Automático / Claro / Escuro.

## 0.3.x

- Barra do Windows ao estilo da barra de menus do macOS (seis posições, módulos, arranque com o Windows), botão «Testar a voz» e pronúncia «Cláude».

## 0.2.x

- Voz «tugão» mais calma; som afinável (volume, altura, equalizador, predefinições).

## 0.1.0

- Primeira versão: narração em português de Portugal, em tempo real, com o Piper.
