import { createObjectHooks } from "../_shared/objectHooks";
import type { Event } from "./types";
export const Events = createObjectHooks<Event>("event");
