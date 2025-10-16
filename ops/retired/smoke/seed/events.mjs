import { safeCreate, uniqueName } from "./util.mjs";

const addDays = (iso, d) => new Date(new Date(iso).getTime()+d*86400000).toISOString();

export default function seedEvents() {
  const now = new Date().toISOString();
  const body0 = {
    type:"event",
    name: uniqueName("Classic"),
    status:"open",
    location:"Main Arena",
    startsAt: addDays(now, 7),
    endsAt:   addDays(now, 9),
    capacity: 200,
  };
  return safeCreate("event", body0, (b)=>({ ...b, name: uniqueName("Classic") }));
}
