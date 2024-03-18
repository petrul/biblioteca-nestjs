FROM node:lts

RUN mkdir -p /app
COPY dist/ /app/dist
COPY node_modules /app/node_modules

RUN useradd dockerapp -u 10001
USER 10001

EXPOSE 3000

WORKDIR /app
RUN node /app/dist/main
