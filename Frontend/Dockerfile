# Frontend Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar código fuente
COPY . .

# Compilar proyecto Astro
RUN npm run build

# Exponer puerto
EXPOSE 3000

# Comando para iniciar
CMD ["npm", "run", "preview"]
