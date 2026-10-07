# Central Elite & Durães

Aplicativo de caixa e produção da **Elite Marketing Digital** e da **Durães Fotografia**.
Ele fica hospedado no **GitHub Pages**, que é gratuito e dá o link do site. O login, as senhas e os dados ficam no **Firebase** do Google, no plano gratuito.

Tempo total para colocar no ar: uns 25 minutos, uma vez só.

---

## Parte 1: Firebase (login e banco de dados)

1. Acesse **https://console.firebase.google.com** com o Gmail `duraesfotografiax@gmail.com`.
2. Clique em **Criar um projeto**, dê o nome `central-elite-duraes`, desative o Google Analytics e clique em **Criar projeto**.
3. Ative o login por e-mail e senha:
   - No menu à esquerda, vá em **Criação** → **Authentication** → **Vamos começar**.
   - Escolha **E-mail/senha**, ative a primeira chave e clique em **Salvar**.
4. Crie o banco de dados:
   - No menu, vá em **Criação** → **Firestore Database** → **Criar banco de dados**.
   - Em "Local", escolha **southamerica-east1 (São Paulo)**.
   - Escolha **Iniciar no modo de produção** e clique em **Criar**.
5. Coloque as regras de segurança. São elas que impedem quem não tem acesso de ver o caixa:
   - Ainda no Firestore, abra a aba **Regras**.
   - Apague tudo o que estiver lá.
   - Abra o arquivo `firestore.rules` desta pasta, copie **todo** o conteúdo e cole.
   - Clique em **Publicar**.
6. Pegue os dados de conexão:
   - Clique na engrenagem ⚙️ ao lado de "Visão geral do projeto" e depois em **Configurações do projeto**.
   - Lá embaixo, em "Seus apps", clique no ícone **</>** (Web).
   - Dê o nome `Central` e clique em **Registrar app**. Não precisa marcar o Hosting.
   - Vai aparecer um bloco `const firebaseConfig = { apiKey: "...", ... }`.
7. Abra o arquivo `firebase-config.js` desta pasta com o Bloco de Notas. Troque cada `COLE_AQUI` pelos valores desse bloco (apiKey, authDomain, projectId, storageBucket, messagingSenderId e appId) e salve.

---

## Parte 2: GitHub (o link do site)

1. Entre em **https://github.com**. Se não tiver conta, crie uma; é grátis.
2. Crie o repositório:
   - Clique em **+** → **New repository**.
   - Em "Repository name", escreva `central`.
   - Deixe **Public** marcado. O GitHub Pages gratuito exige isso, e os dados continuam protegidos pelas regras do Firebase.
   - Clique em **Create repository**.
3. Envie os arquivos:
   - Clique em **uploading an existing file**.
   - Arraste **todo o conteúdo desta pasta**: `index.html`, `firebase-config.js`, `manifest.json`, `firestore.rules`, `README.md` e as pastas `logos` e `icons`.
   - Clique em **Commit changes**.
4. Ative o site:
   - No repositório, vá em **Settings** → **Pages**.
   - Em "Branch", escolha **main** e a pasta **/ (root)**, e clique em **Save**.
5. Espere 1 ou 2 minutos e recarregue a página. Vai aparecer o link do site, no formato:
   `https://SEU-USUARIO.github.io/central/`

---

## Parte 3: liberar o link no Firebase

1. No Firebase, vá em **Authentication** → aba **Configurações** → **Domínios autorizados**.
2. Clique em **Adicionar domínio**, escreva `SEU-USUARIO.github.io` (sem o `/central`) e clique em **Adicionar**.

Sem este passo, o login não funciona no link do GitHub.

---

## Parte 4: primeiro acesso

1. **Thiago** abre o link, clica em **Criar conta** e usa o e-mail `duraesfotografiax@gmail.com`.
2. Chega um e-mail de confirmação (olhe também no spam). Clique no link e volte ao site em **Já confirmei**. Você entra como **Adm**.
3. Mande o link para a **Vanessa** e o **Lucas**. Cada um clica em **Criar conta** com o próprio e-mail e senha e fica em "aguardando liberação".
4. Na aba **Equipe** → **Acessos**:
   - **Aprovar entrada** para os dois.
   - Para a Vanessa, ligue **Vê o caixa**.
   - Para o Lucas, deixe **Vê o caixa** desligado. Ele vai usar só Produção, Agenda e Equipe.
5. Para liberar ou tirar o caixa de alguém depois, basta ligar ou desligar a chave. Vale na hora.
6. Para conferir o que a equipe enxerga, use **Ver como a equipe**.

