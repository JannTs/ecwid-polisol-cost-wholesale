// server/api/polisol/health.get.ts
import { defineEventHandler, setResponseHeader } from 'h3';
import { getTenantCtx } from '~~/utils/tenant';

export default defineEventHandler(async (event) => {
  // CORS (дублируем для явности; можно убрать, если включен cors в nuxt.config.ts)
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, OPTIONS');

  const ctx = getTenantCtx(event);

  const tokenPresent = !!(ctx as any).token && String((ctx as any).token).length > 8;

  const info = {
    ok: true,
    tenant: ctx.tenant, // 'test' | 'prod'
    storeId: ctx.storeId || null, // строка; без маски, это не секрет
    pvCategoryId: ctx.pvCategoryId ?? null,
    masterProductId: ctx.masterProductId ?? null,
    tokenPresent, // true/false — сам токен НЕ возвращаем
    ecwidApiBase: ctx.storeId ? `https://app.ecwid.com/api/v3/${ctx.storeId}` : null,

    // быстрая диагностика наличия env (не раскрываем значения)
    envPresence: {
      NUXT_ECWID_STORE_ID__test: !!process.env.NUXT_ECWID_STORE_ID__test,
      NUXT_ECWID_TOKEN__test: !!process.env.NUXT_ECWID_TOKEN__test,
      NUXT_PV_CATEGORY_ID__test: !!process.env.NUXT_PV_CATEGORY_ID__test,
      NUXT_ECWID_STORE_ID__prod: !!process.env.NUXT_ECWID_STORE_ID__prod,
      NUXT_ECWID_TOKEN__prod: !!process.env.NUXT_ECWID_TOKEN__prod,
      NUXT_PV_CATEGORY_ID__prod: !!process.env.NUXT_PV_CATEGORY_ID__prod,
    },
  };

  return info;
});
