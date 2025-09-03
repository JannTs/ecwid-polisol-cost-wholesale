// utils/ecwid.ts
export class EcwidClient {
  private storeId: string;
  private token: string;

  constructor(storeId: string, token: string) {
    this.storeId = storeId;
    this.token = token;
  }

  private async call(path: string, opts: RequestInit = {}) {
    const url = `https://app.ecwid.com/api/v3/${this.storeId}${path}`;
    const res = await fetch(url, {
      ...opts,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });
    if (!res.ok) {
      throw new Error(`Ecwid API error ${res.status}: ${res.statusText}`);
    }
    return res.json();
  }

  async findBySku(sku: string) {
    const data = await this.call(`/products?sku=${encodeURIComponent(sku)}`);
    if (Array.isArray(data.items) && data.items.length > 0) {
      return data.items[0];
    }
    return null;
  }

  async createProduct(p: {
    name: string;
    sku: string;
    price: number;
    description?: string;
    categoryIds?: number[];
    attributes?: { name: string; value: string }[];
  }) {
    const body = {
      name: p.name,
      sku: p.sku,
      price: p.price,
      description: p.description || "",
      enabled: true,
      categoryIds: p.categoryIds || [],
      attributes: (p.attributes || []).map((a) => ({
        name: a.name,
        value: a.value,
      })),
    };
    const data = await this.call(`/products`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return data.id; // ID нового товара
  }
}