---

## Parte 5: instalar no celular

- **iPhone:** abra o link no **Safari**, toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
- **Android:** abra o link no **Chrome**, toque em **⋮** e depois em **Adicionar à tela inicial** ou **Instalar app**.

O ícone da Central aparece na tela e abre em tela cheia, como um aplicativo.

---

## Perguntas comuns

**É seguro deixar o código público no GitHub?**
Sim. O código não guarda nenhum dado. A `apiKey` do Firebase não é uma senha; ela só identifica o projeto. Quem decide quem lê o quê são as regras do `firestore.rules`, que rodam nos servidores do Google:
- sem login, a pessoa não vê nada;
- conta que ainda não foi aprovada não vê nada;
- quem está sem "Vê o caixa" não recebe nenhum lançamento nem valor.

**Quanto custa?**
Nada, no uso de vocês. O plano gratuito do Firebase (Spark) permite 50 mil leituras e 20 mil gravações por dia, e o GitHub Pages é grátis.

**Esqueci a senha.**
Na tela de entrada, clique em **Esqueci minha senha**. O link para criar uma nova chega por e-mail.

**Como atualizo o app depois?**
No GitHub, abra o arquivo, clique no lápis (editar) ou envie o arquivo novo por cima e faça **Commit**. O site atualiza em 1 ou 2 minutos.

**Posso trocar o e-mail do dono?**
Pode. Troque em dois lugares: `firebase-config.js` (`ADMIN_EMAIL`) e `firestore.rules` (`donoEmail`). Depois publique as regras de novo no Firebase.

---

## Notificações (agenda, captação chegando e edição atrasada)

O que cada pessoa recebe, nos trabalhos em que está marcada (o Adm recebe de todos):
- **Resumo do dia, por volta das 8h:** captações de hoje e de amanhã, entregas dos próximos 2 dias e edições atrasadas.
- **"Daqui a pouco":** cerca de 2 horas antes de cada captação que tenha horário.
- **"Edição atrasada":** no dia em que o prazo de entrega estoura.

Dentro do app, o **sino** no topo mostra a mesma lista a qualquer hora.

### Configuração (uma vez só)

1. **Chave de notificações (VAPID)**
   - No Firebase, abra ⚙️ **Configurações do projeto** → aba **Cloud Messaging**.
   - Em **Configuração da Web → Certificados push da Web**, clique em **Gerar par de chaves**.
   - Copie a chave e cole em `firebase-config.js`, no lugar de `COLE_AQUI`, na linha `self.VAPID_KEY`.
2. **Chave do robô** (é secreta: não mande para ninguém e não coloque no repositório)
   - No Firebase, abra ⚙️ **Configurações do projeto** → aba **Contas de serviço**.
   - Clique em **Gerar nova chave privada** e depois em **Gerar chave**. Um arquivo `.json` é baixado.
   - No GitHub, abra o repositório e vá em **Settings → Secrets and variables → Actions → New repository secret**.
   - Em "Name", escreva `FIREBASE_SERVICE_ACCOUNT`.
   - Em "Secret", cole **todo** o conteúdo do arquivo `.json`. Abra o arquivo com o Bloco de Notas, use Ctrl+A e Ctrl+C.
   - Clique em **Add secret**. Depois apague o `.json` do computador.
3. **Regras atualizadas**
   - Cole de novo o `firestore.rules` em **Firestore → Regras** e clique em **Publicar**.
4. **Envie os arquivos novos**
   - Copie tudo desta pasta para a pasta do repositório, substituindo os arquivos antigos. Inclua as pastas `.github` e `notificar` e o arquivo `.nojekyll`.
   - No GitHub Desktop, faça **Commit** e depois **Push origin**.
5. **Cada pessoa ativa no próprio aparelho**
   - Abra o app, toque no **sino**, depois em **Ativar notificações** e em **Permitir**.
   - Em **"Eu sou"**, escolha o seu nome.
   - No iPhone, primeiro instale o app (Safari → Compartilhar → **Adicionar à Tela de Início**) e abra pelo ícone. É uma exigência da Apple.
6. **Teste**
   - No GitHub, abra **Actions → Notificações da Central → Run workflow** e escolha **teste**.
   - Todo mundo que ativou as notificações recebe uma mensagem de teste em alguns segundos.

