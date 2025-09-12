// utils/tenant.ts - v46
import { getQuery, getRequestHeaders } from 'h3';

export type Tenant = 'test' | 'prod';

function runtimeConfigSafe(): any {
  try {
    // @ts-expect-error: #imports доступен в Nuxt/Nitro-runtime
    const { useRuntimeConfig } = require('#imports');
    return typeof useRuntimeConfig === 'function' ? useRuntimeConfig() : {};
  } catch {
    return {};
  }
}

export function pickTenant(event): Tenant {
  const q = getQuery(event) as any;
  const h = getRequestHeaders(event) as any;
  const t = String(q?.tenant || h?.['x-tenant'] || '').toLowerCase();
  return t === 'test' ? 'test' : 'prod'; // prod — дефолт
}

export function getTenantCtx(event) {
  const cfg = runtimeConfigSafe() as any;
  const env = (process?.env as any) || {};
  const tenant: Tenant = pickTenant(event);
  const suff = `__${tenant}`; // напр. NUXT_ECWID_STORE_ID__test

  const pick = (key: string) =>
    cfg?.[`${key}${suff}`] ?? cfg?.[key] ?? env?.[`${key}${suff}`] ?? env?.[key];

  const toNum = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return {
    tenant,
    storeId: String(pick('NUXT_ECWID_STORE_ID') || ''),
    token: String(pick('NUXT_ECWID_TOKEN') || ''),
    pvCategoryId: toNum(pick('NUXT_PV_CATEGORY_ID')),
    masterProductId: toNum(pick('NUXT_MASTER_PRODUCT_ID')),
  };
}
