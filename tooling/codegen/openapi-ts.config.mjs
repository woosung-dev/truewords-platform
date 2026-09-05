import { fileURLToPath } from "node:url";

export default {
  input: fileURLToPath(new URL("../../contracts/openapi.json", import.meta.url)),
  output: fileURLToPath(new URL("../../packages/api-client-ts/src/generated", import.meta.url)),
  plugins: ["@hey-api/typescript", "@hey-api/client-fetch", "@hey-api/sdk"],
};