### Observações
- **Com o app aberto** (inclusive em outra aba ou minimizado no PC), o aviso de "Programar post" e de "Pronto no Drive" aparece **na hora**.
- **Com o app fechado**, quem avisa é o robô do GitHub, que confere a cada 10 minutos. O GitHub às vezes atrasa alguns minutos a mais. O mesmo aviso nunca chega duas vezes para a mesma pessoa.
- O GitHub pausa robôs agendados em repositórios sem nenhuma alteração por 60 dias. Se isso acontecer, ele avisa por e-mail; basta entrar em **Actions** e clicar em **Enable workflow**.

---

## Aba Clientes (do material editado até o post no ar)

Cada loja que a Elite atende vira uma abinha dentro de **Clientes**. O fluxo é:

1. **Produção:** ao cadastrar um trabalho da Elite, escolha o **Cliente (loja)**. Se o nome da loja estiver no título, o app escolhe sozinho.
2. **Entregue:** quando o editor move o cartão para **Entregue**, o app pede:
   - o **link da pasta no Drive**;
   - **o que foi entregue**, com um item por post (ex.: "Ford Ka SE 2016 – Reels", "Jeep Renegade – Carrossel").
3. **Aviso:** quem programa os posts da loja (a Vanessa, por padrão) recebe a notificação "Programar post: Eduardo Motors".
4. **Programei:** depois de programar no Meta, a Vanessa toca em **Programei** e informa o dia e a hora em que o post vai sair.
5. **Conferência:** depois desse horário, quem toca em **Saiu ✓** marca o post como no ar. Se passar 2 horas e ninguém marcar, o app manda o aviso "Confira se saiu".

A aba **Todas** mostra um resumo de cada loja: o que está em produção, para programar, programado e no ar.
Na primeira vez, o Adm clica em **"Adicionar as lojas do Meta"** para cadastrar as lojas de uma vez, e depois ajusta o Instagram de cada uma em **Editar cliente**.

**Importante:** cole de novo o `firestore.rules` no Firebase (Firestore → Regras → Publicar), porque ele ganhou as regras de lojas e posts.

---

## Clientes · Durães (entrega para casamentos, eventos e aniversários)

Em **Clientes**, use o botão **Clientes · Durães**. As colunas são:
- **Próximos eventos**
- **Em edição**
- **No Drive · enviar ao cliente**
- **Entregue ao cliente**

O fluxo:
1. Quando o editor termina, toca em **Pronto no Drive** (ou move o cartão para **Entregue** na Produção) e cola o link da pasta.
2. Thiago e Vanessa recebem o aviso "Pronto no Drive: Casamento Julia".
3. Depois de mandar o link ao cliente, toque em **Enviei ao cliente**.

O trabalho que fica mais de 3 dias esperando envio ganha um alerta. O campo **Contato do cliente** guarda o WhatsApp dos noivos ou do contratante.

## Resumo e Caixa escondidos (cadeado)

- O app sempre abre na **Produção**. O **Resumo** e o **Caixa** não aparecem no menu.
- Para abri-los, toque no **cadeado**, ao lado do seu nome (no celular, no topo), e digite seu **PIN**.
- Na primeira vez, você cria o PIN. Ele fica salvo só naquele aparelho.
- Ao digitar o PIN, a opção **"Manter aberto neste aparelho"** vem marcada. Com ela marcada, o PIN não é pedido de novo naquele aparelho.
- Para esconder de novo, toque no cadeado; depois disso o PIN volta a ser pedido.
- Se a opção for desmarcada, tranca sozinho depois de **5 minutos sem uso**, ou se o app ficar mais de 1 minuto em segundo plano.
- Esqueceu o PIN? Toque em **Esqueci o PIN**, confirme a senha da conta e crie outro.
- Os valores dos trabalhos também ficam escondidos enquanto estiver trancado.
- Quem não tem acesso ao caixa (o Lucas) nem vê o cadeado. Para ele, essas abas não existem.

---

## Aba Drive (Google Drive dentro da Central)

O que dá para fazer:
- Navegar pelas pastas da **Durães Fotografia** e de **Clientes · Elite**, onde cada loja tem a sua pasta.
- **Subir pasta**: envia uma pasta inteira do computador, com as subpastas.
- **Subir arquivos** e **Nova pasta**.
- **Copiar link** e **Abrir no Drive**.
- **Usar no fluxo**: liga uma pasta a um trabalho que está em edição.

Nas janelas de entrega (Produção → Entregue, ou Clientes → Pronto no Drive) há os botões **Subir pasta do computador** e **Escolher no Drive**. O material sobe para a pasta certa e o link é preenchido sozinho:
- **Elite:** vai para `Clientes/<nome da loja>/`, e a pasta da loja é criada se ainda não existir.
- **Durães:** vai para a pasta da Durães Fotografia.

