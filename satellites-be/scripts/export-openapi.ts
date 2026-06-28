import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { openApiSpec } from "../src/openapi/registry.js";

const outPath = resolve(__dirname, "../../openapi.schema.json");
mkdirSync(resolve(__dirname, "../.."), { recursive: true });
writeFileSync(outPath, JSON.stringify(openApiSpec, null, 2), "utf8");

console.log(`OpenAPI spec exported → ${outPath}`);
