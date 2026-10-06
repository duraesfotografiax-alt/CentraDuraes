// Dados do projeto Firebase "central-duraes" (não são senha; só identificam o projeto).
// Usa "self" para funcionar tanto na página quanto no service worker das notificações.
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBdYfzZVsBn884FG-0j1Bs1WUT2FF3PNrU",
  authDomain: "central-duraes.firebaseapp.com",
  projectId: "central-duraes",
  storageBucket: "central-duraes.firebasestorage.app",
  messagingSenderId: "534493994572",
  appId: "1:534493994572:web:1b823205c8901d827b1ee9"
};

// E-mail do dono (Adm principal). Precisa ser o MESMO que está no arquivo firestore.rules.
self.ADMIN_EMAIL = "duraesfotografiax@gmail.com";

// Chave de notificações (Firebase > Configurações do projeto > Cloud Messaging >
// Certificados push da Web > "Par de chaves"). Cole a chave pública aqui.
self.VAPID_KEY = "BFrDvo5YEjZpTtqG_mBTZzcDaACPcpdpATFg8WdV7tu3JGvvps4LJyGqhA3XL4L4Ae61myJ34Efq-Ecn-Ty7s2w";

// Google Drive: "ID do cliente OAuth" (Google Cloud > APIs e serviços > Credenciais). Veja o LEIA-ME.
self.GOOGLE_CLIENT_ID = "COLE_AQUI";
