import { safeCreate, uniqueName } from "./util.mjs";

export default async function seedResources() {
  const r1 = await safeCreate("resource", { type:"resource", name: uniqueName("Ring"), resourceType:"arena", status:"available" },
                              (b)=>({ ...b, name: uniqueName("Ring") }));
  const r2 = await safeCreate("resource", { type:"resource", name: uniqueName("Ring"), resourceType:"arena", status:"available" },
                              (b)=>({ ...b, name: uniqueName("Ring") }));
  return [r1, r2];
}
