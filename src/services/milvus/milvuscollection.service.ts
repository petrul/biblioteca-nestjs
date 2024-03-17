import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node';

export class MilvusCollection {

    public milvus : MilvusClient

    static readonly EMBEDDINGS = 'embeddings';
    static readonly SHA256 = 'sha256';
    static readonly URL: string = 'url';

    constructor(public colname: string) {
        this.milvus = new MilvusClient({
            logLevel:  'info',
            address: 'mini:19530',
          });
    }

    async create() {
      
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
                  name: MilvusCollection.EMBEDDINGS,
                  description: 'VarChar field',
                  data_type: DataType.FloatVector,
                  dim: 384,
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
        field_name: MilvusCollection.EMBEDDINGS,
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

