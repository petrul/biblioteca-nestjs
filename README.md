
Textbase NestJS is part of the Textbase server.
aka Textbase Vectorizer

It is written in Typescript/NestJS. Works with node 18.

- its function is to basically 'vectorize' Textbase content using transformers and stores results in vector stores.

To do so, it listens to kafka topics and takes actions on some events like the import 
of a new opus in Textbase.

- swagger-typescript-api is the npm package used to generate the api.
Just run:
- $ ./gen-tb-api.sh
 in the project root directory. It will download the api json from the production server and 

## Run tests: 

$ npx jest


## Algorithm

On a new event we get the opus id, we get all the paragraphs.

For each chunk of paragraphs, identify those that have not been already stored by getting
the existing sha256's in the db. Those that are already uploaded will not be uploaded again.

Todo: 
- what happens when sha256 does not change but url does?
- several url's can have the same content. we don't really want to store the same vector multiple times. what do we do  ?
- some URLs may have disappeared, following often times the document's reorganization (stanzas reunited etc.) make sure TeiElems that are no longer are also removed from the Milvus db.
- if you move a paragraph into a subchapter (make it h3 instead of h2) -- only the URL changes. So the content and its sha256 stays the same but the URL should be updated (otherwise it will even become stale, pointing to nothing in reality)
-  a second case would be that of a paragraph which is duplicate.
-  upsert on sha256 is maybe the best case.

So maybe the following algorithms:
-  a check on both sha256 url and url -- those records need not be touched. 
-  where only sha256 is the same, the url gets updated
-  otherwise, insert.
-  