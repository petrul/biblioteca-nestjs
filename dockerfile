FROM node:lts

RUN mkdir -p /app
COPY dist/ /app/dist
COPY node_modules /app/node_modules

WORKDIR /app
RUN node /app/dist/main
