import { Injectable } from "@nestjs/common";
import { TextbaseClient } from "./textbase_client.service";

@Injectable()
export class VectorizerService {

    constructor(protected tbc: TextbaseClient) {}

    vectorize(divId: number) {
        // console.log(4)
    }
}