// apps/api/src/bootstrap.ts
import "dotenv/config"; // local dev only; harmless on Lambda
export { handler } from "./index";