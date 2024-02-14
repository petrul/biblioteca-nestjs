export class TeiDivDto {
    id: number;
    author: AuthorDto;
    path: string;
    urlFragment: string;
    head: string;
}

export class AuthorDto {
    strId: string;
    lastName: string;
    firstName: string;
    displayName: string;
}
