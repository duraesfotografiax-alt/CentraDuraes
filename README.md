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
