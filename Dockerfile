# Usa una imagen base oficial de Node.js con Alpine Linux
FROM node:24-alpine

# Instala bash y OpenSSL (requerido por el motor nativo de Prisma) y tzdata
RUN apk add --no-cache bash openssl tzdata

# Establece el directorio de trabajo dentro del contenedor
WORKDIR /app

ENV TZ=America/Argentina/Buenos_Aires

# Copia package.json y package-lock.json
COPY package*.json ./

# Instala las dependencias de la aplicación
RUN npm install

# Copia el resto del código de la aplicación
COPY . .

# Genera el cliente Prisma
RUN npx prisma generate

# Copia el script de espera
COPY wait-for-it.sh /usr/local/bin/wait-for-it.sh
RUN chmod +x /usr/local/bin/wait-for-it.sh

# Expone el puerto en el que se ejecutará la aplicación
EXPOSE 3000

# Comando para ejecutar la aplicación junto con la migración
CMD ["sh", "-c", "echo 'DATABASE_URL=' $DATABASE_URL && /usr/local/bin/wait-for-it.sh mysql:3306 -- sh -c 'npx prisma migrate deploy && npm start'"]
