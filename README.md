Textbase NestJS is part of the Textbase server.

It is written in Typescript/NestJS. Works with node 18.

- its function is to basically 'index' Textbase content using transformers and stores results in vector stores.

To do so, it listens to kafka topics and takes actions on some events like the import 
of a new opus in Textbase.

- swagger-typescript-api is the package used to generate the api.
Just run:
- $ ./gen-tb-api.sh
 in the project root directory. It will download the api json from the production server and 

## Description


