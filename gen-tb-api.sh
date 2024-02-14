curl  http://localhost:8080/api/docs -H 'Accept:application/json' > swagger.json
npx swagger-typescript-api -p swagger.json -o src -n textbase.api.ts


