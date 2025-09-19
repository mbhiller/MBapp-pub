import { createObjectHooks } from "../_shared/objectHooks";
import type { Client } from "./types";
export const Clients = createObjectHooks<Client>("client");
