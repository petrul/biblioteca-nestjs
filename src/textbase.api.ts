/* eslint-disable */
/* tslint:disable */
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

export type Links = Record<string, Link>;

export interface RepresentationModelObject {
  _links?: Links;
}

export interface Attr {
  name?: string;
  value?: string;
  schemaTypeInfo?: TypeInfo;
  specified?: boolean;
  ownerElement?: Element;
  id?: boolean;
  attributes?: NamedNodeMap;
  namespaceURI?: string;
  localName?: string;
  childNodes?: NodeList;
  nextSibling?: Node;
  previousSibling?: Node;
  firstChild?: Node;
  lastChild?: Node;
  nodeName?: string;
  nodeValue?: string;
  /** @format int32 */
  nodeType?: number;
  parentNode?: Node;
  ownerDocument?: Document;
  baseURI?: string;
  textContent?: string;
  prefix?: string;
}

export interface Author {
  /** @format int64 */
  id?: number;
  strId?: string;
  lastName?: string;
  firstName?: string;
  originalNameInTeiFile?: string;
  displayName?: string;
  description?: string;
  avatar?: {
    binaryStream?: object;
  };
  visualName?: string;
  anonymous?: boolean;
  oneNamed?: boolean;
  twoNamed?: boolean;
}

export interface DOMConfiguration {
  parameterNames?: DOMStringList;
}

export type DOMImplementation = object;

export interface DOMStringList {
  /** @format int32 */
  length?: number;
}

export interface Document {
  xmlVersion?: string;
  documentElement?: Element;
  doctype?: DocumentType;
  implementation?: DOMImplementation;
  inputEncoding?: string;
  xmlEncoding?: string;
  xmlStandalone?: boolean;
  strictErrorChecking?: boolean;
  documentURI?: string;
  domConfig?: DOMConfiguration;
  attributes?: NamedNodeMap;
  namespaceURI?: string;
  localName?: string;
  childNodes?: NodeList;
  nextSibling?: Node;
  previousSibling?: Node;
  firstChild?: Node;
  lastChild?: Node;
  nodeName?: string;
  nodeValue?: string;
  /** @format int32 */
  nodeType?: number;
  parentNode?: Node;
  ownerDocument?: Document;
  baseURI?: string;
  textContent?: string;
  prefix?: string;
}

export interface DocumentType {
  name?: string;
  internalSubset?: string;
  notations?: NamedNodeMap;
  entities?: NamedNodeMap;
  publicId?: string;
  systemId?: string;
  attributes?: NamedNodeMap;
  namespaceURI?: string;
  localName?: string;
  childNodes?: NodeList;
  nextSibling?: Node;
  previousSibling?: Node;
  firstChild?: Node;
  lastChild?: Node;
  nodeName?: string;
  nodeValue?: string;
  /** @format int32 */
  nodeType?: number;
  parentNode?: Node;
  ownerDocument?: Document;
  baseURI?: string;
  textContent?: string;
  prefix?: string;
}

export interface Element {
  tagName?: string;
  attributeNode?: Attr;
  attributeNodeNS?: Attr;
  schemaTypeInfo?: TypeInfo;
  attributes?: NamedNodeMap;
  namespaceURI?: string;
  localName?: string;
  childNodes?: NodeList;
  nextSibling?: Node;
  previousSibling?: Node;
  firstChild?: Node;
  lastChild?: Node;
  nodeName?: string;
  nodeValue?: string;
  /** @format int32 */
  nodeType?: number;
  parentNode?: Node;
  ownerDocument?: Document;
  baseURI?: string;
  textContent?: string;
  prefix?: string;
}

export interface EntityModelTeiDiv {
  /** @format int64 */
  id?: number;
  /**
   * @minLength 0
   * @maxLength 100
   */
  urlFragment?: string;
  /**
   * @minLength 0
   * @maxLength 3000
   */
  head?: string;
  xpath?: string;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  lang?:
    | 'BG'
    | 'BR'
    | 'CA'
    | 'DE'
    | 'EN'
    | 'ES'
    | 'FI'
    | 'FR'
    | 'GR'
    | 'HU'
    | 'IT'
    | 'LA'
    | 'NL'
    | 'NO'
    | 'PT'
    | 'RO'
    | 'RU'
    | 'ZH';
  /** @format byte */
  image?: string;
  /** @format int32 */
  depth?: number;
  teiRepo?: TeiRepo;
  get_url?: string;
  get_node?: Node;
  get_cacheRelativeRoot?: string;
  leaf?: boolean;
  completePath?: string;
  author?: Author;
  relativeRoot?: string;
  url?: string;
  _links?: Links;
}

