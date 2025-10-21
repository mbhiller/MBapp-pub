export async function seedInventory(api) {
  const prod = await api.post('/products', { sku:'SEED-1', name:'Seed Product' });
  const item = await api.post('/inventory/items', { productId: prod.id });
  await api.post('/inventory/movements', { itemId: item.id, type:'receive', qty: 10 });
  return { productId: prod.id, itemId: item.id };
}