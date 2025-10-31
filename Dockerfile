# Usa un'immagine base Node.js
FROM node:20-slim

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia i file di package e installa le dipendenze
COPY package.json ./
RUN npm install --omit=dev

# Copia il resto del codice (index.js, public/, ecc.)
COPY . .

# Espone la porta standard di Hugging Face
EXPOSE 7860 

# Comando di avvio dell'applicazione
CMD ["node", "index.js"]