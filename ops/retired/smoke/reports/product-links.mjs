/* ops/smoke/reports/product-links.mjs
 * Show product→inventory mapping via defaultItemId and productBom rows,
 * plus an inverse index items→products.
 */
import { listObjects } from "../core.mjs";

export async function run({ limit = 500 } = {}) {
  const productsPage = await listObjects("product", { limit });
  const products = Array.isArray(productsPage.items) ? productsPage.items : [];

  const bomPage = await listObjects("productBom", { limit });
  const bomRows = Array.isArray(bomPage.items) ? bomPage.items : [];

  const productLinks = products.map(p => ({
    productId: p.id,
    name: p.name,
    defaultItemId: p.defaultItemId || null,
    bomItems: bomRows.filter(b => String(b.productId||"") === String(p.id)).map(b => b.itemId),
  }));

  // Build inverse index: itemId -> [productId,...]
  const itemProducts = {};
  for (const link of productLinks) {
    if (link.defaultItemId) {
      itemProducts[link.defaultItemId] = itemProducts[link.defaultItemId] || [];
      itemProducts[link.defaultItemId].push(link.productId);
    }
    for (const iid of link.bomItems) {
      itemProducts[iid] = itemProducts[iid] || [];
      itemProducts[iid].push(link.productId);
    }
  }

  return { products: productLinks, itemToProducts: itemProducts };
}
