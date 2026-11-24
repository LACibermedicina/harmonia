# Changelog — harmonIA

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · Versionamento: [SemVer](https://semver.org/lang/pt-BR/).

## [0.10.0-alpha] — 2026-11-24

### Corrigido — leitura de fotos de partitura
- O erro “Arquivo não encontrado no servidor” vinha do programa de OMR (oemer) **não instalado no modo leve** — não era o arquivo. Agora a foto é lida por **IA com visão** (Gemini, OpenAI, Claude, GitHub Models, OpenRouter, Groq, Pollinations… com failover), que devolve notas, durações (inclusive pontuadas e ligaduras), letra, armadura e cifras; a revisão sobreposta continua antes de juntar. Com o OMR completo instalado, ele é usado primeiro e a IA entra se falhar.

### Adicionado — entrada única
- **“Solte aqui qualquer entrada”** no Importar: áudio/vídeo, foto/scan da partitura, cifra (.txt/ChordPro) ou texto/imagem colado (⌘V). O tipo é reconhecido e a edição certa abre com o conteúdo.

### Adicionado — gravação pelo microfone muito mais precisa
- **Gravar** (novo nome/ícone do antigo “Ao vivo”), com escolha: **automático** (reconhece sozinho se é uma nota ou várias), **uma por vez** ou **várias (acordes)**; **duas mãos** (graves na pauta de Fá, divisão acompanhando o que é tocado) ou uma pauta.
- Notas com a **duração real**, inclusive **pontuadas** (0,75 · 1,5 · 3 tempos) e longas; reataque separa notas repetidas.
- **Limpeza de ruído** por faixa de frequência (piso de ruído adaptativo + filtro de graves), sem a supressão do navegador que cortava notas longas; o som do próprio app continua ignorado.
- **Afinar na tonalidade** (nota desafinada vai para a nota da escala mais próxima) e **harmonizar o que foi gravado** (cifras sugeridas nos compassos sem acorde; Ctrl+Z desfaz).
- **Timbre**: a família do instrumento (voz, cordas de arco, flauta, palheta, metais, dedilhado, piano) é estimada e aparece na pauta e no afinador.
- **🎼 Orquestra**: vários instrumentos ao mesmo tempo — cada timbre reconhecido vai para uma camada própria, com o instrumento estimado. Vale também ao **transcrever um áudio** (opções “Notas: várias” e “Orquestra” no Importar).

### Adicionado — modo Aprender (gamificado)
- **Execução**: tocar a partitura pelo microfone, teclado MIDI ou teclado do computador — “Esperar por mim” (só avança quando acerta) ou no tempo (Perfeito / Bom / no limite / faltou), com pontos, combo, precisão, estrelas, XP e medalhas; notas ficam azuis (próxima), verdes (certas) ou vermelhas na pauta.
- **Composição**: 11 desafios conferidos automaticamente (compasso completo, pontuada, motivo, pergunta-resposta, terminar na tônica, I–IV–V, cadência autêntica, 2 instrumentos, duas mãos, gravar, ornamentar).

### Adicionado — visualização e compassos
- **Vertical (quebra em linhas)** ou **horizontal contínua**; a vista acompanha o leitor.
- **Compassos**: repetir os atuais ao gravar, **infinitos** (a pauta cresce enquanto você grava) ou **limite de N compassos**.
- Painéis em acordeão: abrir um recolhe os outros.

## [0.9.0-alpha] — 2026-11-23

### Alterado — a Composição é o centro do app
- O antigo pentagrama do desktop foi **removido**: as funções dele (tocar, ao vivo, teclado, afinador, selecionar/apagar/limpar, desfazer) já vivem na **Composição**, que agora abre sozinha no centro, como palco, entre os ícones do desktop (Nova composição e **Projetos salvos**, à esquerda) e as **abas verticais coloridas** dos painéis (à direita), seguindo as referências visuais.
- **Barra de estudo** no rodapé da Composição: Microfone · Transcrever · Multi-instrumentos · Arpejos · Solo/Ornamentos · Harmonizar · IA Assistente.

### Adicionado — painel “Estudo” (cada seção explica “Como funciona”)
- **Multi-instrumentos**: cada camada com o seu instrumento (timbre e extensão), volume e liga/desliga ao vivo; **adicionar instrumento** como melodia (transposta para a região confortável), contracanto (terça/sexta diatônica), baixo, acordes ou arpejo.
- **Instrumento em foco** para o aprofundamento: **estudo de arpejos** sobre a harmonia (ascendente, descendente, sobe-e-desce, Alberti, quebrado; semínimas a semicolcheias; 1–2 oitavas), **proposta de solo** que reaproveita o **motivo rítmico** do tema (notas do acorde nos tempos fortes, escala nos fracos, respiração e resolução no fim das frases; “↻ Outra” troca a proposta) e **ornamentos** do tema (mordente, trilo, grupeto, apojatura, notas de passagem, com intensidade).
- **Análise do tema principal**: tonalidade (Krumhansl), **motivo rítmico** (assinatura de ataques mais repetida), **módulos temáticos** A / A' / B por ritmo + contorno, **harmonização recomendada** (I–IV–V, dominante antes das cadências) e cadências; pode ser **mostrada na partitura** (colchetes “Módulo temático (A)”, “Motivo rítmico” e cifras sugeridas em itálico) e aplicada às cifras.
- **Assistente 3D (Maestro) explica a teoria do tema**: tonalidade, extensão, motivo, forma, harmonia, cadências e sugestões de estudo — na hora, inclusive sem conta; com conta, a pergunta livre vai à IA junto com a análise.
- Tudo o que o Estudo gera entra como **camada nova no grupo 🎓 Estudo**, com o timbre do instrumento; o original não muda e Ctrl+Z desfaz.

## [0.8.5-alpha] — 2026-11-23

### Adicionado — pasta "Projetos salvos" no desktop
- Ícone de **pasta “Projetos salvos”** no desktop (ao lado de Nova composição), com contador. Abre uma janela tipo Finder com **todos os projetos salvos** como ícones de arquivo: nome, quando foi salvo, nº de compassos, ☁ conta ou 💻 navegador e selo “aberto” no projeto em edição.
- Duplo clique abre o projeto na Composição; botões ao passar o mouse: abrir, **renomear** (F2), **duplicar**, **excluir** (2 cliques). Busca e ordenação (recentes / nome).
- **Salvar ⌘S** (e Arquivo → Salvar / Projetos salvos…), “Salvar a composição aberta” e “Salvar como novo” dentro da pasta. Com conta, salva na nuvem; sem conta ou offline, salva neste navegador — e o autosave mantém os dois atualizados.
- A Biblioteca usa o mesmo salvamento (o que é salvo lá aparece na pasta).

## [0.8.4-alpha] — 2026-11-23

### Adicionado — guia do leitor e contagem do ao vivo
- **Guia do leitor**: durante qualquer reprodução da partitura (editor, pentagrama do desktop, ao vivo, player universal) o **compasso em execução fica destacado**, com barra de progresso no número do compasso, linha com marcador ▼ na posição exata e rótulo “c.3 · 2” (compasso · tempo).
- **Cursor de leitura**: ao parar, fica uma linha tracejada roxa “cursor · c.N” onde a leitura parou (ou no compasso selecionado); terminar a música volta o cursor ao início.
- **Ao vivo com escolha e contagem**: ao clicar em Ao vivo aparece “⏮ Do início” ou “⏯ Do cursor (compasso N)” e a opção **contagem de 1 compasso** (lembrada). A contagem mostra números grandes 4-3-2-1 com cliques (o 1º acentuado), pode ser cancelada (Esc) e o microfone é aberto antes dela; o loop do ao vivo recomeça sempre do compasso de partida.

## [0.8.3-alpha] — 2026-11-23

### Adicionado — gravações e camadas
- **Compassos até o fim da gravação**: toda gravação (importada, solta na pauta, gravada no editor) estende a partitura até o último compasso do áudio; os compassos ficam **vinculados 🔗** à gravação e às camadas de notas transcritas dela (inclusive no Importar: original + melodia + harmonia já saem vinculadas).
- **Mostrar/ocultar junto**: ocultar a gravação (ou qualquer camada vinculada) oculta a gravação e as notas dela de uma vez, no painel de Camadas e na legenda; desvincule ⛓ para ocultar só uma.
- **Cor de cada camada sobre os compassos** que ela ocupa, em sobreposição (camadas no mesmo compasso misturam as cores) + faixa colorida dividida no número do compasso. Liga/desliga em Pauta → “Colorir compassos pela cor de cada camada”.

### Adicionado — pauta principal (desktop)
- Selecionar e apagar direto no pentagrama do desktop: clique na nota (⇧ soma), clique no compasso, **⬚ Tudo**, **⌫ Apagar**, **🗑 Limpar pauta** (2 cliques), **↶ desfazer / ↷ refazer**, e os atalhos Ctrl+A, Delete, Ctrl+Z, Esc. As cores das camadas também aparecem ali.

### Adicionado — painéis e chamada
- **Painéis como abas verticais**: com o dock recolhido, cada painel vira uma aba vertical (ícone + nome); **passar o mouse abre o painel ao lado**, sair fecha, clicar fixa no dock.
- **Iconizar painel** (botão ▭ no cabeçalho): o painel sai da pilha e vira aba vertical na borda do dock, abrindo ao passar o mouse.
- **Chamada minimizada estilo Zoom**: em videochamada, quando o painel da Comunidade não está à vista, aparece um quadro flutuante com os participantes, sua câmera no canto, tempo de chamada e botões microfone, câmera, abrir e desligar; arrastável e recolhível em ícone redondo.

### Corrigido
- Botão “Transcrever” ficava preso com o texto de progresso depois de terminar.
- Janelas ficam abaixo do dock de painéis (abas e painéis abertos por cima da partitura).

## [0.8.2-alpha] — 2026-11-23

### Corrigido — áudio → notas funciona sempre
- **Novo motor de transcrição no servidor: audio2score** (incorporado ao ai-worker, só numpy + scipy): altura por YIN, separação de sílabas, ornamentos (deslize, queda, vibrato, apojaturas presas à nota), andamento por ataques, tom por Krumhansl-Kessler e acordes por Viterbi com progressões funcionais. O YIN antigo fica como reserva automática.
- **Transcrição no próprio navegador** quando o servidor não pode atender: o processador de IA não responde (a tarefa desiste em ~8 s em vez de ficar 20 min na fila), o envio falha ou não há fila. O resultado chega igual (melodia, tom, acordes e acompanhamento) e a central de tarefas mostra “Concluído (no navegador)”.
- Vale para todas as entradas: Importar (arquivo/trecho), trecho arrastado para a pauta, “Transcrever gravação” (toda ou só o compasso) e voz gravada no editor.

### Adicionado — edição
- **Selecionar tudo · Excluir seleção · Excluir tudo** no topo da partitura e no grupo Editar. Excluir seleção apaga as notas marcadas ou, com compassos marcados, o conteúdo deles (notas e cifras). Excluir tudo pede 2 cliques; camadas com 🔒 são preservadas; Ctrl+Z desfaz.
- Delete/Backspace também apaga o conteúdo dos compassos selecionados.

### Adicionado — captura em tempo real
- Cada captura pelo microfone/MIDI (Ao vivo, Capturar notas) cria uma **camada nova “🎤 Captura em tempo real N · hh:mm”**, com **cor própria (turquesa)**, selo **● GRAVANDO AO VIVO** no painel de Camadas e notas com brilho.
- **Retorno visual instantâneo** na pauta: cursor da captura, medidor de nível e a **nota que está soando cresce na pauta** com o nome (ex.: “🎤 Lá4 · ao vivo · 12 notas”) antes de ser gravada.
- A captura **ignora o som que a própria plataforma toca** (loop do ao vivo): compara os harmônicos da nota ouvida com a saída do motor de áudio.

### Adicionado — afinador
- **🎚 Afinador** flutuante (topo da partitura, pentagrama do desktop ou tecla **T**): nota (C–B e dó–si), oitava, frequência, ponteiro de **cents** (verde = afinado), nível de entrada, Lá de referência ajustável (415–466 Hz). Arrastável, recolhível e ocultável; abre junto com a captura ao vivo até você ocultá-lo.
- Analisa **só o que entra no microfone**, mesmo com a partitura tocando: cancelamento de eco + **subtração espectral da saída do sistema** (referência interna, com compensação do atraso da caixa) e altura pela soma harmônica do resíduo. Mostra o **perfil de timbre** (8 harmônicos, centróide) e avisa quando o que entra se parece com o som do sistema.

## [0.8.1-alpha] — 2026-11-23

### Adicionado — compor ao vivo
- **● Ao vivo** no pentagrama do desktop, no topo da partitura e na barra do teclado: a partitura toca **em loop com metrônomo** e o que você toca é escrito **na hora, na posição da reprodução**, na camada "Ao vivo" (as notas já soam na próxima volta).
  - Entrada: **instrumento externo** pelo microfone (detecção da altura no navegador), **teclado MIDI** (Web MIDI) ou o **teclado da tela** / teclado do computador.
  - A nota ouvida do instrumento externo **acende em verde** no teclado 3D, junto com as notas que já estão na pauta; o cursor corre no pentagrama do desktop.
  - O player universal mostra "Compor ao vivo"; parar no player encerra o ao vivo.
- **Teclado no pentagrama do desktop** (🎹 Teclado): o instrumento 3D aparece sob a pauta inicial; no modo Criar, tocar acrescenta notas à melodia.

### Alterado — interface harmonizada
- Botões com **ícones 3D do mesmo estilo** em todo o app (pentagrama do desktop: Ao vivo, Tocar, Teclado, Editar; Importar: Arquivo e Transcrever; Exportar; Ao vivo no editor), mesmo raio, altura e espaçamento; quadros, painéis e menus com cantos e sombras padronizados.
- Pentagrama do desktop com o ícone da composição e destaque vermelho quando está ao vivo.

## [0.8.0-alpha] — 2026-11-22

### Adicionado
- **🎤 Capturar notas** (no lugar de "Gravar ao vivo"): cante ou toque e a **pauta é escrita em tempo real**, no andamento da partitura, a partir do compasso selecionado (conta 1 compasso, metrônomo). Microfone com detecção de altura no navegador ou **teclado MIDI** (Web MIDI), com intensidade. Indicador ao vivo da nota ouvida.
- **Visualizador do instrumento como subfunção da pauta** (botão **Teclado** em Ajustar): teclado ou braço do instrumento em 3D cartunesco sob a partitura.
  - 👁 **Mostrar**: acende as notas que soam (ou as selecionadas) com **nome da nota**, **intensidade** (barra + p/mp/mf/f/ff) e **pedal de sustentação** no piano.
  - ✎ **Criar**: tocar nas teclas/casas escreve a nota na pauta, em sequência, com a duração escolhida; a altura do toque define a intensidade; teclado do computador (A W S E D F T G Y H U J K).
  - Instrumento do mostrador escolhível: piano/órgão/harpa (teclado com pedais no piano), violão/guitarra/baixo (braço com casas) e cordas (espelho sem trastes); o som da prévia acompanha o instrumento.
- **Importar ao lado da pauta**: o Importar abre no painel lateral (que se alarga), junto da partitura.
- **Trechos marcados**: ✂ guarda a seleção da onda como trecho (T1, T2…), com ▶ ouvir, ◎ selecionar e ✕ remover. **Arraste qualquer trecho (ou o ✂) e solte na pauta** no compasso desejado — isso basta para importar: vira gravação 🎙 + notas transcritas e vinculadas 🔗. Dá para importar partes diferentes em lugares diferentes.
- **Revisão da leitura de imagem (OMR)** antes de ir para a pauta: a leitura aparece **sobreposta à imagem** (com transparência ajustável) e em cartões por compasso; corrija altura (▲▼), **acidentes (♯ ♭ ♮)**, apague notas, ouça cada compasso e **escolha só os compassos de interesse**; eles entram a partir do compasso selecionado na pauta.
- **⏹ Cancelar transcrição** no ícone de tarefas: cancela o envio, tira da fila ou para o processamento na próxima etapa.
- **Barra superior**: menu do **usuário** (dados da conta, privacidade/LGPD, minhas composições, administração, sair) e ícone discreto de **comunidade** com seu **estado** (🟢 online / 🌙 ausente / 👻 invisível), **quem está online** (e quem está em 📹), **chat** e **videochamada**. Conta e Comunidade saíram do Dock.

### Alterado
- A Composição abre **maximizada**; a barra de ferramentas começa **aderida à lateral** da pauta.
- Arquivos de **vídeo** (MP4, MOV, WebM) podem ser importados — o áudio é extraído no navegador.

### Corrigido
- "Falha no envio" de áudio/vídeo (ex.: A_Equação_da_Aurora.mp4): mesma causa da 0.7.2 (permissão de `data/media` na VPS), já corrigida no deploy; os formatos de vídeo também passaram a ser aceitos pelo servidor.

## [0.7.2-alpha] — 2026-11-22

### Corrigido — envio de arquivos ("Falha no envio")
- **Causa**: a pasta de mídia da VPS (`data/media`) pertencia ao root e os containers rodam como usuário 10001 — todo envio de áudio/imagem terminava em "Internal Server Error". O deploy agora ajusta a permissão de `data/media` e `data/models` a cada atualização.
- `/api/health` informa `storage` (se a mídia aceita gravação) e o administrador recebe aviso quando não aceita.
- Erros do servidor voltam sempre em JSON legível; falha ao gravar devolve 507 com explicação; fila de IA fora do ar devolve 503 com explicação.
- No navegador, falhas de envio mostram o motivo pelo código (sessão expirada, arquivo grande, formato, servidor reiniciando…) em vez de "Falha no envio". Após o envio, a tarefa passa corretamente para "Na fila".

### Alterado — barra de ferramentas
- Ferramentas **agrupadas** com títulos discretos: **Criar** (Gravar, Importar) · **Escrever** (Mover, Nota, Apagar, Cifra, Letra, Nota+) · **Ajustar** (Duração, Ouvir, Pauta, Editar) · **IA** (Harmonia), com ícones 3D menores e animação suave.
- **Dicas flutuantes** novas em todo o app: ficam por cima de tudo (nunca cortadas pela janela ou pelo painel), ao lado das barras laterais, dentro da tela, com título em destaque e seta; também aparecem ao navegar pelo teclado.

## [0.7.1-alpha] — 2026-11-22

### Adicionado — transcrições com feedback e % de evolução
- **Ícone de tarefas de IA** (canto inferior esquerdo): anel de progresso animado com **% no centro** e personagem 3D da etapa. Clique para o **detalhamento do processo**: etapas concluídas ✓, etapa atual com detalhe ao vivo (ex.: "42 notas ouvidas", "♩ = 96"), próximas etapas, tempo decorrido e **estimativa do que falta**. Várias tarefas ao mesmo tempo, com contador.
- Etapas reais informadas pelo processador de IA:
  - áudio (modo leve): preparar áudio → andamento e pulso → ouvir a melodia → encaixar o ritmo → acordes → montar camadas;
  - áudio (IA completa): + separar voz e instrumentos, polifonia, voz e letra cantada;
  - imagem: preparar → ler símbolos → converter em notas → acordes; exportação: preparar → gerar arquivos → finalizar.
- **Envio com %** (o upload também aparece como etapa) e **posição na fila**; se o processador de IA estiver parado, a tarefa avisa em vez de esperar em silêncio.
- **Resumo ao terminar**: notas, camadas, andamento, tonalidade, compassos e modo (leve/completo), com **Ver resultado**. Em caso de erro, mensagem clara (arquivo ilegível, sem memória, arquivo ausente…) e **↻ Tentar de novo**.
- Os botões ✨ Transcrever / Ler partitura / Exportar mostram a etapa e o % enquanto trabalham.

### Corrigido
- Transcrições que ficavam "Na fila…" sem retorno quando o processador de IA estava parado: agora há aviso e notificação.
- Erros técnicos do processador viram mensagens compreensíveis.

## [0.7.0-alpha] — 2026-11-22

### Alterado — interface enxuta, sem controles repetidos
- **Um lançador só**: o menu lateral esquerdo (que repetia o Dock) saiu; o Dock abre todos os quadros. No desktop fica só o ícone **Nova composição** (Importar, Biblioteca etc. estão no Dock).
- **Um transporte só**: tocar/pausar/parar ficam no **player universal** (e o ▶ do topo da partitura). Saíram os botões repetidos de tocar da Mesa, do grupo "Ouvir" (que ficou com metrônomo, loop e andamento) e do "＋ Nova" do pentagrama do desktop.
- **Uma mesa só**: volume, mudo e solo das camadas ficam na **🎚 Mesa de som** (Propriedades). O painel de Camadas ficou com o essencial — cor, nome, 👁, 🔗 vínculo, 🔒 cadeado e ⋯. A antiga "Mesa de Edição" virou **Exportar** (MIDI, MusicXML, PDF, WAV, MP3).
- **Uma gravação só**: o ● Gravar fixo decide sozinho (com compassos selecionados grava o trecho; sem seleção, uma nova voz). O grupo "Gravação" repetido saiu.
- **Dados da partitura num lugar só**: título no cabeçalho; tonalidade, compasso, pautas e claves no quadro **Pauta**. A seção "Partitura" repetida saiu de Propriedades, assim como o "⟲ Do zero" (use Nova composição) e os botões de copiar/recortar repetidos (ficam na barra de seleção da partitura e em ⌘⇧C / ⌘⇧X).
- Barra de ferramentas mais compacta: ferramentas em duas colunas, cabe inteira sem rolar.

### Adicionado — ícones 3D animados
- Novos ícones estilo cartoon 3D (volume, profundidade, brilho especular, piscar de olhos e "squash & stretch" ao passar o mouse) para Gravar, Importar, Exportar, as seis ferramentas de escrita e os grupos Duração, Ouvir, Harmonia, Pauta e Editar; todos os ícones ganharam mais profundidade.

## [0.6.1-alpha] — 2026-11-22

### Adicionado
- **Transcrever qualquer gravação** da plataforma — feita no editor (● Gravar, gravar trecho, nova voz), solta do Importar ou faixa original de uma transcrição.
- **Duplo clique no bloco gravado** (na partitura) abre as opções: ▶ ouvir toda a gravação ou só o compasso (selecionado ou clicado) no player universal; ✨ transcrever **toda a gravação** ou **só o(s) compasso(s)**; 🎹 melodia + harmonia; vincular/desvincular 🔗; trancar 🔒; silenciar; ver no visualizador; apagar.
- As notas entram exatamente na posição da gravação e ficam **vinculadas** a ela (mover o bloco move as notas).
- Painel de Camadas (menu ⋯ da gravação): transcrever toda a gravação, com melodia + harmonia ou só os compassos selecionados.

### Corrigido
- Duplo clique em cifras e anotações na partitura não era reconhecido em alguns navegadores.
- Gravações feitas no editor agora guardam a duração e aparecem como bloco contínuo, arrastável.

## [0.6.0-alpha] — 2026-11-22

### Adicionado
- **Player universal** sempre visível na barra de menus (no celular, acima da barra inferior): ⏮ do início, ⏪ −5 s, ▶/⏸, ⏩ +5 s, ■, barra de posição arrastável, tempo e volume geral. Controla qualquer áudio em execução e **mostra qual quadro está tocando** (Composição, Pentagrama do desktop, Importar, Visualizador, Mesa, Biblioteca) — clique no nome para ir até ele. Espaço fora da partitura toca/pausa.
- **Mesa de som no painel Propriedades** (barra lateral): o que está tocando, volume geral com medidor e um canal por camada (fader, mudo, solo e medidor com a cor da camada) que **mudam o som ao vivo**, sem reiniciar a reprodução.
- **Visualizador** dinâmico da transcrição (abre sozinho depois de transcrever um áudio): 🎹 **piano vertical** (notas caindo sobre o teclado, teclas acendem) ou 🎼 **pauta** que corre sob o cursor. Ouvir **ambos**, só a **transcrição** ou só o **original**; arraste para avançar/voltar; ← → pulam compassos.
- **Arrastar o trecho do Importar para a partitura**: solte no compasso desejado — vira camada 🎙 na posição exata e é transcrito em notas **vinculadas** 🔗. Arrastar o clipe 🎙 na pauta move as notas junto. No painel de Camadas, a **corrente** ao lado do olho abre/fecha o vínculo; o **cadeado** 🔒 impede mudanças (inclusive pelo vínculo).

### Alterado
- **Importar reorganizado**: barra fixa no topo com tudo à vista — 📂 Arquivo, 🎙 **Gravar ao vivo**, transporte (⏪ ▶/⏸ ■ ⏩ e tempo), ⇲ arrastar para a partitura, 👁 ver transcrição e **✨ Transcrever**; opções (extrair, andamento, separar voz, letra, ganho, recorte) logo abaixo. Na foto: 📂 Imagem, 📷 Câmera, girar, sem recorte, "só a melodia" e **✨ Ler partitura** no topo. Na cifra: acompanhamento e **✨ Transcrever** no topo.
- **Ouvir trecho** toca a faixa importada/gravada inteira dentro do recorte (sem o limite de 8 s), com pausar/continuar, parar, ±5 s e **ponteiro verde arrastável** na onda: clique ou arraste para mudar de onde está tocando. As alças rosa continuam recortando.
- Ao transcrever um áudio, a faixa original entra junto como camada 🎙 para comparar com as notas.
- Pentagrama do desktop translúcido (fica opaco ao passar o mouse).
- Parar a reprodução agora corta na hora todas as notas já agendadas.

## [0.5.1-alpha] — 2026-11-21

### Corrigido — IA
- **Gemini sobrecarregado (HTTP 503)**: modelos reserva por provedor. Se o modelo principal (`GEMINI_MODEL`, ex.: `gemini-flash-latest`) estiver sobrecarregado, indisponível (404) ou no limite (429), tenta `GEMINI_FALLBACK_MODELS` (padrão `gemini-2.5-flash,gemini-2.5-flash-lite`) com a mesma chave antes de passar para a próxima.
- **OpenRouter "resposta vazia"**: modelos gratuitos de raciocínio só preenchiam o campo `reasoning` e o teste usava poucos tokens; agora o texto é lido também de `reasoning` e o diagnóstico usa 256 tokens.

### Adicionado
- **Pollinations** como provedor nativo (`https://gen.pollinations.ai/v1/chat/completions`, compatível com OpenAI): `POLLINATIONS_API_KEY` (chave `sk_` do enter.pollinations.ai), `POLLINATIONS_MODEL` (padrão `openai`), `POLLINATIONS_FALLBACK_MODELS` e `AI_POLLINATIONS_ANON` (uso anônimo gratuito como última reserva; ligado por padrão, `false` desliga).
- Variáveis novas aceitas no .env/GitHub, na coleta das outras apps e na sincronização: `POLLINATIONS_API_KEY`, `POLLINATIONS_MODEL`, `GEMINI_FALLBACK_MODELS`, `POLLINATIONS_FALLBACK_MODELS`, `AI_POLLINATIONS_ANON`.

## [0.5.0-alpha] — 2026-11-21

### Alterado — credenciais de IA: o .env do GitHub é a base
- Ordem de uso das chaves de cada provedor: **1. .env da VPS sincronizado do GitHub** (SERVIDOR_ENV / secrets) → **2. chaves de outras apps da mesma VPS** → **3. painel**. As reservas só entram se a anterior faltar ou **falhar no teste**. Antes, a chave do painel tinha prioridade sobre a do .env.
- Cada chave tem seu próprio disjuntor: se a do .env falha numa chamada, a próxima chave do mesmo provedor responde antes de trocar de provedor.
- **Rodar diagnóstico** agora primeiro **atualiza o acervo local** (relê o .env vindo do GitHub e procura chaves nas outras apps), depois testa **todas** as chaves e grava o resultado (`data/ai/status.json`). Uma chave reprovada sai da frente em todos os processos da API, sem reiniciar.
- Painel IA: cada provedor mostra a lista de chaves na ordem de prioridade (📄 .env/GitHub, 🔗 app X, 🔐 painel), qual está **em uso** e o resultado do teste de cada uma.

### Adicionado
- `infra/scripts/coletar-ia.sh` (root): percorre as outras apps da VPS (`/opt`, `/srv`, `/var/www`, `/home`, `/root`, até 4 níveis, e as variáveis dos containers Docker que não são do harmonIA — ex.: Prática, Gusto) e reúne **só** nomes de chaves de IA conhecidos (nunca senhas de banco/JWT). Ignora valores de exemplo, não repete a chave que já está no .env e nunca imprime valores (só os 4 últimos caracteres). Grava `data/ai/env.ai` e `data/ai/apps.ai` (0640, root:api).
- Coleta automática: a cada ciclo da atualização automática, no deploy, após a sincronização do GitHub (merge-env) e na hora em que o painel pede (unidade `harmonia-ia.path`, instalada sozinha).
- Novos provedores: DeepSeek, xAI Grok, Together AI e Hugging Face (também aceitos nos secrets do GitHub: `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `TOGETHER_API_KEY`, `HF_TOKEN`).

## [0.4.0-alpha] — 2026-11-21

### Alterado — quadro de composição mais limpo e acessível
- **Barra lateral de ferramentas** em estilo cartoon, discreta, com ícones grandes e explicações ao passar o mouse:
  - **● Gravar** e **⇪ Importar** sempre visíveis no topo;
  - ferramentas de escrita (Mover, Nota, Apagar, Cifra, Letra, Nota+);
  - grupos que abrem um **quadro explicativo** ao lado (um por vez; fecha com ✕, Esc ou clique fora):
    **Duração**, **Ouvir** (tocar, metrônomo, loop, andamento), **Harmonia** (✨ harmonizar seleção, harmonizar tudo, estilo: acordes em bloco/arpejo/baixo de Alberti/baixo + acorde, melodia ⇠ harmonia, cifrar),
    **Gravação** (gravar trecho, nova voz), **Pauta** (mão, instrumento, tonalidade, compasso, pautas e claves, + compasso, do zero) e **Editar** (↶ ↷ 🔍).
  - A barra pode ser arrastada pela alça ⋯ e volta para a lateral com duplo clique.
- **Cabeçalho enxuto**: título, resumo da pauta (instrumento, tonalidade, compasso, andamento, mão — clique abre o quadro Pauta) e ▶ Tocar.
- Janela de Composição abre maior, aproveitando o espaço do menu lateral.

### Adicionado — modo foco
- Ao abrir uma janela, os menus laterais que não fazem parte dela **saem pela lateral**: o menu esquerdo sempre; o dock de painéis só fica quando a janela é a Composição; ícones do desktop e o quadro da Comunidade também se recolhem.
- O que fica recolhido deixa uma **faixa translúcida desfocada** (passe o mouse para ver) e aparece na **bandeja da barra de menus**: menus recolhidos com ponto desfocado e contorno tracejado; **janelas minimizadas com ponto laranja**. Clique na bandeja para mostrar/restaurar.

## [0.3.0-alpha] — 2026-11-21

### Adicionado
- **Pentagrama final no desktop**: a composição inteira aparece em overlay sobre o fundo, com ▶ Tocar / ■ Parar e cursor de reprodução, ✎ Editar e ＋ Nova. Dá para mover (arrastar o título), recolher, e duplo clique no título volta à posição padrão.
- **Ícone "Nova composição"** no desktop: abre uma pauta vazia no editor.
- **Editor sob demanda**: a janela de Composição e os painéis de edição não abrem sozinhos; o painel lateral expande junto com o editor e recolhe quando ele fecha.
- **Painel de ferramentas lateral** dentro do editor: movível (arraste pela alça ⋮⋮, solte perto da borda para reacoplar), contraível (só ícones) ou expandido. **● Gravar** e **⇪ Importar** ficam sempre visíveis no topo, com explicações didáticas ao passar o mouse.
- **Gravar inteligente**: sem compassos selecionados grava uma nova voz livre; com compassos selecionados grava só aquele trecho.
- **Painéis maximizáveis e redimensionáveis** (Propriedades, Camadas, Anotações, Mesa…): botão ⤢ (Esc restaura) e alça de redimensionar.
- **Mão em edição**: direita, esquerda ou **ambas ao mesmo tempo**; seleção por retângulo pega as duas pautas; ⌘A seleciona as notas da(s) mão(s) em edição; a mão não editada fica esmaecida.
- **Instrumentos com clave automática**: violino/flauta/trompete… em Sol, viola em Dó, violoncelo/fagote/trombone/baixo em Fá; piano, órgão e harpa usam as duas pautas. O timbre da reprodução e o programa MIDI acompanham o instrumento.
- **Maestro (ícone de ajuda) arrastável**: solte onde preferir; a posição fica salva.
- **Guia passo a passo com holofote e seta cartunesca** após escolher no passo a passo inicial (compor, gravar, importar áudio, importar imagem). Fecha com ✕, Esc ou duplo clique fora do quadro. Também em **Ajuda → Guia: …**.
- **IA (admin)**: botão 🧪 Testar por provedor, 🔑 Trocar/Cadastrar chave direto da tabela e do diagnóstico (já testa ao salvar). API `POST /api/admin/ai/diagnose` aceita `{"names": [...]}` para testar só alguns.

## [0.2.0-alpha] — 2026-11-21

### Corrigido
- **CI com ✗ em todos os commits**: os testes do `ai-worker` rodavam `pytest` sem o pacote no caminho de importação. Adicionado `ai-worker/tests/conftest.py` e o workflow agora usa `python -m pytest -q tests`. Como a atualização automática só aplica commits com CI verde, nada novo chegava à VPS.
- **Deploy acusava "HTTP_PORT=20080 ocupada"** quando a porta era do próprio harmonIA: a posse da porta agora é confirmada por `/api/health` (`"project":"harmonia"`); divergência de portas TURN só gera aviso; `migrate` com novas tentativas.
- **Diagnóstico de IA**: mostra a mensagem do próprio provedor (com chaves mascaradas) e dicas para 400/402/404/429.

### Adicionado
- **Tela de login** na abertura, com **"Entrar como visitante (sem senha)"** (papel `guest`: compor, IA, exportar, biblioteca; não publica).
- **Passo a passo para novos usuários** em 2 passos: (1) compor e harmonizar · subir imagem · gravar o tema · subir áudio; (2) capturar **só a melodia** (harmonizar depois) ou **melodia + harmonia**. Botão para pular direto à estação completa com projeto vazio. Reabrível em **Ajuda → Passo a passo inicial**.
- **⟲ Do zero**: reinicia a composição numa partitura vazia.
- **Pautas e claves**: ocultar a mão esquerda, mostrar só a pauta inferior e trocar clave (Sol, Fá, Dó) de cada pauta.
- **● Nova voz**: grava livremente sobre os compassos (a partir da seleção), com contagem e metrônomo; a gravação vira uma camada nova e a transcrição entra como voz/harmonia em camadas próprias.
- **Grupos de camadas**: criar, renomear, recolher, visível/mudo/solo/trava do grupo inteiro, arrastar camadas para o grupo.
- **Mesa de Edição** no menu lateral direito; **Comunidade** como quadro discreto, móvel, que pode ser fechado ou acoplado ao menu lateral.
- **Área de notificações** (sino na barra superior): trabalhos concluídos/falhos e avisos ficam registrados.
- **Maestro** começa minimizado como ícone de ajuda; clique para despertá-lo.

### Alterado
- Quadros sobrepostos agora são opacos (sem transparência).

## [0.1.9-alpha] — 2026-11-21

### Adicionado — versão para celular (detecção automática)
- `core/device.ts`: identifica celular × desktop e troca o layout sozinho, inclusive ao girar a tela ou redimensionar.
  - Critérios: user agent móvel (Client Hints), tela estreita (≤ 820 px), ou toque como ponteiro principal em tela < 1100 px (tablet em retrato).
  - Escolha manual: **Ajuda → Versão para celular / Detectar automaticamente** no desktop, ou **Mais → Usar versão desktop** no celular.
- Layout celular:
  - tela **Início** com blocos grandes;
  - **barra inferior fixa** (Início, Compor, Importar, Painéis, Mais) com alvos de toque ≥ 48 px;
  - janelas em tela cheia com **‹ Voltar**;
  - Propriedades, Camadas e Anotações numa **folha inferior**;
  - folha **Mais** com os demais apps, idioma e acessibilidade;
  - Maestro como **botão flutuante leve**: o WebGL fica pausado quando oculto, para poupar bateria.
- Editor no toque:
  - a partitura rola com o dedo, e as notas, o "+" de compasso e as anotações capturam o gesto;
  - barra de ferramentas com rolagem horizontal e transporte (Tocar) em primeiro;
  - zoom inicial adequado.
- **Acessibilidade** (todas as versões):
  - link "Pular para o conteúdo" e foco visível de alto contraste;
  - **Texto maior** e **Alto contraste** (persistidos);
  - `aria-current` na navegação, rótulos acessíveis e `prefers-reduced-motion` respeitado.

### Adicionado — Administração → 🤖 IA
- **Registrar credenciais de outras IAs pelo painel**:
  - provedores conhecidos (Groq, Gemini, GitHub Models, OpenRouter, Cerebras, Mistral, Anthropic, OpenAI) ou **qualquer IA compatível com OpenAI, Anthropic ou Gemini**, informando identificador, nome, URL https e modelo;
  - a chave é cifrada com AES-256-GCM (tabela `ai_credentials`) e nunca volta para a tela (só os 4 últimos caracteres);
  - tem prioridade sobre o `.env`/GitHub para o mesmo provedor e vale sem reiniciar (cache de 30 s por worker);
  - salvar já testa a credencial; o botão 🗑 remove;
  - toda alteração entra na auditoria.
- **🩺 Rodada diagnóstica**: testa cada IA isoladamente, em paralelo, e mostra ✅/❌, origem da chave, modelo, tempo e o **motivo da falha em português** (chave inválida, limite atingido, modelo inexistente, tempo esgotado, rede). Inclui o tradutor grátis MyMemory e o Maestro offline.

### Corrigido
- O formulário do Maestro e o balão respeitam `hidden` (antes ficavam sempre visíveis).

## [0.1.8-alpha] — 2026-11-21

### Adicionado — IA gratuita de suporte e credenciais do GitHub
- **Provedores gratuitos (free tier, sem cartão)** na cadeia de failover: **Groq** (Llama 3.3 70B), **Google Gemini 2.5 Flash**, **GitHub Models** (PAT com `models:read`), **Cerebras**, **Mistral** e **OpenRouter** (roteador `openrouter/free`, imune à rotação de modelos).
  - Ordem padrão: os pagos primeiro, se houver chave, e em seguida os gratuitos.
  - Provedores configurados que não estão em `AI_PROVIDERS` entram no fim da lista, para nenhuma chave ficar ociosa.
  - Nomes alternativos aceitos: `GOOGLE_API_KEY`, `CLAUDE_API_KEY`, `GH_MODELS_TOKEN`.
- **Respostas garantidas sem nenhuma IA disponível**:
  - Tradução: cache → IA → **MyMemory** (gratuito, sem chave; textos agrupados para poupar a cota).
  - Maestro: IA → **modo offline**, que explica as notas de qualquer cifra citada (ex.: `F#m7(b5) = F#, A, C, E`) e traz um guia do editor por assunto (harmonizar, camadas, gravar, exportar, letra, transcrição).
- **Credenciais registradas no GitHub chegam à VPS**:
  - novo job `sync-ai-env` no CI (a cada push, diariamente e sob demanda em *Run workflow*);
  - lê o secret `SERVIDOR_ENV` (formato `.env`) e/ou secrets individuais;
  - envia por SSH para `merge-env.sh`, que mescla **só chaves de IA** da lista permitida (senhas do banco, JWT e chave de criptografia nunca são alteradas);
  - valor vazio mantém a chave já registrada na VPS; nunca imprime valores; reinicia a API só se algo mudou.
- `configurar-ia.sh` passa a perguntar também pelos provedores gratuitos, com o link de onde obter cada chave.
- Administração → 🤖 IA mostra o rótulo "grátis" e o modelo de cada provedor.

### Corrigido
- `env_set` seguro para qualquer caractere no valor (`|`, `&`, `/`), preservando dono e permissão do `.env`.
- A atualização automática considera só o check `test` (`AUTOUPDATE_CI_CHECKS`). Uma falha na sincronização de credenciais não bloqueia atualizações.
- Os testes da API usam `conftest.py`, porque o ambiente de teste precisa ser definido antes do primeiro import.
- A tradução não cai se o Redis estiver fora (o cache é opcional).

## [0.1.7-alpha] — 2026-11-19

### Adicionado — failover entre provedores de IA
- `backend/app/core/llm.py`: tradução contextual e assistente Maestro usam uma cadeia de provedores **Anthropic → OpenAI → Gemini → OpenRouter** (ordem configurável em `AI_PROVIDERS`). Entram na cadeia só os provedores com chave.
  - Em timeout, erro de rede, 429/5xx ou chave inválida, o próximo provedor responde.
  - O provedor que falhou fica em pausa crescente (circuit breaker, `AI_COOLDOWN_S`).
  - As chaves nunca são logadas nem devolvidas pela API.
- `infra/scripts/configurar-ia.sh`: grava as chaves no `.env` da VPS com digitação **oculta**, faz backup do `.env`, define a ordem e reinicia só a API.
- Administração → **🤖 IA**: provedores, modelo, estado (ok/em pausa), chamadas e o botão **Testar failover**, que mostra qual provedor respondeu.

## [0.1.6-alpha] — 2026-11-19

### Adicionado — atualizações automáticas
- **`infra/scripts/autoupdate.sh` + systemd timer (`harmonia-autoupdate.timer`)**. A cada 5 minutos a VPS:
  1. consulta o GitHub (`LACibermedicina/harmonia`, branch `main`);
  2. aplica só commits cujo CI (testes + build) passou;
  3. reconstrói, reinicia e confere `/api/health`;
  4. se falhar, faz **rollback** automático para a versão anterior e bloqueia o commit ruim.

  Preserva `.env` e `data/`. É o modelo "pull": nenhuma chave da VPS fica guardada no GitHub.
- O script executa uma cópia temporária de si mesmo, porque a atualização pode substituir o próprio arquivo, e usa trava (`flock`) contra execuções simultâneas.
- Aviso no app: quando o servidor muda de versão, aparece "Nova versão instalada — Recarregar agora". Antes de recarregar, salva a composição aberta.
- Administração → **🔄 Atualizações**: versão em execução, estado (em dia, aguardando CI, aplicando, revertido), commit e log (`/api/admin/system`).
- `instalar-do-mac.sh` publica o código no GitHub ao final, e esse repositório passa a ser a origem das atualizações.

### Alterado
- Workflow renomeado para `ci-harmonia`. O job de deploy por SSH só roda com a variável `DEPLOY_MODE=push`; por padrão o CI só testa e a VPS busca sozinha.
- `deploy.sh` tenta a migração várias vezes enquanto a API inicia. O setup instala `git` e configura as variáveis `AUTOUPDATE_*`.

## [0.1.5-alpha] — 2026-11-19

### Corrigido
- **A transcrição agora chega à Composição como camada.** No modo leve (servidor pequeno), o áudio caía num erro porque dependia do PyTorch. Agora existe um motor de transcrição leve, que usa só numpy e ffmpeg:
  - **melodia:** detecção de altura por YIN, com vibrato e glissando;
  - **andamento:** detectado pelos ataques;
  - **acordes:** por cromagrama, por meio compasso, com acompanhamento de piano.
  Ao terminar, a janela de Composição é aberta, o painel Camadas é revelado, a camada nova fica ativa e uma notificação diz quais camadas foram criadas. O mesmo vale para a cifra e para a foto.
- As camadas criadas por importação recebem o nome do arquivo de origem (ex.: "Melodia transcrita — minha-musica").
- Selecionar compassos limpa a seleção de notas e vice-versa, para não haver ambiguidade sobre o que será copiado ou recortado.

### Adicionado
- **Copiar ou recortar para nova camada** as notas ou os compassos selecionados:
  - pela barra de seleção acima da partitura, pelo painel Propriedades ou pelos atalhos ⌘⇧C / ⌘⇧X;
  - é criada uma camada por pauta de origem (Sol/Fá);
  - camadas bloqueadas não são recortadas.
- **Identidade visual por camada**:
  - cada camada nova recebe uma cor ainda não usada;
  - cabeça, haste, bandeirola, linhas suplementares, ponto, acidente e sílaba da nota usam a cor da camada;
  - a barra de duração ganha uma **textura própria por camada** (lisa, listrada, pontilhada, xadrez, vertical, ondas), que distingue as camadas também sem depender de cor;
  - legenda de camadas acima da partitura (clique ativa a camada, duplo clique oculta) e tooltip "Camada: …" em cada nota;
  - anotações e gravações mostram a cor da camada, e o painel Propriedades mostra a etiqueta da camada das notas selecionadas.

## [0.1.4-alpha] — 2026-11-19

### Adicionado
- **Painel lateral direito acoplável**, do lado oposto ao menu lateral esquerdo, com os painéis da partitura:
  - **Propriedades**: dados da partitura (título, andamento, fórmula, tonalidade, nº de compassos). Para notas selecionadas: altura (±semitom/oitava, nome em solfejo e cifra), duração, intensidade, sílaba, efeito vocal, mover de camada, apagar. Para compassos selecionados: cifra, harmonizar, ouvir, inserir antes/depois, limpar, excluir.
  - **Camadas**: o gestor de camadas passa de janela para painel, com layout compacto.
  - **Anotações**: lista, edição inline, cor, ir ao compasso e remover.
- Comportamento dos painéis:
  - arrastar o cabeçalho para fora do dock (ou ⇱ ou duplo clique) transforma o painel em flutuante, movível e redimensionável;
  - arrastar de volta sobre o dock reacopla o painel na posição da linha guia; o mesmo gesto reordena os painéis dentro do dock;
  - cada painel pode ser recolhido (▾) ou fechado (✕);
  - o dock inteiro recolhe para uma faixa de ícones (☰), como o menu esquerdo, e ↺ restaura o layout padrão;
  - o layout fica salvo no navegador.
- `store.deleteMeasures()`: exclui compassos e puxa o conteúdo seguinte para trás (cifras, anotações e gravações acompanham; notas que invadiam o trecho são encurtadas).

### Alterado
- Os ícones 3D usam gradientes globais (corrige ícones sem cor quando o mesmo ícone aparece em vários lugares).
- A janela de Composição se ajusta à largura disponível entre os dois menus laterais; ícones do desktop, Maestro e janelas maximizadas respeitam o dock direito.

## [0.1.3-alpha] — 2026-11-19

### Adicionado
- **Administração** (somente o papel `admin`): visão geral com estatísticas, usuários (busca, troca de papel, bloquear/liberar acesso), moderação da biblioteca pública (despublicar) e trilha de auditoria LGPD. Endpoints `/api/admin/*` validados no servidor; o admin não consegue remover o próprio acesso.
- **Inserir compasso**: um "+" discreto em cada barra de compasso (entre compassos, no início e no final). Alt+clique insere 4 compassos. As notas que cruzam a barra são divididas, e cifras, anotações, gravações e a seleção são deslocadas. Funciona com desfazer (⌘Z).

### Alterado
- **Fluxo de IA** e **Administração** ficam ocultos no Dock, no menu lateral, nos ícones do desktop e no menu Janelas para quem não é admin. A abertura direta é bloqueada, e as janelas administrativas fecham ao sair da conta.
- `instalar-do-mac.sh` passa a usar o pacote `harmonia-v*.zip` mais recente e recusa os usuários `deploy` e `root` no login.
- A API lê a versão do arquivo `VERSION` da raiz também em desenvolvimento.

## [0.1.2-alpha] — 2026-11-19

### Adicionado
- `infra/scripts/instalar-do-mac.sh`: instala e atualiza a partir do Mac com um único comando. Ele envia o pacote, cria a chave pessoal e a chave de deploy, roda o setup com sudo e deixa o `VPS_SSH_KEY` copiado na área de transferência.
- **Modo de IA leve** (`AI_ML=0`, escolhido automaticamente com menos de 8 GB de RAM ou 20 GB de disco livre): o ai-worker fica com ~700 MB, sem PyTorch. Editor, cifra, harmonização e exportação MIDI/MusicXML/PDF/WAV/MP3 continuam funcionando; a transcrição de áudio e foto mostra aviso claro. `/api/health` informa `ai_full`.
- O próprio setup agora constrói, sobe, migra e testa a stack. O site fica no ar antes mesmo do GitHub Actions.

### Alterado (servidor compartilhado com Odoo e outros serviços)
- O setup deixa de mexer no firewall quando o UFW está desligado, e nunca liga o UFW por conta própria.
- vhost do nginx com rollback automático se `nginx -t` falhar, e suporte a `conf.d` quando não existe `sites-enabled`.
- Antes do certbot, confere se o DNS do subdomínio aponta para o IP público. Se não apontar, informa o comando para rodar depois.
- Usuário `deploy` corrigido: home e shell bash, entra só com chave, fica no grupo `docker` e sai do grupo `sudo` (menor privilégio).
- Checagens prévias de disco (mínimo de 4 GB) e swap; `apt-get update` tolera repositórios de terceiros com chave GPG vencida.
- Instala o plugin `docker compose` se estiver faltando. A API usa 1 worker em máquinas com menos de 4 GB de RAM.

## [0.1.1-alpha] — 2026-11-19

### Alterado — regra de portas: nenhuma porta < 1024 e nenhuma porta já em uso
- O harmonIA não publica mais 80/443. O nginx da stack passou para `nginxinc/nginx-unprivileged`, que escuta 8080 no container e só fica acessível em **`127.0.0.1:HTTP_PORT`** no host.
- `infra/scripts/lib-ports.sh`: detecta as portas em uso (via `ss`, com fallback em `/proc/net` e nas portas publicadas pelo Docker) e escolhe portas altas livres (≥ 20000): `HTTP_PORT`, `TURN_PORT` e a faixa de relay `TURN_MIN_PORT`–`TURN_MAX_PORT`. As escolhas ficam gravadas no `.env` e são reaproveitadas nos próximos deploys.
- `deploy.sh` confere as portas antes de subir. Se alguma ficou ocupada por outro serviço, o deploy é abortado sem alterar nada.
- O HTTPS público fica com o **proxy que já existe no servidor**. O `setup-vps.sh` detecta nginx ou apache, cria o vhost `harmonia.m3d.pro → 127.0.0.1:HTTP_PORT` e emite o certificado com `certbot --nginx` ou `certbot --apache`. Para Caddy e Traefik gera instruções. Sem proxy, há a opção do túnel Cloudflare (perfil `tunnel`, sem porta de entrada).
- Removidos o certbot standalone (que usava a porta 80) e o cron de renovação próprio. A renovação passa para o `certbot.timer` do host.
- coturn: portas dinâmicas e `--no-tcp-relay`. O servidor realtime passou a anunciar o `TURN_PORT` correto.

### Corrigido
- Firewall: o setup não derruba mais serviços que já rodam na VPS. Se o UFW está ativo, as regras existentes são mantidas. Se está inativo, todas as portas públicas que já estão em escuta são liberadas antes de ativá-lo. A porta do SSH é detectada.
- O endurecimento do SSH (desligar o login por senha) agora é opcional (`HARDEN_SSH=1`), porque afeta o servidor inteiro.
- `api` e `ai-worker` ganharam a rede `egress`. Antes, a rede `internal` bloqueava as chamadas à API de IA e o download dos modelos.
- CI: health check interno via SSH em `127.0.0.1:HTTP_PORT`, seguido do health check público. Se só o público falhar, sai um aviso (problema de proxy/DNS) em vez de erro.

## [0.1.0-alpha] — 2026-11-18

Primeira iteração: infraestrutura, motor musical, API e desktop de composição.

### Infra & DevOps
- `.github/workflows/deploy.yml`: testes (motor musical + API) → build do frontend → rsync via SSH → `deploy.sh` na VPS → health check em `https://harmonia.m3d.pro/api/health`.
- `infra/scripts/setup-vps.sh`: Docker + Compose, usuário `deploy`, árvore `/opt/harmonia`, UFW (22/80/443 + TURN), hardening SSH, fail2ban, `.env` com segredos aleatórios (chmod 600), certificado Let's Encrypt, cron de renovação e de backup.
- `docker-compose.yml`: nginx (com build do frontend), api, ai-worker, realtime, postgres 16, redis 7, coturn. Rede `internal` sem saída direta; só o nginx é exposto.
- Nginx: HTTPS/HTTP2, HSTS, cabeçalhos de segurança, rate limit (auth 5/min, API 20/s), upload de até 200 MB, proxy WebSocket `/ws/`.

### Motor musical (ai-worker) — testado
- Cifra brasileira/internacional: `C7M`, `m7(b5)`, `7(9)`, `sus4`, `°`, `/baixo`, solfejo, `%`.
- Cifra em texto → acordes por compasso + letra + seções.
- Harmonização automática (Viterbi com funções T/S/D) **por trecho**, mantendo os outros compassos como contexto; voicing com condução de vozes (bloco, arpejo, Alberti, baixo + acorde).
- Melodia extraída da harmonia (skyline), reconhecimento de acordes a partir das notas, detecção de tonalidade (Krumhansl).
- Silabação em português, alinhamento de letra às notas (pausas e melismas), conferência da letra cantada × letra informada.
- Exportação MIDI (sem dependências) e MusicXML 4.0 (piano em 2 pautas, ligaduras entre compassos, cifras, letra, anotações).
- Wrappers de IA: Demucs (separação), Basic Pitch (áudio → notas), pYIN (voz + vibrato/glissando), faster-whisper (letra com tempos), oemer (OMR), Verovio (PDF), FluidSynth/ffmpeg (WAV/MP3).

### API (FastAPI)
- Autenticação JWT, RBAC (`admin`, `composer`, `student`, `viewer`), senhas com scrypt.
- LGPD: consentimento obrigatório e versionado, e-mail/nome cifrados (AES-256-GCM) com índice HMAC, exportação e exclusão da conta, trilha de auditoria, minimização (biblioteca pública mostra só o primeiro nome; IA não recebe dados pessoais).
- Composições com controle de versão otimista, publicação privada / por link / pública / destaque no link principal, playlists e álbuns com ordenação.
- Upload com validação de tipo e de conteúdo; jobs leves síncronos e pesados em fila Redis.
- Tradução contextual por IA com cache de 30 dias; assistente "Maestro".

### Frontend (Vite + TypeScript)
- Desktop estilo macOS: janelas arrastáveis/redimensionáveis, minimizar para o Dock, maximizar, duplo clique fora fecha a janela ativa, ⌘W.
- Menu lateral recolhível, Dock com magnificação, ícones 3D estilo Pixar com micro-animações.
- Seletor de idiomas (🇨🇳 🇪🇸 🇬🇧 🇮🇳 🇧🇷): dicionário local + tradução por IA de todo texto visível.
- Editor de partitura: sistema Sol/Fá, armadura, fórmula, cifras, letra, anotações; drag & drop de notas (diatônico/cromático, duplicar com Alt), redimensionar duração, figuras arrastadas da paleta, atalhos, desfazer/refazer, seleção de compassos, harmonização por trecho, gravação de trechos com contagem.
- Gestor de camadas, importação (recorte/ganho de áudio, recorte/rotação de foto, cifra com prévia), mesa de edição com exportação, biblioteca, fluxo de IA em grafo, agenda com notas arrastáveis, comunidade com chat e videochamada WebRTC, avatar 3D Maestro (Three.js) com XP.

### Limitações conhecidas (próximas iterações)
- Migrações de banco ainda via `create_all` → Alembic na v0.2.0.
- Remoção física de mídia ao excluir conta: job de limpeza na v0.2.0.
- OMR e transcrição polifônica dependem da qualidade da entrada; revisão manual no editor é esperada.
- Colaboração simultânea na mesma partitura: canal `score-patch` pronto no realtime, integração no editor na v0.2.0.
