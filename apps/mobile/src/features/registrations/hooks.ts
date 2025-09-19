// apps/mobile/src/features/registrations/hooks.ts
import { createObjectHooks } from "../_shared/objectHooks";
import type { Registration } from "./types";

export const Registrations = createObjectHooks<Registration>("registration");
