import { ContentDto } from "src/dto/dtos";

export interface ContentSource {
    getContentList(contentList: ContentDto[]);
}