Na coluna "No Drive · enviar ao cliente" da Durães, o botão **Copiar link p/ cliente** libera a pasta para quem tiver o link e copia o link para você mandar aos noivos.

### Configuração (uma vez, uns 10 minutos)
1. Entre em **https://console.cloud.google.com** com o Gmail da Durães e selecione o projeto **Central Duraes**, no topo.
2. Ative a API do Drive: vá em **APIs e serviços → Biblioteca**, procure **Google Drive API** e clique em **Ativar**.
3. Configure a tela de consentimento em **APIs e serviços → Tela de permissão OAuth**. Ela também pode aparecer como "Google Auth Platform".
   - Clique em **Começar**.
   - Nome do app: **Central**. E-mail de suporte: o seu.
   - Público: **Externo**.
   - Contato: o seu e-mail.
   - Clique em **Criar**.
   - Em **Público → Usuários de teste**, adicione os Gmails do **Thiago**, da **Vanessa** e do **Lucas**.
4. Crie a credencial em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
   - Tipo: **Aplicativo da Web**.
   - Nome: **Central**.
   - Em **Origens JavaScript autorizadas**, adicione `https://duraesfotografiax-alt.github.io`.
   - Clique em **Criar** e copie o **ID do cliente**, que termina em `.apps.googleusercontent.com`.
   - Cole no `firebase-config.js`, em `self.GOOGLE_CLIENT_ID`.
5. **Compartilhe as pastas** "Durães Fotografia" e "Clientes" do Drive com os Gmails da Vanessa e do Lucas, como **Editor**.
6. Na Central, abra **Drive → Conectar Google Drive**.
   - Vai aparecer o aviso "O Google não verificou este app". É normal, porque o app é só de vocês: clique em **Avançado → Acessar Central**.
   - O Adm clica em **Escolher pasta no Drive** para definir a pasta da Durães e a pasta Clientes. É uma vez só, e vale para todos.

Observações:
- Cada pessoa conecta com a própria conta Google e só vê o que essa conta já pode ver no Drive.
- Vídeos grandes sobem em partes e retomam sozinhos se a internet oscilar. Não feche a Central enquanto aparecer "Enviando para o Drive".
- No iPhone, o navegador não permite escolher uma pasta inteira. Use **Subir arquivos**, que cria uma pasta com a data e o nome do trabalho.
- Cole de novo o `firestore.rules` no Firebase, porque ele ganhou a regra das configurações do Drive.

---

## Aba Álbuns (o cliente escolhe as fotos do álbum)

1. **Criar:** em **Álbuns → Novo álbum**, escolha o trabalho e clique em **Escolher pasta no Drive**, apontando a pasta de fotos que foi para o cliente. Defina o **limite de fotos** (ex.: 80), o prazo (opcional) e uma mensagem.
2. A Central lê as fotos da pasta e das subpastas (ex.: Cerimônia, Festa) e **libera a pasta para quem tiver o link**.
3. Ela gera o **link da galeria**. Copie ou mande pelo **WhatsApp** direto do botão.
4. **O cliente abre o link** (não precisa de login nem de conta Google):
   - toca no ♥ para escolher, vê cada foto em tela cheia e passa para o lado;
   - pode filtrar por subpasta e por "Escolhidas";
   - não consegue passar do limite;
   - a escolha fica salva sozinha, então ele pode continuar depois;
   - no fim, toca em **Enviar seleção**, com um recado opcional.
5. **Vocês recebem o aviso** "Seleção do álbum recebida", na hora com o app aberto ou pelo robô.
6. **Em "Ver seleção":**
   - **Criar pasta com as escolhidas no Drive:** copia só as fotos escolhidas para uma pasta nova dentro da pasta do cliente. No Drive, clique com o botão direito nela → **Fazer download** para baixar tudo em .zip.
   - **Copiar nomes (Lightroom):** copia a lista de nomes dos arquivos para filtrar no Lightroom.
   - **Marcar como baixado** → **Enviado para produção**.
7. Precisa que o cliente troque alguma foto? Em **Editar**, use **Reabrir para o cliente**.

Observações:
- Na galeria aparecem fotos **JPG/PNG**. Arquivos RAW não aparecem.
- Cole de novo o `firestore.rules` no Firebase, porque ele ganhou as regras dos álbuns.
- O link do cliente é secreto e difícil de adivinhar. Quem tiver o link consegue escolher fotos até a seleção ser enviada.
