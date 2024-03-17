Textbase NestJS is part of the Textbase server.

It is written in Typescript/NestJS. Works with node 18.

- its function is to basically 'index' Textbase content using transformers and stores results in vector stores.

To do so, it listens to kafka topics and takes actions on some events like the import 
of a new opus in Textbase.

- swagger-typescript-api is the package used to generate the api.
Just run:
- $ ./gen-tb-api.sh
 in the project root directory. It will download the api json from the production server and 

## Algorithm

On a new event we get the opus id, we get all the paragraphs.

For each chunk of paragraphs, identify those that have not been already stored by getting
the existing sha256's in the db. Those that are already uploaded will not be uploaded again.

Todo: 
- what happens when sha256 does not change but url does?
- several url's can have the same content. we don't really want to store the same vector multiple times. what do we do  ?
- some URLs may have disappeared, following often times the document's reorganization (stanzas reunited etc.) make sure TeiElems that are no longer are also removed from the Milvus db.