export interface NamedNodeMap {
  /** @format int32 */
  length?: number;
  namedItem?: Node;
  namedItemNS?: Node;
}

export interface Node {
  attributes?: NamedNodeMap;
  namespaceURI?: string;
  localName?: string;
  childNodes?: NodeList;
  nextSibling?: Node;
  previousSibling?: Node;
  firstChild?: Node;
  lastChild?: Node;
  nodeName?: string;
  nodeValue?: string;
  /** @format int32 */
  nodeType?: number;
  parentNode?: Node;
  ownerDocument?: Document;
  baseURI?: string;
  textContent?: string;
  prefix?: string;
}

export interface NodeList {
  /** @format int32 */
  length?: number;
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

export interface PagedModelEntityModelTeiDiv {
  _embedded?: {
    teiDivs?: EntityModelTeiDiv[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface TeiRepo {
  name?: string;
}

export interface TypeInfo {
  typeName?: string;
  typeNamespace?: string;
}

export interface EntityModelTeiFile {
  /** @format int64 */
  id?: number;
  filename?: string;
  /**
   * @minLength 0
   * @maxLength 1000
   */
  title?: string;
  /** @format date-time */
  timestamp?: string;
  author?: Author;
  _links?: Links;
}

export interface CollectionModelTeiDiv {
  _embedded?: {
    teiDivs?: TeiDivResponse[];
  };
  _links?: Links;
}

export interface CollectionModelEntityModelTeiDiv {
  _embedded?: {
    teiDivs?: EntityModelTeiDiv[];
  };
  _links?: Links;
}

export interface EntityModelAuthor {
  /** @format int64 */
  id?: number;
  strId?: string;
  lastName?: string;
  firstName?: string;
  originalNameInTeiFile?: string;
  displayName?: string;
  description?: string;
  avatar?: {
    binaryStream?: object;
  };
  visualName?: string;
  anonymous?: boolean;
  oneNamed?: boolean;
  twoNamed?: boolean;
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

export interface PagedModelEntityModelTeiFile {
  _embedded?: {
    teiFiles?: EntityModelTeiFile[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface CollectionModelAuthor {
  _embedded?: {
    authors?: AuthorResponse[];
  };
  _links?: Links;
}

export interface CollectionModelEntityModelTeiFile {
  _embedded?: {
    teiFiles?: EntityModelTeiFile[];
  };
  _links?: Links;
}

export interface EntityModelDivMediaAssociation {
  divPath?: string;
  _links?: Links;
}

export interface PagedModelEntityModelDivMediaAssociation {
  _embedded?: {
    divMediaAssociations?: EntityModelDivMediaAssociation[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface EntityModelMediaRef {
  /**
   * @minLength 0
   * @maxLength 200
   */
  contentType?: string;
  /**
   * @format int32
   * @min 0
   */
  width?: number;
  /**
   * @format int32
   * @min 0
   */
  height?: number;
  role?: string;
  _links?: Links;
}

export interface PagedModelEntityModelMediaRef {
  _embedded?: {
    mediaRefs?: EntityModelMediaRef[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface EntityModelAuthorMediaAssociation {
  authorPath?: string;
  _links?: Links;
}

export interface PagedModelEntityModelAuthorMediaAssociation {
  _embedded?: {
    authorMediaAssociations?: EntityModelAuthorMediaAssociation[];
  };
  _links?: Links;
  page?: PageMetadata;
}

export interface AuthorResponse {
  /** @format int64 */
  id?: number;
  strId?: string;
  lastName?: string;
  firstName?: string;
  originalNameInTeiFile?: string;
  displayName?: string;
  description?: string;
  avatar?: {
    binaryStream?: object;
  };
  visualName?: string;
  anonymous?: boolean;
  oneNamed?: boolean;
  twoNamed?: boolean;
}

export interface TeiDivResponse {
  /** @format int64 */
  id?: number;
  /**
   * @minLength 0
   * @maxLength 100
   */
  urlFragment?: string;
  /**
   * @minLength 0
   * @maxLength 3000
   */
  head?: string;
  xpath?: string;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  lang?:
    | 'BG'
    | 'BR'
    | 'CA'
    | 'DE'
    | 'EN'
    | 'ES'
    | 'FI'
    | 'FR'
    | 'GR'
    | 'HU'
    | 'IT'
    | 'LA'
    | 'NL'
    | 'NO'
    | 'PT'
    | 'RO'
    | 'RU'
    | 'ZH';
  /** @format byte */
  image?: string;
  /** @format int32 */
  depth?: number;
  teiRepo?: TeiRepo;
  get_url?: string;
  get_node?: Node;
  get_cacheRelativeRoot?: string;
  leaf?: boolean;
  completePath?: string;
  author?: Author;
  relativeRoot?: string;
  url?: string;
}

export interface HitDto {
  type?: string;
  url?: string;
  /** @format float */
  score?: number;
  content?: string;
  data?: object;
}

export interface AuthorDto {
  strId?: string;
  lastName?: string;
  firstName?: string;
  originalNameInTeiFile?: string;
  displayName?: string;
  description?: string;
  opera?: OpusDto[];
  image_href?: string;
}

export interface OpusDto {
  /** @format int64 */
  id?: number;
  path?: string;
  urlFragment?: string;
  head?: string;
  url?: string;
  /** @format int32 */
  depth?: number;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  parent?: TeiDivDto;
  author?: AuthorDto;
  leaf?: boolean;
  opus?: boolean;
  authors?: AuthorDto[];
}

export interface TeiDivDto {
  /** @format int64 */
  id?: number;
  path?: string;
  urlFragment?: string;
  head?: string;
  url?: string;
  /** @format int32 */
  depth?: number;
  /** @format int32 */
  size?: number;
  /** @format int32 */
  wordSize?: number;
  children?: TeiDivDto[];
  parent?: TeiDivDto;
  author?: AuthorDto;
  leaf?: boolean;
  opus?: boolean;
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

export type QueryParamsType = Record<string | number, any>;
export type ResponseFormat = keyof Omit<Body, 'body' | 'bodyUsed'>;

export interface FullRequestParams extends Omit<RequestInit, 'body'> {
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

export type RequestParams = Omit<FullRequestParams, 'body' | 'method' | 'query' | 'path'>;

export interface ApiConfig<SecurityDataType = unknown> {
  baseUrl?: string;
  baseApiParams?: Omit<RequestParams, 'baseUrl' | 'cancelToken' | 'signal'>;
  securityWorker?: (securityData: SecurityDataType | null) => Promise<RequestParams | void> | RequestParams | void;
  customFetch?: typeof fetch;
}

export interface HttpResponse<D extends unknown, E extends unknown = unknown> extends Response {
  data: D;
  error: E;
}

type CancelToken = Symbol | string | number;

export enum ContentType {
  Json = 'application/json',
  FormData = 'multipart/form-data',
  UrlEncoded = 'application/x-www-form-urlencoded',
  Text = 'text/plain',
}

export class HttpClient<SecurityDataType = unknown> {
  public baseUrl: string = 'http://localhost:8080';
  private securityData: SecurityDataType | null = null;
  private securityWorker?: ApiConfig<SecurityDataType>['securityWorker'];
  private abortControllers = new Map<CancelToken, AbortController>();
  private customFetch = (...fetchParams: Parameters<typeof fetch>) => fetch(...fetchParams);

  private baseApiParams: RequestParams = {
    credentials: 'same-origin',
    headers: {},
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
  };

  constructor(apiConfig: ApiConfig<SecurityDataType> = {}) {
    Object.assign(this, apiConfig);
  }

  public setSecurityData = (data: SecurityDataType | null) => {
    this.securityData = data;
  };

  protected encodeQueryParam(key: string, value: any) {
    const encodedKey = encodeURIComponent(key);
    return `${encodedKey}=${encodeURIComponent(typeof value === 'number' ? value : `${value}`)}`;
  }

  protected addQueryParam(query: QueryParamsType, key: string) {
    return this.encodeQueryParam(key, query[key]);
  }

  protected addArrayQueryParam(query: QueryParamsType, key: string) {
    const value = query[key];
    return value.map((v: any) => this.encodeQueryParam(key, v)).join('&');
  }

  protected toQueryString(rawQuery?: QueryParamsType): string {
    const query = rawQuery || {};
    const keys = Object.keys(query).filter((key) => 'undefined' !== typeof query[key]);
    return keys
      .map((key) => (Array.isArray(query[key]) ? this.addArrayQueryParam(query, key) : this.addQueryParam(query, key)))
      .join('&');
  }

  protected addQueryParams(rawQuery?: QueryParamsType): string {
    const queryString = this.toQueryString(rawQuery);
    return queryString ? `?${queryString}` : '';
  }

  private contentFormatters: Record<ContentType, (input: any) => any> = {
    [ContentType.Json]: (input: any) =>
      input !== null && (typeof input === 'object' || typeof input === 'string') ? JSON.stringify(input) : input,
    [ContentType.Text]: (input: any) => (input !== null && typeof input !== 'string' ? JSON.stringify(input) : input),
    [ContentType.FormData]: (input: any) =>
      Object.keys(input || {}).reduce((formData, key) => {
        const property = input[key];
        formData.append(
          key,
          property instanceof Blob
            ? property
            : typeof property === 'object' && property !== null
            ? JSON.stringify(property)
            : `${property}`,
        );
        return formData;
      }, new FormData()),
    [ContentType.UrlEncoded]: (input: any) => this.toQueryString(input),
  };

  protected mergeRequestParams(params1: RequestParams, params2?: RequestParams): RequestParams {
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

  protected createAbortSignal = (cancelToken: CancelToken): AbortSignal | undefined => {
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
      ((typeof secure === 'boolean' ? secure : this.baseApiParams.secure) &&
        this.securityWorker &&
        (await this.securityWorker(this.securityData))) ||
      {};
    const requestParams = this.mergeRequestParams(params, secureParams);
    const queryString = query && this.toQueryString(query);
    const payloadFormatter = this.contentFormatters[type || ContentType.Json];
    const responseFormat = format || requestParams.format;

    return this.customFetch(`${baseUrl || this.baseUrl || ''}${path}${queryString ? `?${queryString}` : ''}`, {
      ...requestParams,
      headers: {
        ...(requestParams.headers || {}),
        ...(type && type !== ContentType.FormData ? { 'Content-Type': type } : {}),
      },
      signal: (cancelToken ? this.createAbortSignal(cancelToken) : requestParams.signal) || null,
      body: typeof body === 'undefined' || body === null ? null : payloadFormatter(body),
    }).then(async (response) => {
      const r = response as HttpResponse<T, E>;
      r.data = null as unknown as T;
      r.error = null as unknown as E;

      const data = !responseFormat
        ? r
        : await response[responseFormat]()
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
 * @baseUrl http://localhost:8080
 */
export class Api<SecurityDataType extends unknown> extends HttpClient<SecurityDataType> {
  api = {
    /**
     * @description get-authormediaassociation
     *
     * @tags author-media-association-entity-controller
     * @name GetCollectionResourceAuthormediaassociationGet1
     * @request GET:/api/drest/authorMediaAssociations
     */
    getCollectionResourceAuthormediaassociationGet1: (
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
      this.request<PagedModelEntityModelAuthorMediaAssociation, any>({
        path: `/api/drest/authorMediaAssociations`,
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * @description get-authormediaassociation
     *
     * @tags author-media-association-entity-controller
     * @name GetItemResourceAuthormediaassociationGet
     * @request GET:/api/drest/authorMediaAssociations/{id}
     */
    getItemResourceAuthormediaassociationGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelAuthorMediaAssociation, void>({
        path: `/api/drest/authorMediaAssociations/${id}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref-by-authormediaassociation-Id
     *
     * @tags author-media-association-property-reference-controller
     * @name FollowPropertyReferenceAuthormediaassociationGet1
     * @request GET:/api/drest/authorMediaAssociations/{id}/mediaRef
     */
    followPropertyReferenceAuthormediaassociationGet1: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelMediaRef, void>({
        path: `/api/drest/authorMediaAssociations/${id}/mediaRef`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref-by-authormediaassociation-Id
     *
     * @tags author-media-association-property-reference-controller
     * @name FollowPropertyReferenceAuthormediaassociationGet
     * @request GET:/api/drest/authorMediaAssociations/{id}/mediaRef/{propertyId}
     */
    followPropertyReferenceAuthormediaassociationGet: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<EntityModelMediaRef, void>({
        path: `/api/drest/authorMediaAssociations/${id}/mediaRef/${propertyId}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-author
     *
     * @tags author-entity-controller
     * @name GetCollectionResourceAuthorGet1
     * @request GET:/api/drest/authors
     */
    getCollectionResourceAuthorGet1: (
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
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet3
     * @request GET:/api/drest/authors/search/findByOriginalNameInTeiFile
     */
    executeSearchAuthorGet3: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByOriginalNameInTeiFile`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet4
     * @request GET:/api/drest/authors/search/findByStrId
     */
    executeSearchAuthorGet4: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/findByStrId`,
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet6
     * @request GET:/api/drest/authors/search/getByOriginalNameInTeiFile
     */
    executeSearchAuthorGet6: (params: RequestParams = {}) =>
      this.request<EntityModelAuthor, void>({
        path: `/api/drest/authors/search/getByOriginalNameInTeiFile`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet7
     * @request GET:/api/drest/authors/search/getByStrId
     */
    executeSearchAuthorGet7: (params: RequestParams = {}) =>
      this.request<EntityModelAuthor, void>({
        path: `/api/drest/authors/search/getByStrId`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags author-search-controller
     * @name ExecuteSearchAuthorGet8
     * @request GET:/api/drest/authors/search/getTeiFiles
     */
    executeSearchAuthorGet8: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelAuthor, void>({
        path: `/api/drest/authors/search/getTeiFiles`,
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-divmediaassociation
     *
     * @tags div-media-association-entity-controller
     * @name GetCollectionResourceDivmediaassociationGet1
     * @request GET:/api/drest/divMediaAssociations
     */
    getCollectionResourceDivmediaassociationGet1: (
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
      this.request<PagedModelEntityModelDivMediaAssociation, any>({
        path: `/api/drest/divMediaAssociations`,
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * @description get-divmediaassociation
     *
     * @tags div-media-association-entity-controller
     * @name GetItemResourceDivmediaassociationGet
     * @request GET:/api/drest/divMediaAssociations/{id}
     */
    getItemResourceDivmediaassociationGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelDivMediaAssociation, void>({
        path: `/api/drest/divMediaAssociations/${id}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref-by-divmediaassociation-Id
     *
     * @tags div-media-association-property-reference-controller
     * @name FollowPropertyReferenceDivmediaassociationGet1
     * @request GET:/api/drest/divMediaAssociations/{id}/mediaRef
     */
    followPropertyReferenceDivmediaassociationGet1: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelMediaRef, void>({
        path: `/api/drest/divMediaAssociations/${id}/mediaRef`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref-by-divmediaassociation-Id
     *
     * @tags div-media-association-property-reference-controller
     * @name FollowPropertyReferenceDivmediaassociationGet
     * @request GET:/api/drest/divMediaAssociations/{id}/mediaRef/{propertyId}
     */
    followPropertyReferenceDivmediaassociationGet: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<EntityModelMediaRef, void>({
        path: `/api/drest/divMediaAssociations/${id}/mediaRef/${propertyId}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref
     *
     * @tags media-ref-entity-controller
     * @name GetCollectionResourceMediarefGet1
     * @request GET:/api/drest/mediaRefs
     */
    getCollectionResourceMediarefGet1: (
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
      this.request<PagedModelEntityModelMediaRef, any>({
        path: `/api/drest/mediaRefs`,
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * @description get-mediaref
     *
     * @tags media-ref-entity-controller
     * @name GetItemResourceMediarefGet
     * @request GET:/api/drest/mediaRefs/{id}
     */
    getItemResourceMediarefGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelMediaRef, void>({
        path: `/api/drest/mediaRefs/${id}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name ListAllFormsOfMetadata1
     * @request GET:/api/drest/profile
     */
    listAllFormsOfMetadata1: (params: RequestParams = {}) =>
      this.request<RepresentationModelObject, any>({
        path: `/api/drest/profile`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor111
     * @request GET:/api/drest/profile/authorMediaAssociations
     */
    descriptor111: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/authorMediaAssociations`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor112
     * @request GET:/api/drest/profile/authors
     */
    descriptor112: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/authors`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor113
     * @request GET:/api/drest/profile/divMediaAssociations
     */
    descriptor113: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/divMediaAssociations`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor114
     * @request GET:/api/drest/profile/mediaRefs
     */
    descriptor114: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/mediaRefs`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor115
     * @request GET:/api/drest/profile/teiDivs
     */
    descriptor115: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/teiDivs`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags profile-controller
     * @name Descriptor116
     * @request GET:/api/drest/profile/teiFiles
     */
    descriptor116: (params: RequestParams = {}) =>
      this.request<string, any>({
        path: `/api/drest/profile/teiFiles`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teidiv
     *
     * @tags tei-div-entity-controller
     * @name GetCollectionResourceTeidivGet1
     * @request GET:/api/drest/teiDivs
     */
    getCollectionResourceTeidivGet1: (
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
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet
     * @request GET:/api/drest/teiDivs/search/findByHead
     */
    executeSearchTeidivGet: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByHead`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet1
     * @request GET:/api/drest/teiDivs/search/findByHeadContainingIgnoreCase
     */
    executeSearchTeidivGet1: (
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
        path: `/api/drest/teiDivs/search/findByHeadContainingIgnoreCase`,
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet2
     * @request GET:/api/drest/teiDivs/search/findByTeiFile
     */
    executeSearchTeidivGet2: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByTeiFile`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet3
     * @request GET:/api/drest/teiDivs/search/findByTeiFileAndXpath
     */
    executeSearchTeidivGet3: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByTeiFileAndXpath`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet4
     * @request GET:/api/drest/teiDivs/search/findByUrlFragmentAndParent
     */
    executeSearchTeidivGet4: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findByUrlFragmentAndParent`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet5
     * @request GET:/api/drest/teiDivs/search/findOperaForAuthorStrId
     */
    executeSearchTeidivGet5: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/findOperaForAuthorStrId`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet6
     * @request GET:/api/drest/teiDivs/search/getAuthors
     */
    executeSearchTeidivGet6: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/getAuthors`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet7
     * @request GET:/api/drest/teiDivs/search/getNrOfBottomDivs
     */
    executeSearchTeidivGet7: (params: RequestParams = {}) =>
      this.request<number, void>({
        path: `/api/drest/teiDivs/search/getNrOfBottomDivs`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-div-search-controller
     * @name ExecuteSearchTeidivGet8
     * @request GET:/api/drest/teiDivs/search/getOperaForTeiFileId
     */
    executeSearchTeidivGet8: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/search/getOperaForTeiFileId`,
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teidiv-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet1
     * @request GET:/api/drest/teiDivs/{id}/children
     */
    followPropertyReferenceTeidivGet1: (id: string, params: RequestParams = {}) =>
      this.request<CollectionModelTeiDiv, void>({
        path: `/api/drest/teiDivs/${id}/children`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teidiv-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet
     * @request GET:/api/drest/teiDivs/{id}/children/{propertyId}
     */
    followPropertyReferenceTeidivGet: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<CollectionModelTeiDiv, void>({
        path: `/api/drest/teiDivs/${id}/children/${propertyId}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teidiv-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet21
     * @request GET:/api/drest/teiDivs/{id}/parent
     */
    followPropertyReferenceTeidivGet21: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/${id}/parent`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teidiv-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet2
     * @request GET:/api/drest/teiDivs/{id}/parent/{propertyId}
     */
    followPropertyReferenceTeidivGet2: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiDiv, void>({
        path: `/api/drest/teiDivs/${id}/parent/${propertyId}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teifile-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet31
     * @request GET:/api/drest/teiDivs/{id}/teiFile
     */
    followPropertyReferenceTeidivGet31: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiFile, void>({
        path: `/api/drest/teiDivs/${id}/teiFile`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teifile-by-teidiv-Id
     *
     * @tags tei-div-property-reference-controller
     * @name FollowPropertyReferenceTeidivGet3
     * @request GET:/api/drest/teiDivs/{id}/teiFile/{propertyId}
     */
    followPropertyReferenceTeidivGet3: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiFile, void>({
        path: `/api/drest/teiDivs/${id}/teiFile/${propertyId}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teifile
     *
     * @tags tei-file-entity-controller
     * @name GetCollectionResourceTeifileGet1
     * @request GET:/api/drest/teiFiles
     */
    getCollectionResourceTeifileGet1: (
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
      this.request<PagedModelEntityModelTeiFile, any>({
        path: `/api/drest/teiFiles`,
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-file-search-controller
     * @name ExecuteSearchTeifileGet
     * @request GET:/api/drest/teiFiles/search/findByFilename
     */
    executeSearchTeifileGet: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiFile, void>({
        path: `/api/drest/teiFiles/search/findByFilename`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-file-search-controller
     * @name ExecuteSearchTeifileGet1
     * @request GET:/api/drest/teiFiles/search/getByFilename
     */
    executeSearchTeifileGet1: (params: RequestParams = {}) =>
      this.request<EntityModelTeiFile, void>({
        path: `/api/drest/teiFiles/search/getByFilename`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags tei-file-search-controller
     * @name ExecuteSearchTeifileGet2
     * @request GET:/api/drest/teiFiles/search/getTeiFilesForAuthorStrId
     */
    executeSearchTeifileGet2: (params: RequestParams = {}) =>
      this.request<CollectionModelEntityModelTeiFile, void>({
        path: `/api/drest/teiFiles/search/getTeiFilesForAuthorStrId`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-teifile
     *
     * @tags tei-file-entity-controller
     * @name GetItemResourceTeifileGet
     * @request GET:/api/drest/teiFiles/{id}
     */
    getItemResourceTeifileGet: (id: string, params: RequestParams = {}) =>
      this.request<EntityModelTeiFile, void>({
        path: `/api/drest/teiFiles/${id}`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-author-by-teifile-Id
     *
     * @tags tei-file-property-reference-controller
     * @name FollowPropertyReferenceTeifileGet1
     * @request GET:/api/drest/teiFiles/{id}/authors
     */
    followPropertyReferenceTeifileGet1: (id: string, params: RequestParams = {}) =>
      this.request<CollectionModelAuthor, void>({
        path: `/api/drest/teiFiles/${id}/authors`,
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * @description get-author-by-teifile-Id
     *
     * @tags tei-file-property-reference-controller
     * @name FollowPropertyReferenceTeifileGet
     * @request GET:/api/drest/teiFiles/{id}/authors/{propertyId}
     */
    followPropertyReferenceTeifileGet: (id: string, propertyId: string, params: RequestParams = {}) =>
      this.request<CollectionModelAuthor, void>({
        path: `/api/drest/teiFiles/${id}/authors/${propertyId}`,
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        query: query,
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-rest-controller
     * @name GetByPath
     * @request GET:/api/divs
     */
    getByPath: (
      query: {
        path: string;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiDivDto, any>({
        path: `/api/divs`,
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        format: 'json',
        ...params,
      }),

    /**
     * No description
     *
     * @tags div-rest-controller
     * @name GetIdToc
     * @request GET:/api/divs/{id}/toc
     */
    getIdToc: (id: number, params: RequestParams = {}) =>
      this.request<TeiDivDto[], any>({
        path: `/api/divs/${id}/toc`,
        method: 'GET',
        format: 'json',
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
        arg0?: number;
        /**
         * @format int32
         * @default 20
         */
        arg1?: number;
      },
      params: RequestParams = {},
    ) =>
      this.request<TeiDivDto[], any>({
        path: `/api/divs/`,
        method: 'GET',
        query: query,
        format: 'json',
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
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
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
        method: 'GET',
        format: 'json',
        ...params,
      }),
  };
}
