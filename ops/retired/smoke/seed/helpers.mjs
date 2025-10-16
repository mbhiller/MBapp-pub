export const nowIso = () => new Date().toISOString();
export const addDays = (d, n) => new Date(new Date(d).getTime() + n*86400000).toISOString();
export const uid = (p="seed") => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
export const money = (n) => Math.round(n*100)/100;
