SWAGGER_FILE=textbase-api.json
curl  https://textbase.scriptorium.ro/api/docs -H 'Accept:application/json' > "$SWAGGER_FILE"
npx swagger-typescript-api -p "$SWAGGER_FILE" -o src -n textbase.api.ts
