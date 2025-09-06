// utils/ecwid.ts
export class EcwidClient {
  private storeId: string;
  private token: string;

  constructor(storeId: string, token: string) {
    this.storeId = String(storeId);
    this.token = String(token);
  }

  // Диагностичный вызов: шлём и Authorization: Bearer, и ?token=
  // и возвращаем подробную ошибку (код + тело Ecwid).
  private async call(path: string, opts: RequestInit = {}) {
    const base = `https://app.ecwid.com/api/v3/${this.storeId}`;
    const url =
      `${base}${path}` +
      (path.includes('?') ? '&' : '?') +
      `token=${encodeURIComponent(this.token)}`;

    const res = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        // parallel: Ecwid понимает и Bearer, и ?token=
        Authorization: `Bearer ${this.token}`,
        ...(opts.headers || {}),
      },
    });

    const text = await res.text().catch(() => '');
    if (!res.ok) {
      // Попробуем вынуть сообщение Ecwid
      let details = text;
      try {
        const j = JSON.parse(text);
        details = j?.errorMessage || j?.message || text;
      } catch {}
      const err = new Error(
        `Ecwid API error ${res.status}: ${res.statusText}${details ? ` — ${details}` : ''}`
      );
      // @ts-expect-error добавим поля для верхнего обработчика
      err._status = res.status;
      // @ts-expect-error
      err._body = text;
      throw err;
    }

    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }

  // === Поиск по SKU ===
  async findProductsBySku(sku: string): Promise<any[]> {
    const data = await this.call(`/products?sku=${encodeURIComponent(sku)}`);
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data)) return data;
    return [];
  }

  async findFirstProductBySku(sku: string): Promise<any | null> {
    const list = await this.findProductsBySku(sku);
    return list[0] || null;
  }

  async createProduct(p: {
    name: string;
    sku: string;
    price: number;
    description?: string;
    categoryIds?: number[];
    attributes?: { name: string; value: string }[];
    enabled?: boolean;
  }): Promise<any> {
    const body = {
      name: p.name,
      sku: p.sku,
      price: p.price,
      description: p.description || '',
      enabled: p.enabled ?? true,
      categoryIds: p.categoryIds || [],
      attributes: (p.attributes || []).map((a) => ({ name: a.name, value: a.value })),
    };
    return await this.call(`/products`, { method: 'POST', body: JSON.stringify(body) });
  }

  async updateProduct(productId: number | string, patch: any): Promise<any> {
    return await this.call(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
  }
}
