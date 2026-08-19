import { CreateIndexParam, DataType, LoadState, MilvusClient, MutationResult, RowData } from '@zilliz/milvus2-sdk-node';
import { assert, log } from 'console';
import { VectorizerConfiguration } from 'src/configuration';
import { Content } from 'src/model/model';

export class MilvusCollection {

    public milvus : MilvusClient;

    static readonly EMBEDDING = 'embedding';
    static readonly SHA256 = 'sha256';
    static readonly URL: string = 'url';

    static readonly DIM_384 = 384;
    static readonly DIM_768 = 768;
    static readonly DIM_2560 = 2560;

    constructor(
      public name: string, 
      protected conf: VectorizerConfiguration,
      protected vectorDim: number = MilvusCollection.DIM_384) {
        this.milvus = new MilvusClient({
            logLevel:  'info',
            address: conf.miniMilvus,
          });
    }

    /**
     * @param vectorDim 
     *  384 is the dim for all_mini model embeddings dim
     *  768 is the dim for the all_mpnet
     */
    async create() {
      
        return await this.milvus.createCollection({collection_name: this.name,
            consistency_level: 'Eventually',

            fields: [
                {
                  name: MilvusCollection.SHA256,
                  description: 'Sha 256',
                  data_type: DataType.VarChar,
                  is_primary_key: true,
                  autoID: false,
                  max_length: 64,
                },
                {
                  name: MilvusCollection.URL,
                  description: 'url serving as identifier and source for the content',
                  data_type: DataType.VarChar,
                  max_length: 2500
                },
                
                {
                  name: MilvusCollection.EMBEDDING,
                  description: 'the actual vector',
                  data_type: DataType.FloatVector,
                  dim: this.vectorDim,
                },
              ],
            });
    }

    async unload() {
      return await this.milvus.releaseCollection({ collection_name: this.name });
    }
    
    async drop() {
      await this.unload();
      return await this.milvus.dropCollection({
        collection_name: this.name
      });
    }

    async insert(content: Content[]) {
      const data: RowData[] = content.map(it => { return {
        sha256: it.sha256,
        url: it.url,
        embedding: it.embedding
      }});

      return await this.milvus.insert({
        collection_name: this.name,
        data: data
      });
    }

    async upsert(content: Content[]) : Promise<MutationResult> {
      if (!content)
        return;

      const data: RowData[] = content.map(it => { return {
        sha256: it.sha256,
        url: it.url,
        embedding: it.embedding
      }});

      return await this.milvus.upsert({
        collection_name: this.name,
        data: data
      })
    }

    async count(): Promise<number> {
      return (await this.milvus.count({collection_name: this.name})).data;
    }

    async load() {
      return this.milvus.loadCollection({ 
        collection_name: this.name,
      } );
    }

    async findAll(output_fields = [MilvusCollection.SHA256]): Promise<any[]> {
      const resp = await this.milvus.query({ 
        collection_name: this.name,
        expr: `${MilvusCollection.SHA256} like '%'`,
        output_fields: output_fields
      });
      return resp.data;
  }

    async findById(ids: string[], outputFields = [ MilvusCollection.SHA256 ]) : Promise<Partial<Content>[]> {
      const idListAsTxt = ids.map(it => `'${it}'`).join(",");
      const expr = `${MilvusCollection.SHA256} in [ ${idListAsTxt} ] `
      const resp = await this.milvus.query({ 
        collection_name: this.name,
        expr: expr,
        output_fields: outputFields
      })

      const content: Partial<Content>[] = resp.data.map(it => { 
        const res: Partial<Content> = {};
        Object.assign(res, it);        
        return res;
      });

      return content;
    }

    /**
     * only upserts records that either do not exist at all (sha256 not present as id in 
     * the milvus collection), or whose url has changed.
     * Basically will filter out content from param whose sha256 AND url already exist in the db.
     */
    async upsertNewOrModified(content: Content[]) {
      assert(content != null);
      
      const newOrModified = await this.newOrModified(content);
      if (newOrModified.length != content.length) {
        log(`will only upsert ${newOrModified.length} new or modified out of ${content.length} total`);
      }
      return this.upsert(newOrModified);
    }

    async newOrModified(content: Content[]) : Promise<Content[]> {
      assert(content != null);
      const alreadyExisting = await this.findById(
        content.map(it => it.sha256), 
        [MilvusCollection.SHA256, MilvusCollection.URL]);
      const alreadyExistingIds = alreadyExisting.map(it => it.sha256);

      const newOrModified = content.filter(c => {
        const id = c.sha256;
        const url = c.url;
        assert (id != null);
        assert (url != null);

        const indexOfSha = alreadyExistingIds.indexOf(id);
        if (indexOfSha < 0)
          return true; // id not found so this is entirely new

        const extant = alreadyExisting[indexOfSha];
        assert (extant.sha256 != null);
        return (url != extant.url); // if urls do not match, this is modified
      });
      return newOrModified;
    }

    async createIndex() {
      await this.milvus.createIndex({
        collection_name: this.name,
        index_name:'index',
        field_name: MilvusCollection.EMBEDDING,
        extra_params: MilvusCollection.idx_ivfsq8_l2_256(),
      });
    }

  protected static idx_ivfsq8_l2_256() : CreateIndexParam {
    return {
      "index_type": "IVF_SQ8",
      "metric_type": "L2",
      "params": '{"nlist": "256"}'
    };
  }

  async getCollectionStatistics() {
      return this.milvus.getCollectionStatistics({ collection_name:  this.name })
  }

  async flush() {
    return await this.milvus.flush({collection_names: [this.name]})
  }

  async exists() {
    const resp = await this.milvus.hasCollection({
      collection_name: this.name,
    });
    return resp.value;
  }

  async createIfNotExists() {
        // if not created, create
        if (! await this.exists()) {
          await this.create();
          await this.createIndex();
        }    
  }

  async createAndLoadIfNotExists() {
    await this.createIfNotExists();

    // if not loaded, load
    const state = await this.milvus.getLoadState({collection_name: this.name});
    if (state.state == LoadState.LoadStateNotLoad || state.state == LoadState.LoadStateNotExist) {
      return await this.load();
    }
    
  }

  async compact() {
    return await this.milvus.compact({
      collection_name: this.name
    });
  }

}

