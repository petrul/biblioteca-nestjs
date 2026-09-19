/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/*
 * ---------------------------------------------------------------
 * ## THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API        ##
 * ##                                                           ##
 * ## AUTHOR: acacode                                           ##
 * ## SOURCE: https://github.com/acacode/swagger-typescript-api ##
 * ---------------------------------------------------------------
 */

export interface AbstractJsonSchemaPropertyObject {
  title?: string;
  readOnly?: boolean;
}

export interface Item {
  type?: string;
  properties?: Record<string, AbstractJsonSchemaPropertyObject>;
  requiredProperties?: string[];
}

export interface JsonSchema {
  title?: string;
  description?: string;
  properties?: Record<string, AbstractJsonSchemaPropertyObject>;
  requiredProperties?: string[];
  definitions?: Record<string, Item>;
  type?: string;
  $schema?: string;
}

export interface RepresentationModelObject {
  _links?: Links;
}

export interface Author {
  /** @format int64 */
  id?: number;
  strId?: string;
  lastName?: string;
  firstName?: string;
  displayName?: string;
  avatar?: {
    binaryStream?: any;
  };
  visualName?: string;
  anonymous?: boolean;
}

export interface EntityModelTeiElem {
  xpath?: string;
  lang?:
    | "BG"
    | "BR"
    | "CA"
    | "DA"
    | "DE"
    | "EN"
    | "ES"
    | "FI"
    | "FR"
    | "GR"
    | "HU"
    | "IT"
    | "LA"
    | "NL"
    | "NO"
    | "PT"
    | "RO"
    | "RU"
    | "ZH";
  name?: string;
  /** @format int32 */
  nth?: number;
  /**
   * @minLength 0
   * @maxLength 100
   */
  urlFragment?: string;
  /** @format byte */
  txtSha256?: Blob;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  leaf?: boolean;
  author?: Author;
  completePath?: string;
  _links?: Links;
}

export interface PageMetadata {
  /** @format int64 */
  size?: number;
  /** @format int64 */
  totalElements?: number;
  /** @format int64 */
  totalPages?: number;
  /** @format int64 */
  number?: number;
}

