FROM node:18-alpine

WORKDIR /usr/src/app

# Устанавливаем зависимости
COPY package*.json ./
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Делаем файлы доступными для пользователя node
RUN chown -R node:node /usr/src/app

# Порт, который слушает приложение
EXPOSE 3000

# Не запускаем от root для безопасности
USER node

# Запуск приложения
CMD [ "node", "src/index.js" ]
