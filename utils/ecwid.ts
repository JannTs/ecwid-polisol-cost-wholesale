// utils/ecwid.ts
import { $fetch } from 'ofetch';

export class EcwidClient {
  private storeId: string;
  private token: string;
  private apiBase: string;

  constructor(storeId: string, token: string) {
    this.storeId = String(storeId);
    this.token = token;
    this.apiBase = `https://app.ecwid.com/api/v3/${this.storeId}`;
  }

  private async request<T>(path: string, opts: any = {}): Promise<T> {
    const url = `${this.apiBase}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(this.token)}`;
    return await $fetch<T>(url, {
      method: opts.method || 'GET',
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  }

  // === Поиск по SKU (возвращает массив) ===
  async findProductsBySku(sku: string): Promise<any[]> {
    const res: any = await this.request(`/products?sku=${encodeURIComponent(sku)}`);
    // Ecwid может вернуть либо {items:[...]}, либо массив
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.items)) return res.items;
    return [];
  }

  // Первый найденный товар по SKU или null
  async findFirstProductBySku(sku: string): Promise<any | null> {
    const list = await this.findProductsBySku(sku);
    return list[0] || null;
  }

  // Создание товара
  async createProduct(payload: any): Promise<any> {
    return await this.request('/products', { method: 'POST', body: payload });
  }

  // Обновление товара (патч по id)
  async updateProduct(productId: number | string, patch: any): Promise<any> {
    return await this.request(`/products/${productId}`, { method: 'PUT', body: patch });
  }
}
