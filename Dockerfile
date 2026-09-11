FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

# Run as the non-root node user.
USER node

CMD ["node", "src/index.js"]