export interface PagedModelEntityModelTeiElem {
  _embedded?: {
    teiElems?: EntityModelTeiElem[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface EntityModelAuthor {
  /** @format int64 */
  id?: number;
  strId?: string;
  lastName?: string;
  firstName?: string;
  displayName?: string;
  avatar?: {
    binaryStream?: any;
  };
  visualName?: string;
  anonymous?: boolean;
  _links?: Links;
}

export interface PagedModelEntityModelAuthor {
  _embedded?: {
    authors?: EntityModelAuthor[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface CollectionModelEntityModelAuthor {
  _embedded?: {
    authors?: EntityModelAuthor[];
  };
  _links?: Links;
}

export interface EntityModelTeiDiv {
  /** @format int64 */
  id?: number;
  xpath?: string;
  lang?:
    | "BG"
    | "BR"
    | "CA"
    | "DA"
    | "DE"
    | "EN"
    | "ES"
    | "FI"
    | "FR"
    | "GR"
    | "HU"
    | "IT"
    | "LA"
    | "NL"
    | "NO"
    | "PT"
    | "RO"
    | "RU"
    | "ZH";
  name?: string;
  /** @format int32 */
  nth?: number;
  /**
   * @minLength 0
   * @maxLength 100
   */
  urlFragment?: string;
  /** @format byte */
  txtSha256?: Blob;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  /**
   * @minLength 0
   * @maxLength 3000
   */
  head?: string;
  leaf?: boolean;
  author?: Author;
  completePath?: string;
  _links?: Links;
}

export interface TeiDiv {
  /** @format int64 */
  id?: number;
  xpath?: string;
  lang?:
    | "BG"
    | "BR"
    | "CA"
    | "DA"
    | "DE"
    | "EN"
    | "ES"
    | "FI"
    | "FR"
    | "GR"
    | "HU"
    | "IT"
    | "LA"
    | "NL"
    | "NO"
    | "PT"
    | "RO"
    | "RU"
    | "ZH";
  name?: string;
  /** @format int32 */
  nth?: number;
  /**
   * @minLength 0
   * @maxLength 100
   */
  urlFragment?: string;
  /** @format byte */
  txtSha256?: Blob;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  /**
   * @minLength 0
   * @maxLength 3000
   */
  head?: string;
  leaf?: boolean;
  author?: Author;
  completePath?: string;
}

export interface PagedModelEntityModelTeiDiv {
  _embedded?: {
    teiDivs?: EntityModelTeiDiv[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface CollectionModelEntityModelTeiDiv {
  _embedded?: {
    teiDivs?: EntityModelTeiDiv[];
  };
  _links?: Links;
}

export interface TeiFile {
  /** @format int64 */
  id?: number;
  filename?: string;
  /**
   * @minLength 0
   * @maxLength 1000
   */
  title?: string;
  authors?: Author[];
  language?:
    | "BG"
    | "BR"
    | "CA"
    | "DA"
    | "DE"
    | "EN"
    | "ES"
    | "FI"
    | "FR"
    | "GR"
    | "HU"
    | "IT"
    | "LA"
    | "NL"
    | "NO"
    | "PT"
    | "RO"
    | "RU"
    | "ZH";
  repoName?: string;
  /** @format date-time */
  timestamp?: string;
  author?: Author;
}

export interface RegisterRequest {
  username?: string;
  password?: string;
}

export interface CreateCollectionRequest {
  name?: string;
}

export interface DivCollectionDto {
  /** @format int64 */
  id?: number;
  name?: string;
  /** @format date-time */
  createdAt?: string;
  items?: DivCollectionItemDto[];
  favorites?: boolean;
}

export interface DivCollectionItemDto {
  /** @format int64 */
  id?: number;
  kind?: string;
  divPath?: string;
  divHead?: string;
  fragmentStart?: string;
  fragmentEnd?: string;
  fragmentText?: string[];
  /** @format date-time */
  addedAt?: string;
}

export interface AddItemRequest {
  type?: string;
  path?: string;
  start?: string;
  end?: string;
}

export interface HitDto {
  type?: string;
  url?: string;
  /** @format float */
  score?: number;
  content?: string;
  data?: any;
}

export interface Hits {
  data?: HitsDto;
  page?: PagingDto;
}

export interface HitsDto {
  hits?: HitDto[];
}

export interface PagingDto {
  /** @format int32 */
  size?: number;
  /** @format int32 */
  totalElements?: number;
  /** @format int32 */
  totalPages?: number;
  /** @format int32 */
  number?: number;
}

export interface TeiElemDto {
  /** @format int64 */
  id?: number;
  parent?: TeiElemDto;
  name?: string;
  path?: string;
  xpath?: string;
  urlFragment?: string;
  url?: string;
  text?: string;
  text_sha256?: string;
  language?: string;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
}

export interface AuthorDto {
  strId?: string;
  lastName?: string;
  firstName?: string;
  displayName?: string;
  description?: string;
  opera?: OpusDto[];
  image_href?: string;
}

export interface OpusDto {
  /** @format int64 */
  id?: number;
  parent?: TeiElemDto;
  name?: string;
  path?: string;
  xpath?: string;
  urlFragment?: string;
  url?: string;
  text?: string;
  text_sha256?: string;
  language?: string;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  head?: string;
  /** @format int32 */
  depth?: number;
  author?: any;
  leaf?: boolean;
  opus?: boolean;
  authors?: AuthorDto[];
}

export interface TeiDivDto {
  /** @format int64 */
  id?: number;
  parent?: TeiElemDto;
  name?: string;
  path?: string;
  xpath?: string;
  urlFragment?: string;
  url?: string;
  text?: string;
  text_sha256?: string;
  language?: string;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  head?: string;
  /** @format int32 */
  depth?: number;
  children?: TeiDivDto[];
  author?: AuthorDto;
  leaf?: boolean;
  opus?: boolean;
}

export interface Embedder {
  model?: string;
  /** @format int32 */
  dimension?: number;
  description?: string;
  ollamaModel?: string;
  host?: string;
  /** @format int32 */
  port?: number;
}

export interface Kafka {
  newOpusImportedTopic?: string;
  opusReimportedTopic?: string;
  opusRemovedTopic?: string;
}

export interface Milvus {
  collection?: string;
}

export interface SharedConfigDto {
  kafka?: Kafka;
  milvus?: Milvus;
  embedder?: Embedder;
}

export interface Link {
  href?: string;
  hreflang?: string;
  title?: string;
  type?: string;
  deprecation?: string;
  profile?: string;
  name?: string;
  templated?: boolean;
}

export type Links = Record<string, Link>;

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, "body" | "bodyUsed">;

export interface FullRequestParams extends Omit<RequestInit, "body"> {
  /** set parameter to `true` for call `securityWorker` for this request */
  secure?: boolean;
  /** request path */
  path: string;
  /** content type of request body */
  type?: ContentType;
  /** query params */
  query?: QueryParamsType;
  /** format of response (i.e. response.json() -> format: "json") */
  format?: ResponseFormat;
  /** request body */
  body?: unknown;
  /** base url */
  baseUrl?: string;
  /** request cancellation token */
  cancelToken?: CancelToken;
}

export type RequestParams = Omit<
  FullRequestParams,
  "body" | "method" | "query" | "path"
>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, "baseUrl" | "cancelToken" | "signal">;
  securityWorker?: (
    securityData: SecurityDataType | null,
  ) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown>
  extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = "application/json",
  JsonApi = "application/vnd.api+json",
  FormData = "multipart/form-data",
  UrlEncoded = "application/x-www-form-urlencoded",
  Text = "text/plain",
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = "/";
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>["securityWorker"];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) =>
    fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: "same-origin",
    headers: {},
    redirect: "follow",
    referrerPolicy: "no-referrer",
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === "number" ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join("&");
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter(
      (key) => "undefined" !== typeof query[key],
    );
    return keys
      .map((key) =>
        Array.isArray(query[key])
          ? this.addArrayQueryParam(query, key)
          : this.addQueryParam(query, key),
      )
      .join("&");
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : "";
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.JsonApi]: (input: any) =>
      input !== null && (typeof input === "object" || typeof input === "string")
        ? JSON.stringify(input)
        : input,
    [ContentType.Text]: (input: any) =>
      input !== null && typeof input !== "string"
        ? JSON.stringify(input)
        : input,
    [ContentType.FormData]: (input: any) => {
      if (input instanceof FormData) {
        return input;
      }

      return Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === "object" && property !== null
              ? JSON.stringify(property)
              : `${property}`,
        );
        return formData;
      }, new FormData());
    },
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(
    params1: RequestParams,
    params2?: RequestParams,
  ): RequestParams {
    return {
      ...this.baseApiParams,
      ...params1,
      ...(params2 || {}),
      headers: {
        ...(this.baseApiParams.headers || {}),
        ...(params1.headers || {}),
        ...((params2 && params2.headers) || {}),
      },
    };
  }

  protected createAbortSignal = (
    cancelToken: CancelToken,
  ): AbortSignal | undefined => {
    if (this.abortControllers.has(cancelToken)) {
      const abortController = this.abortControllers.get(cancelToken);
      if (abortController) {
        return abortController.signal;
      }
      return void 0;
    }

    const abortController = new AbortController();
    this.abortControllers.set(cancelToken, abortController);
    return abortController.signal;
  };

  public abortRequest = (cancelToken: CancelToken) => {
    const abortController = this.abortControllers.get(cancelToken);

    if (abortController) {
      abortController.abort();
      this.abortControllers.delete(cancelToken);
    }
  };

  public request = async <T = any, E = any>({
    body,
    secure,
    path,
    type,
    query,
    format,
    baseUrl,
    cancelToken,
    ...params
  }: FullRequestParams): Promise<HttpResponse<T, E>> => {
    const secureParams =
      ((typeof secure === "boolean" ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(
      `${baseUrl || this.baseUrl || ""}${path}${queryString ? `?${queryString}` : ""}`,
      {
        ...requestParams,
        headers: {
          ...(requestParams.headers || {}),
          ...(type && type !== ContentType.FormData
            ? { "Content-Type": type }
            : {}),
        },
        signal:
          (cancelToken
            ? this.createAbortSignal(cancelToken)
            : requestParams.signal) || null,
        body:
          typeof body === "undefined" || body === null
            ? null
            : payloadFormatter(body),
      },
    ).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const responseToParse = responseFormat ? response.clone() : response;
      const data = !responseFormat
        ? r
        : await responseToParse[responseFormat]()
            .then((data) => {
              if (r.ok) {
                r.data = data;
              } else {
                r.error = data;
              }
              return r;
            })
            .catch((e) => {
              r.error = e;
              return r;
            });

      if (cancelToken) {
        this.abortControllers.delete(cancelToken);
      }

      if (!response.ok) throw data;
      return data;
    });
  };
}

/**
 * @title No title
 * @baseUrl /
 */
export class Api<
  SecurityDataType extends unknown,
> extends HttpClient<SecurityDataType> {
  api = {
    /**
     * @description get-author
     *
     * @tags author-entity-controller
     * @name GetCollectionResourceAuthorGet
     * @request GET:/api/drest/authors
     */
    getCollectionResourceAuthorGet: (
      query?: {
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelAuthor, any>({
        path: `/api/drest/authors`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet
     * @request GET:/api/drest/authors/search/findByFirstNameContainingIgnoreCase
     */
    executeSearchAuthorGet: (
      query?: {
        excerpt?: string;
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByFirstNameContainingIgnoreCase`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet1
     * @request GET:/api/drest/authors/search/findByLastNameContainingIgnoreCase
     */
    executeSearchAuthorGet1: (
      query?: {
        excerpt?: string;
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByLastNameContainingIgnoreCase`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet2
     * @request GET:/api/drest/authors/search/findByLastNameIgnoreCase
     */
    executeSearchAuthorGet2: (
      query?: {
        excerpt?: string;
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByLastNameIgnoreCase`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet3
     * @request GET:/api/drest/authors/search/findByOriginalNameInTeiFile
     */
    executeSearchAuthorGet3: (
      query?: {
        originalName?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByOriginalNameInTeiFile`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet4
     * @request GET:/api/drest/authors/search/findByStrId
     */
    executeSearchAuthorGet4: (
      query?: {
        strId?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByStrId`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet5
     * @request GET:/api/drest/authors/search/findByStrIdContainingIgnoreCase
     */
    executeSearchAuthorGet5: (
      query?: {
        strId?: string;
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByStrIdContainingIgnoreCase`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet6
     * @request GET:/api/drest/authors/search/getByOriginalNameInTeiFile
     */
    executeSearchAuthorGet6: (
      query?: {
        originalName?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<EntityModelAuthor, void>({
        path: `/api/drest/authors/search/getByOriginalNameInTeiFile`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet7
     * @request GET:/api/drest/authors/search/getByStrId
     */
    executeSearchAuthorGet7: (
      query?: {
        strId?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<EntityModelAuthor, void>({
        path: `/api/drest/authors/search/getByStrId`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet8
     * @request GET:/api/drest/authors/search/getTeiFiles
     */
    executeSearchAuthorGet8: (
      query?: {
        /** @format int64 */
        authorId?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/getTeiFiles`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description get-author
     *
     * @tags author-entity-controller
     * @name GetItemResourceAuthorGet
     * @request GET:/api/drest/authors/{id}
     */
    getItemResourceAuthorGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelAuthor, void>({
        path: `/api/drest/authors/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name ListAllFormsOfMetadata
     * @request GET:/api/drest/profile
     */
    listAllFormsOfMetadata: (params: RequestParams = {}) =>
      this.request<RepresentationModelObject, any>({
        path: `/api/drest/profile`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor
     * @request GET:/api/drest/profile/authors
     */
    descriptor: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/authors`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor1
     * @request GET:/api/drest/profile/teiDivs
     */
    descriptor1: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/teiDivs`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor2
     * @request GET:/api/drest/profile/teiElems
     */
    descriptor2: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/teiElems`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description get-teidiv
     *
     * @tags tei-div-entity-controller
     * @name GetCollectionResourceTeidivGet
     * @request GET:/api/drest/teiDivs
     */
    getCollectionResourceTeidivGet: (
      query?: {
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiDiv, any>({
        path: `/api/drest/teiDivs`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet
     * @request GET:/api/drest/teiDivs/search/findAllOpera
     */
    executeSearchTeidivGet: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findAllOpera`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet1
     * @request GET:/api/drest/teiDivs/search/findByHead
     */
    executeSearchTeidivGet1: (
      query?: {
        head?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByHead`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet2
     * @request GET:/api/drest/teiDivs/search/findByHeadContainingIgnoreCase
     */
    executeSearchTeidivGet2: (
      query?: {
        excerpt?: string;
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByHeadContainingIgnoreCase`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet3
     * @request GET:/api/drest/teiDivs/search/findByLang
     */
    executeSearchTeidivGet3: (
      query?: {
        lang?:
          | "BG"
          | "BR"
          | "CA"
          | "DA"
          | "DE"
          | "EN"
          | "ES"
          | "FI"
          | "FR"
          | "GR"
          | "HU"
          | "IT"
          | "LA"
          | "NL"
          | "NO"
          | "PT"
          | "RO"
          | "RU"
          | "ZH";
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByLang`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet4
     * @request GET:/api/drest/teiDivs/search/findByTeiFile
     */
    executeSearchTeidivGet4: (
      query?: {
        teiFile?: TeiFile;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByTeiFile`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet5
     * @request GET:/api/drest/teiDivs/search/findByTeiFileAndXpath
     */
    executeSearchTeidivGet5: (
      query?: {
        teiFile?: TeiFile;
        xpath?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByTeiFileAndXpath`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet6
     * @request GET:/api/drest/teiDivs/search/findByUrlFragmentAndParent
     */
    executeSearchTeidivGet6: (
      query?: {
        urlFragment?: string;
        parent?: TeiDiv;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByUrlFragmentAndParent`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet7
     * @request GET:/api/drest/teiDivs/search/findOpera
     */
    executeSearchTeidivGet7: (
      query?: {
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findOpera`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet8
     * @request GET:/api/drest/teiDivs/search/findOperaByLang
     */
    executeSearchTeidivGet8: (
      query?: {
        lang?:
          | "BG"
          | "BR"
          | "CA"
          | "DA"
          | "DE"
          | "EN"
          | "ES"
          | "FI"
          | "FR"
          | "GR"
          | "HU"
          | "IT"
          | "LA"
          | "NL"
          | "NO"
          | "PT"
          | "RO"
          | "RU"
          | "ZH";
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findOperaByLang`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet9
     * @request GET:/api/drest/teiDivs/search/findOperaForAuthorStrId
     */
    executeSearchTeidivGet9: (
      query?: {
        authorStrId?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findOperaForAuthorStrId`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet10
     * @request GET:/api/drest/teiDivs/search/getAuthors
     */
    executeSearchTeidivGet10: (
      query?: {
        /** @format int64 */
        id?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/getAuthors`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet11
     * @request GET:/api/drest/teiDivs/search/getByTeiFileAndXpath
     */
    executeSearchTeidivGet11: (
      query?: {
        teiFile?: TeiFile;
        xpath?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<EntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/getByTeiFileAndXpath`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet12
     * @request GET:/api/drest/teiDivs/search/getNrOfBottomDivs
     */
    executeSearchTeidivGet12: (params: RequestParams = {}) =>
      this.request<number, void>({
        path: `/api/drest/teiDivs/search/getNrOfBottomDivs`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet13
     * @request GET:/api/drest/teiDivs/search/getOperaForTeiFileId
     */
    executeSearchTeidivGet13: (
      query?: {
        /** @format int64 */
        teiFileId?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/getOperaForTeiFileId`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description get-teidiv
     *
     * @tags tei-div-entity-controller
     * @name GetItemResourceTeidivGet
     * @request GET:/api/drest/teiDivs/{id}
     */
    getItemResourceTeidivGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * @description get-teielem
     *
     * @tags tei-elem-entity-controller
     * @name GetCollectionResourceTeielemGet
     * @request GET:/api/drest/teiElems
     */
    getCollectionResourceTeielemGet: (
      query?: {
        /**
         * Zero-based page index (0..N)
         * @min 0
         * @default 0
         */
        page?: number;
        /**
         * The size of the page to be returned
         * @min 1
         * @default 20
         */
        size?: number;
        /** Sorting criteria in the format: property,(asc|desc). Default sort order is ascending. Multiple sort criteria are supported. */
        sort?: string[];
      },
      params: RequestParams = {},
    ) =>
      this.request<PagedModelEntityModelTeiElem, any>({
        path: `/api/drest/teiElems`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description get-teielem
     *
     * @tags tei-elem-entity-controller
     * @name GetItemResourceTeielemGet
     * @request GET:/api/drest/teiElems/{id}
     */
    getItemResourceTeielemGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiElem, void>({
        path: `/api/drest/teiElems/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags user-rest-controller
     * @name Register
     * @request POST:/api/users/register
     */
    register: (data: RegisterRequest, params: RequestParams = {}) =>
      this.request<Record<string, any>, any>({
        path: `/api/users/register`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name Mine
     * @request GET:/api/collections/mine
     */
    mine: (params: RequestParams = {}) =>
      this.request<DivCollectionDto[], any>({
        path: `/api/collections/mine`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name Create
     * @request POST:/api/collections/mine
     */
    create: (data: CreateCollectionRequest, params: RequestParams = {}) =>
      this.request<DivCollectionDto, any>({
        path: `/api/collections/mine`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name AddItem
     * @request POST:/api/collections/mine/{name}/items
     */
    addItem: (name: string, data: AddItemRequest, params: RequestParams = {}) =>
      this.request<DivCollectionItemDto, any>({
        path: `/api/collections/mine/${name}/items`,
        method: "POST",
        body: data,
        type: ContentType.Json,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags search-rest-controller
     * @name SearchMilvus
     * @request GET:/api/search/milvus
     */
    searchMilvus: (
      query: {
        /**
         * @minLength 3
         * @maxLength 2147483647
         */
        q: string;
        /**
         * @format int32
         * @default 10
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<HitDto[], any>({
        path: `/api/search/milvus`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags search-rest-controller
     * @name SearchLucene
     * @request GET:/api/search/lucene
     */
    searchLucene: (
      query: {
        /**
         * @minLength 3
         * @maxLength 2147483647
         */
        q: string;
        /**
         * @format int32
         * @default 10
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<HitDto[], any>({
        path: `/api/search/lucene`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags search-rest-controller
     * @name SearchGrep
     * @request GET:/api/search/grep
     */
    searchGrep: (
      query: {
        /**
         * @minLength 3
         * @maxLength 2147483647
         */
        q: string;
        /**
         * @format int32
         * @default 10
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<HitDto[], any>({
        path: `/api/search/grep`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags search-rest-controller
     * @name SearchDivHeads
     * @request GET:/api/search/divHeads
     */
    searchDivHeads: (
      query: {
        /**
         * @minLength 3
         * @maxLength 2147483647
         */
        q: string;
        /**
         * @format int32
         * @default 10
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<HitDto[], any>({
        path: `/api/search/divHeads`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags search-rest-controller
     * @name SearchAuthors
     * @request GET:/api/search/authors
     */
    searchAuthors: (
      query: {
        /**
         * @minLength 3
         * @maxLength 2147483647
         */
        q: string;
        /**
         * @format int32
         * @default 10
         */
        limit?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<HitDto[], any>({
        path: `/api/search/authors`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description gets
     *
     * @tags search-rest-controller
     * @name Ann
     * @request GET:/api/search/ann
     */
    ann: (
      query?: {
        path?: string;
        /** @format int64 */
        divid?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<Hits, any>({
        path: `/api/search/ann`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description retrieves TeiElemDto information for a given path, i.e. /alecsandri/versuri
     *
     * @tags div-rest-controller
     * @name GetElemByPath
     * @request GET:/api/divs
     */
    getElemByPath: (
      query: {
        path: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiElemDto, any>({
        path: `/api/divs`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-rest-controller
     * @name GetId
     * @request GET:/api/divs/{id}
     */
    getId: (id: number, params: RequestParams = {}) =>
      this.request<TeiDivDto, any>({
        path: `/api/divs/${id}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-rest-controller
     * @name GetIdToc
     * @request GET:/api/divs/{id}/toc
     */
    getIdToc: (
      id: number,
      query?: {
        /**
         * @format int32
         * @default 0
         */
        page?: number;
        /**
         * @format int32
         * @default 20
         */
        size?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiDivDto[], any>({
        path: `/api/divs/${id}/toc`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * @description Returns all child elements of the given div
     *
     * @tags div-rest-controller
     * @name GetIdParas
     * @summary Get div paragraphs
     * @request GET:/api/divs/{divId}/paras
     */
    getIdParas: (
      divId: number,
      query?: {
        /**
         * @format int32
         * @default 0
         */
        page?: number;
        /**
         * @format int32
         * @default 20
         */
        size?: number;
        withContent?: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiElemDto[], any>({
        path: `/api/divs/${divId}/paras`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-rest-controller
     * @name GetAllTeiDivs
     * @request GET:/api/divs/
     */
    getAllTeiDivs: (
      query?: {
        /**
         * @format int32
         * @default 0
         */
        page?: number;
        /**
         * @format int32
         * @default 20
         */
        size?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiDivDto[], any>({
        path: `/api/divs/`,
        method: "GET",
        query: query,
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name RepoNames
     * @request GET:/api/collections/system/repos
     */
    repoNames: (params: RequestParams = {}) =>
      this.request<string[], any>({
        path: `/api/collections/system/repos`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name ByRepo
     * @request GET:/api/collections/system/by-repo/{repoName}
     */
    byRepo: (repoName: string, params: RequestParams = {}) =>
      this.request<TeiDivDto[], any>({
        path: `/api/collections/system/by-repo/${repoName}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name ByLanguage
     * @request GET:/api/collections/system/by-language/{lang}
     */
    byLanguage: (lang: string, params: RequestParams = {}) =>
      this.request<TeiDivDto[], any>({
        path: `/api/collections/system/by-language/${lang}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name ByAuthor
     * @request GET:/api/collections/system/by-author/{authorStrId}
     */
    byAuthor: (authorStrId: string, params: RequestParams = {}) =>
      this.request<TeiDivDto[], any>({
        path: `/api/collections/system/by-author/${authorStrId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name Get
     * @request GET:/api/collections/mine/{name}
     */
    get: (name: string, params: RequestParams = {}) =>
      this.request<DivCollectionDto, any>({
        path: `/api/collections/mine/${name}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name Delete
     * @request DELETE:/api/collections/mine/{name}
     */
    delete: (name: string, params: RequestParams = {}) =>
      this.request<void, any>({
        path: `/api/collections/mine/${name}`,
        method: "DELETE",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-rest-controller
     * @name GetAuthor
     * @request GET:/api/authors/{strId}
     */
    getAuthor: (strId: string, params: RequestParams = {}) =>
      this.request<AuthorDto, any>({
        path: `/api/authors/${strId}`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-rest-controller
     * @name GetOpera
     * @request GET:/api/authors/{strId}/opera
     */
    getOpera: (strId: string, params: RequestParams = {}) =>
      this.request<TeiDivDto[], any>({
        path: `/api/authors/${strId}/opera`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-rest-controller
     * @name GetAuthors
     * @request GET:/api/authors/
     */
    getAuthors: (params: RequestParams = {}) =>
      this.request<AuthorDto[], any>({
        path: `/api/authors/`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags config-rest-controller
     * @name Config
     * @request GET:/api/admin/config
     */
    config: (params: RequestParams = {}) =>
      this.request<SharedConfigDto, any>({
        path: `/api/admin/config`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-collection-rest-controller
     * @name RemoveItem
     * @request DELETE:/api/collections/mine/{name}/items/{itemId}
     */
    removeItem: (name: string, itemId: number, params: RequestParams = {}) =>
      this.request<void, any>({
        path: `/api/collections/mine/${name}/items/${itemId}`,
        method: "DELETE",
        ...params,
      }),
  };
  util = {
    /**
     * No description
     *
     * @tags util-controller
     * @name Random
     * @request GET:/util/random
     */
    random: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/util/random`,
        method: "GET",
        format: "json",
        ...params,
      }),

    /**
     * No description
     *
     * @tags util-controller
     * @name Echo
     * @request GET:/util/echo
     */
    echo: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/util/echo`,
        method: "GET",
        format: "json",
        ...params,
      }),
  };
}
