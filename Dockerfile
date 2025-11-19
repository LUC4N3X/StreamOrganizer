# Usa immagine base sicura
FROM node:20-slim@sha256:12541e65a3777c6035245518eb43006ed08ca8c684e68cd04ecb4653bdf6cfe1

WORKDIR /usr/src/app

COPY package*.json ./

# --- CORREZIONE FONDAMENTALE ---
# Installiamo TUTTE le dipendenze (anche quelle di sviluppo come Vite)
# altrimenti non possiamo costruire il frontend.
RUN npm install

COPY . .

# --- PASSAGGIO MANCANTE ---
# Costruiamo il frontend (compila il codice Vue in HTML/JS leggibile dal browser)
RUN npm run build

# Opzionale: rimuove i tool di sviluppo dopo il build per alleggerire (facoltativo ma consigliato)
# RUN npm prune --production

RUN chown -R node:node /usr/src/app
USER node

ENV PORT=7860
EXPOSE 7860

CMD ["node", "index.js"]
