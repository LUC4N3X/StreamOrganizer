<!-- =================== STREAMORDER - CYBERPUNK README =================== -->
<div align="center" style="margin-bottom:40px; padding-top: 20px;">

<!-- Glitch Effect Styles -->
<style>
  @keyframes glitch-1 {
    0%,14%,15%,49%,50%,99%,100% { 
      text-shadow: 0.05em 0 0 #00fffc, -0.05em -0.025em 0 #fc00ff, 0.025em 0.05em 0 #fffc00; 
    }
    15% { 
      text-shadow: -0.05em -0.025em 0 #00fffc, 0.025em 0.025em 0 #fc00ff, -0.025em -0.05em 0 #fffc00; 
    }
    50% { 
      text-shadow: 0.025em 0.05em 0 #00fffc, 0.05em 0 0 #fc00ff, 0 -0.05em 0 #fffc00; 
    }
  }

  @keyframes glitch-2 {
    0%,14%,15%,49%,50%,99%,100% { 
      text-shadow: -0.05em -0.025em 0 #00fffc, 0.025em 0.05em 0 #fc00ff, -0.025em -0.025em 0 #fffc00; 
    }
    16% { 
      text-shadow: 0.05em 0.025em 0 #00fffc, -0.05em -0.05em 0 #fc00ff, 0.05em 0.05em 0 #fffc00; 
    }
    50% { 
      text-shadow: -0.025em 0 0 #00fffc, 0 -0.05em 0 #fc00ff, -0.05em -0.05em 0 #fffc00; 
    }
  }

  .glitch {
    font-family: 'Courier New', 'Lucida Console', monospace;
    font-size: 4.5em;
    font-weight: 900;
    text-transform: uppercase;
    position: relative;
    display: inline-block;
    text-shadow: 0.05em 0 0 #00fffc, -0.05em -0.025em 0 #fc00ff, 0.025em 0.05em 0 #fffc00;
    animation: glitch-1 2.5s infinite;
    color: #ff00ff;
    letter-spacing: 10px;
  }

  .glitch span {
    position: absolute;
    top: 0;
    left: 0;
  }

  .glitch span:first-child {
    animation: glitch-2 1.8s infinite;
    clip-path: polygon(0 0, 100% 0, 100% 45%, 0 45%);
    transform: translate(-0.035em, -0.015em);
    opacity: 0.8;
  }

  .glitch span:last-child {
    animation: glitch-2 2.1s infinite reverse;
    clip-path: polygon(0 55%, 100% 55%, 100% 100%, 0 100%);
    transform: translate(0.035em, 0.01em);
    opacity: 0.8;
  }

  .neon-subtitle {
    color: #e0d4ff;
    text-shadow: 0 0 10px #ff00ff, 0 0 20px #ff00ff;
    font-size: 1.5em;
    margin-top: -10px;
    letter-spacing: 5px;
  }

  .terminal {
    background: #000;
    border: 3px solid #ff00ff;
    border-radius: 12px;
    padding: 25px;
    margin: 35px auto;
    width: 85%;
    max-width: 900px;
    box-shadow: 0 0 40px rgba(255, 0, 255, 0.8), inset 0 0 20px rgba(255,0,255,0.2);
    text-align: left;
    font-family: 'Courier New', monospace;
    backdrop-filter: blur(5px);
  }

  .terminal-text {
    color: #00ffcc;
    line-height: 1.8;
    font-size: 1.1em;
  }

  .prompt {
    color: #ff00ff;
    font-weight: bold;
  }
