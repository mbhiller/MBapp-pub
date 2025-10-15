import { api } from "../core.mjs";

export const randInt = (min, max) => Math.floor(Math.random()*(max-min+1))+min;
export const pick = (arr) => arr[randInt(0, arr.length-1)];
export const nowStamp = () => Date.now().toString(36);
export const shortId = (p="") => `${p}${Math.random().toString(36).slice(2,8)}`;

export const uniqueCode = (prefix) => `${prefix}-${nowStamp()}-${shortId()}`.toUpperCase();
export const uniqueSku  = (prefix="SKU") => `${prefix}-${nowStamp()}-${shortId()}`.toUpperCase().replace(/[^A-Z0-9-]/g,"");
export const uniqueEmail = (name, dom="example.test") =>
  `${name.toLowerCase().replace(/[^a-z0-9]+/g,".")}.${shortId()}@${dom}`;

export const uniqueName = (kind="Item") => {
  const a = ["Acme","Sunset","Green","Silver","Pine","River","Blue","Maple","Oak","Prairie"];
  const b = ["Ranch","Stables","Supply","Trading","Farms","Arena","Tack","Outfitters","Barn"];
  return `${pick(a)} ${pick(b)} ${kind} ${randInt(1,999)}`;
};

// Retry on “already exists”
export async function safeCreate(type, body, mutate=(b)=>b) {
  for (let i=0;i<3;i++) {
    try { return await api(`/objects/${encodeURIComponent(type)}`, { method:"POST", body }); }
    catch (e) {
      const msg = e?.response?.message || e?.message || "";
      if (!/exists/i.test(msg)) throw e;
      body = mutate(structuredClone(body));
    }
  }
  return await api(`/objects/${encodeURIComponent(type)}`, { method:"POST", body });
}
