# Usa immagine base Node.js ufficiale slim
FROM node:20-slim@sha256:12541e65a3777c6035245518eb43006ed08ca8c684e68cd04ecb4653bdf6cfe1

# Imposta la directory di lavoro
WORKDIR /usr/src/app

# Copia package.json e package-lock.json (se presente)
COPY package*.json ./


RUN npm install --omit=dev


COPY . .


RUN chown -R node:node /usr/src/app
USER node

# Espone la porta
ENV PORT=7860
EXPOSE ${PORT}

# Comando di avvio
CMD ["node", "index.js"]
