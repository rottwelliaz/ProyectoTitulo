# Backend Dockerfile
FROM node:18-bullseye-slim

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends openssl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Copiar archivos de dependencias
COPY package*.json ./
COPY prisma ./prisma

# Instalar dependencias
RUN npm install

# Generar cliente Prisma
RUN npx prisma generate

# Copiar código fuente
COPY . .

# Exponer puerto
EXPOSE 3001

# Comando para iniciar
CMD ["npm", "start"]
