/*
https://docs.nestjs.com/providers#services
*/

import { Injectable } from '@nestjs/common';
import { DataType, MilvusClient } from '@zilliz/milvus2-sdk-node';

export class MilvusCollection {

    milvusClient : MilvusClient

    constructor(public colname: string) {
        this.milvusClient = new MilvusClient({
            address: 'mini:19530',
            // username: 'username',
            // password: 'Aa12345!!',
          });
    }

    async create() {
        return await this.milvusClient.createCollection({collection_name: this.colname,
            fields: [
                {
                  name: 'age',
                  description: 'ID field',
                  data_type: DataType.Int64,
                  is_primary_key: true,
                  autoID: true,
                },
                {
                  name: 'vector',
                  description: 'Vector field',
                  data_type: DataType.FloatVector,
                  dim: 8,
                },
                { name: 'height', description: 'int64 field', data_type: DataType.Int64 },
                {
                  name: 'name',
                  description: 'VarChar field',
                  data_type: DataType.VarChar,
                  max_length: 128,
                },
              ],
            });
    }

    async drop() {
        return await this.milvusClient.dropCollection({collection_name: this.colname});
    }
}
