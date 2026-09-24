# textbase api
SWAGGER_FILE=textbase-api.json
curl  https://textbase.scriptorium.ro/api/docs -H 'Accept:application/json' > "$SWAGGER_FILE"
npx swagger-typescript-api generate -p "$SWAGGER_FILE" -o src -n textbase.api.ts


# sentence transformers api
STS_API_JSON=sts-api.json
curl  http://mini.local:11200/openapi.json -H 'Accept:application/json' > "$STS_API_JSON"
npx swagger-typescript-api generate -p "$STS_API_JSON" -o src -n sts.api.ts
