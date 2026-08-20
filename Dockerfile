FROM node:lts

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY dist ./dist
COPY node_modules ./node_modules

USER node
EXPOSE 3000

ENTRYPOINT ["node", "dist/main.js"]