</style>

  <!-- Main Glitch Title -->
  <h1 class="glitch">
    <span>STREAMORDER</span>
    STREAMORDER
    <span>STREAMORDER</span>
  </h1>

  <!-- Subtitle -->
  <p class="neon-subtitle">
    ⬢⬢⬢ CYBERDECK ADDON CONSOLE ⬢⬢⬢
  </p>

  <p style="color:#ff99ff; font-size:1.6em; margin-top:10px; text-shadow: 0 0 20px #ff00ff;">
    <strong>Control your Stremio Addons with style & precision</strong>
  </p>

  <!-- Banner Wave Ultra Cyberpunk -->
  <img src="https://capsule-render.vercel.app/api?type=wave&color=gradient&customColorList=6,2,2&height=200&section=header&text=STREAMORDER&fontSize=70&fontColor=ffffff&animation=twinkling&desc=CYBERPUNK%20STREMIO%20ADDON%20CONSOLE&descAlignY=75&fontAlignY=38" 
       alt="Cyberpunk Wave Banner" 
       style="border-radius:15px;margin-top:25px;box-shadow:0 0 50px rgba(255,0,255,0.6);" />

  <!-- Badges -->
  <div style="margin-top:30px;">
    ![Version](https://img.shields.io/badge/Version-1.0.0-ff00ff?style=for-the-badge&logo=stremio&logoColor=white)
    ![Status](https://img.shields.io/badge/Status-OPERATIONAL-00ff00?style=for-the-badge)
    ![Theme](https://img.shields.io/badge/Theme-CYBERPUNK%202077-ff00ff?style=for-the-badge&logoColor=white)
    ![Interface](https://img.shields.io/badge/Interface-TERMINAL%20DECK-00ffff?style=for-the-badge)
    ![Security](https://img.shields.io/badge/Security-NO%20CORPO%20TRACKERS-red?style=for-the-badge&logoColor=white)
    ![Ready](https://img.shields.io/badge/Jack%20In-READY-cyan?style=for-the-badge&logo=hackthebox)
  </div>

  <!-- Motto -->
  <blockquote style="color:#00ffff; font-style:italic; font-size:1.5em; margin-top:30px; text-shadow: 0 0 25px #00ffff; background:rgba(0,255,255,0.1); padding:20px; border-left:5px solid #ff00ff; border-radius:10px;">
    "Control the chaos. Rule your streams. Zero the corps."
  </blockquote>

  <!-- Terminal Demo -->
  <div class="terminal">
    <pre class="terminal-text">
<span class="prompt">$</span> streamorder --init-cyberdeck
<span style="color:#ff00ff;">[NEURO-LINK ESTABLISHED]</span> Cyberdeck v1.0.0 online
<span style="color:#00ff00;">[+]</span> Scanning addon manifest... <span style="color:#ff00ff;">47</span> addons detected
<span style="color:#00ff00;">[+]</span> Torrentio        █████████▒ 98% stable
<span style="color:#00ff00;">[+]</span> Orion            ██████████ 100%
<span style="color:#00ff00;">[+]</span> Comet            ███████▒▒▒ 78%
<span style="color:#ff00ff;">[WARNING]</span> Debrid service: <span style="color:#00ff00;">ACTIVE</span> (Real-Debrid detected)
<span style="color:#00ffff;">Ready, choom. Type</span> <span style="color:#ff00ff;">help</span> <span style="color:#00ffff;">for commands</span>
<span class="prompt">$</span> _</pre>
  </div>

  <p style="margin-top:35px; color:#ff00ff; font-size:1.3em; text-shadow: 0 0 20px #ff00ff;">
    <strong>» Jack in. Take control. Stream without limits. «</strong>
  </p>

</div>


<!-- =================== /HEADER README CYBERPUNK =================== -->

---

## 💠 Cos’è StreamOrder?

> 🕹️ **StreamOrder** è una **Command Console Cyberpunk** per la gestione avanzata degli **addon Stremio**.  
> Interfaccia **neon**, **drag & drop**, **backup automatici**, **sincronizzazione cloud** e **controllo totale** sul tuo ecosistema addon.  
> Ideata per chi ama **ordine, potenza e stile futuristico** 

---

## ⚙️ Funzionalità Principali

- ✨ **Gestione Addon Totale** – Installa, aggiorna o disinstalla in un click  
- 💾 **Backup & Sync** – Backup automatici e ripristino cloud  
- 🖱️ **Drag & Drop Interface** – Riordina visivamente gli addon  
- 🔗 **Smart Share System** – Condividi URL o QR code delle tue liste  
- 🌌 **Cyberpunk UI** – Effetti neon, blur e dettagli terminal-style  
- 🖥️ **Matrix Mode** – Modalità linea di comando per utenti avanzati  
- 📜 **Realtime Logs** – Log in tempo reale con colori neon
- 📡 **Diagnostica Addon** (Ping Test) – Controlla la latency e la disponibilità dei tuoi addon in tempo reale ⚡
---
<div align="center" style="background:linear-gradient(135deg,#0a0014,#130022);border-radius:12px;padding:25px;margin:20px 0;box-shadow:0 0 25px rgba(255,0,255,0.4), 0 0 10px rgba(100,0,255,0.2) inset;">
<h1 style="font-size:2.8em;color:#ff00ff;margin:0;font-family:'Orbitron', sans-serif;text-shadow:0 0 8px #ff00ff;">
    <span style="display:inline-block;transform:rotate(-10deg);margin-right:10px;">🛡️</span> Architettura di Sicurezza <span style="display:inline-block;transform:rotate(10deg);margin-left:10px;">🔒</span>
</h1>
  <p style="color:#e0d4ff;font-size:1.2em;margin:15px 0 0 0;font-family:'Roboto Mono', monospace;">
    "Blindiamo il tuo accesso, proteggiamo il tuo flusso." 🚀
  </p>
  <p style="margin-top:20px;">
    <img src="https://img.shields.io/badge/Secure-Fortified-green?style=for-the-badge&logo=shield" alt="Security Status: Fortified" />
    <img src="https://img.shields.io/badge/Privacy-Enhanced-blueviolet?style=for-the-badge&logo=spyder" alt="Privacy Status: Enhanced" />
    <img src="https://img.shields.io/badge/Compliance-Strict-red?style=for-the-badge&logo=gitea" alt="Compliance: Strict" />
  </p>
  <ul style="text-align:left;color:#e0d4ff;font-size:1.05em;list-style-type:none;padding:0;margin-top:25px;line-height:1.6;">
    <li style="margin-bottom:10px;">
      ✨ <strong>Cookie Ultra-Sicuri:</strong> La tua AuthKey è blindata in cookie HttpOnly, crittografati e con <code style="background-color:#330055;padding:3px 6px;border-radius:4px;font-family:monospace;">SameSite=Strict</code>, garantendo che non possano essere letti o inviati da script malevoli esterni.
    </li>
    <li style="margin-bottom:10px;">
      ⚡ <strong>Anti-DDoS & Rate Limiting:</strong> Difese avanzate contro attacchi brute-force e DoS. Login e API sensibili sono protetti da limiti di richieste per salvaguardare la disponibilità del servizio.
    </li>
    <li style="margin-bottom:10px;">
      ⚙️ <strong>Hardening degli Header HTTP (Helmet + CSP):</strong> Un set robusto di header HTTP, inclusa una <code style="background-color:#330055;padding:3px 6px;border-radius:4px;font-family:monospace;">Content Security Policy (CSP)</code> senza compromessi, per protezione attiva da XSS, clickjacking e altre injection.
    </li>
    <li style="margin-bottom:10px;">
      🔐 <strong>Sanificazione Profonda Input:</strong> Ogni dato in ingresso viene scrupolosamente validato e sanificato (con limiti di dimensione e profondità) per prevenire XSS, injection e sovraccarichi ricorsivi.
    </li>
    <li style="margin-bottom:10px;">
      🚫 <strong>Protezione SSRF Avanzata:</strong> Gli URL esterni vengono risolti e validati con rigore anti-SSRF, bloccando richieste a indirizzi IP privati o server interni, con verifica di Content-Type e Content-Length per prevenire attacchi TOCTOU DNS.
    </li>
    <li style="margin-bottom:10px;">
      🛡️ <strong>Difesa CSRF Aggiuntiva:</strong> Per le operazioni critiche, oltre ai cookie <code style="background-color:#330055;padding:3px 6px;border-radius:4px;font-family:monospace;">SameSite=Strict</code>, viene verificato l'header <code style="background-color:#330055;padding:3px 6px;border-radius:4px;font-family:monospace;">Origin</code> (o <code style="background-color:#330055;padding:3px 6px;border-radius:4px;font-family:monospace;">Referer</code>) per garantire che le richieste provengano solo da origini autorizzate.
    </li>
    <li style="margin-bottom:10px;">
      👻 <strong>Zero Data Leak:</strong> Token e credenziali restano sul server, mai esposti al client. Il logging è stato minimizzato per registrare solo errori essenziali e stack trace (in dev), garantendo che nessun dato sensibile finisca nei log pubblici.
    </li>
    <li style="margin-bottom:10px;">
      🔑 <strong>Validazione Manifesto Esterno:</strong> I manifest degli addon esterni sono validati tramite uno schema Joi dettagliato, assicurando integrità e formato atteso prima di essere processati.
    </li>
  </ul>
  <p style="color:#ff66ff;font-weight:bold;margin-top:20px;font-size:1.1em;text-shadow:0 0 5px rgba(255,102,255,0.5);">
    ⚠️ <strong>Raccomandazione Critica:</strong> Utilizza StreamOrder <u>esclusivamente</u> su connessioni HTTPS sicure o in ambienti di sviluppo locali completamente affidabili.
  </p>
</div>

---

## 🧬 ​Modern Application Architecture 🧬

| Componente | Manifesto Tecnico |
| :--- | :--- |
| ⚡ **Node.js (Bionic Core)** | Il cuore asincrono. Runtime V8 ultra-ottimizzato per I/O non bloccante, scalabilità neurale e API a latenza zero. |
| 🌌 **Stremio Data Hub** | Gateway diretto alla matrice di contenuti. Gestione dinamica dei flussi e integrazione totale dell'ecosistema addon in *true real-time*. |
| 🔮 **Holo-Interface (HTML/CSS/JS)**| UI Cyberpunk reattiva. Effetti *neon-glitch*, animazioni "liquid metal" e DOM manipolato per un'esperienza olografica. |
| 🛰️ **Sync-Core (Edge/Cloud)** | Persistenza dati *always-on*. Sincronizzazione atomica tra il client (LocalStorage) e il cloud. La tua sessione è immortale. |
| 🔑 **Quantum-Lock (JWT)** | Sicurezza di livello militare. Sessioni stateless con token crittografati. Autorizzazioni granulari e protocolli anti-intrusione attivi H24. |
| 📡 **Neural Link (WebSockets/SSE)**| Flusso dati bidirezionale persistente. Interazioni live, notifiche *push* istantanee e data-streaming continuo. Latenza? Un concetto obsoleto. |
| 🧠 **Cognitive Search (Elastic)** | Indicizzazione neurale. Ricerca *instant-match* con filtri contestuali e IA predittiva. Trova prima ancora di aver cercato. |
| 📦 **Cyber-Factory (NPM/Yarn)** | L'arsenale del costruttore. Gestione atomica delle dipendenze, script di build automatizzati e *packaging* ottimizzato per il deployment. |
| 🔬 **Hyper-Debug Suite (DevTools)**| Debugging a livello molecolare. *Hot Module Replacement* (HMR) istantaneo, performance profiling in real-time e *time-travel debugging*. |


---

# 🚀 Installazione

### 🐳 Metodo **Docker** (🔥 Consigliato)

```bash
# 1️⃣ Clona il repository
git clone https://github.com/Luca1234105/StreamOrder.git
cd StreamOrder

# 2️⃣ Crea un file .env nella root del progetto
cat > .env <<EOL
GITHUB_TOKEN=la_tua_chiave_github
PORT=7860
EOL

# 3️⃣ Costruisci l'immagine Docker
docker build -t streamorder .

# 4️⃣ Avvia il container in background caricando le variabili d'ambiente
docker run -d -p 7860:7860 --env-file .env --name streamorder-app streamorder


```
📦 Deploy & Build Manuale (Senza Docker)
```bash
# 1️⃣ Clona il repository
git clone https://github.com/Luca1234105/StreamOrder.git
cd StreamOrder

# 2️⃣ Installa le dipendenze
npm install

# 3️⃣ Avvia StreamOrder in modalità sviluppo
npm start
```
<div align="center"> <table role="presentation" cellpadding="14" cellspacing="0" style="background:linear-gradient(135deg,#0a0014,#130022);border:1px solid rgba(187,134,252,0.4);border-radius:14px;box-shadow:0 0 20px rgba(187,134,252,0.3);width:80%;max-width:700px;"> <tr> <td align="center" style="color:#e0d4ff;font-family:Segoe UI,Arial,sans-serif;"> <p style="margin:0;font-size:1.1em;"> 🟢 <strong>Dopo l’avvio</strong>, StreamOrder sarà accessibile su:



👉 <a href="http://localhost:8080" style="color:#bb86fc;font-weight:bold;text-decoration:none;">http://localhost:8080</a> </p> </td> </tr> </table> </div> <div align="center"> <table role="presentation" cellpadding="14" cellspacing="0" style="background:linear-gradient(135deg,#0a0014,#130022);border:1px solid rgba(187,134,252,0.4);border-radius:14px;box-shadow:0 0 20px rgba(187,134,252,0.3);width:80%;max-width:700px;"> <tr> <td align="center" style="color:#e0d4ff;font-family:Segoe UI,Arial,sans-serif;"> <h3 style="margin-top:0;color:#bb86fc;">🌐 Oppure prova la versione online!</h3> <p style="margin:0;font-size:1.1em;"> 💻 <strong>Nessuna installazione necessaria!</strong>


Accedi subito alla versione web:



👉 <a href="https://lucadr-streamorganizer.hf.space" style="color:#7ee787;font-weight:bold;text-decoration:none;">StreamOrder Online su HuggingFace 🚀</a>



👉 <a href="https://stream-organizer.vercel.app" style="color:#7ee787;font-weight:bold;text-decoration:none;">StreamOrder Online su Vercel ⚡</a> </p> </td> </tr> </table> </div>

---
## 🧑‍💻 Crediti

<p align="center">
👨‍🚀 **Autore:** LUC4N3X  <br>
⚙️ **Progetto:** StreamOrder  <br>
💡 **Concept:** Cyberpunk Addon Console per Stremio  <br>
</p>

---

## ⚠️ Avviso Importante

> 🚨 **Disclaimer Legale:**  
> StreamOrder **non è un addon ufficiale di Stremio**.  
> L’uso improprio o eccessivo può causare problemi al tuo account Stremio o ai tuoi addon.  
> L’autore **non si assume alcuna responsabilità** per eventuali danni, sospensioni o perdita di dati derivanti dall’uso di questo software.

> ⚡ **Nota d’uso:**  
> Utilizza **StreamOrder** a tuo rischio e pericolo, solo per **scopi educativi** o di **testing locale**.




