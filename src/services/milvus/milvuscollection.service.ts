import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node';
import { AppConfService, TextbaseNestjsConfiguration } from 'src/configuration';

export class MilvusCollection {

    public milvus : MilvusClient

    static readonly EMBEDDING = 'embedding';
    static readonly SHA256 = 'sha256';
    static readonly URL: string = 'url';

    constructor(
      public colname: string, 
      protected conf: TextbaseNestjsConfiguration) {
        this.milvus = new MilvusClient({
            logLevel:  'info',
            address: conf.miniMilvus,
          });
    }

    /**
     * @param vectorDim 384 is the dim for all_mini model embeddings dim
     */
    async create(vectorDim = 384) {
      
        return await this.milvus.createCollection({collection_name: this.colname,
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
                  dim: vectorDim,
                },
              ],
            });
    }

    async drop() {
        return await this.milvus.dropCollection({
          collection_name: this.colname
        });
    }

    async insert(data) {
      this.milvus.insert({
        collection_name: this.colname,
        data: data
      })
    }

    async upsert() {
      this.milvus.upsert({
        collection_name: this.colname,
      })
    }

    async count() {
      return this.milvus.count({collection_name: this.colname});
    }

    async load() {
      return this.milvus.loadCollection({ 
        collection_name: this.colname,
      } );
    }

    async getIdsPresentInDb(ids: string[]) : Promise<string[]> {
      const asTxt = ids.map(it => `'${it}'`).join(",");
      const expr = `${MilvusCollection.SHA256} in [ ${asTxt} ] `
      const resp = await this.milvus.query({ 
        collection_name: this.colname,
        expr: expr,
        output_fields:  [ MilvusCollection.SHA256 ]
      })

      return resp.data.map(it => it.sha256);
    }

    async createIndex() {
      await this.milvus.createIndex({
        collection_name: this.colname,
        index_name:'index',
        field_name: MilvusCollection.EMBEDDING,
        extra_params: {
        "index_type": "IVF_SQ8",
        "metric_type": "L2",
        "params": '{"nlist": "256"}'
      },
      });
    }

  async getCollectionStatistics() {
      return this.milvus.getCollectionStatistics({ collection_name:  this.colname })
  }

}

