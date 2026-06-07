# Frontend Dockerfile - Development mode
FROM node:18-alpine

WORKDIR /app

# Copy dependencies
COPY package*.json ./

# Install
RUN npm install

# Copy source
COPY . .

# Expose port
EXPOSE 3000

# Run dev server (Docker Compose will override with npm run dev)
CMD ["npm", "run", "dev"]
