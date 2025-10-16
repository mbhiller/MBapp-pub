import { safeCreate, uniqueName, uniqueCode } from "./util.mjs";

export default async function seedClasses({ eventId, count=4 }) {
  const out = [];
  for (let i=0;i<count;i++) {
    const body0 = {
      type:"class",
      code: uniqueCode("CL"),
      name: uniqueName("Class"),
      fee: Math.round((10 + Math.random()*25)*100)/100,
      notes: `For event ${eventId}`,
    };
    out.push(await safeCreate("class", body0, (b)=>({ ...b, code: uniqueCode("CL"), name: uniqueName("Class") })));
  }
  return out;
}
