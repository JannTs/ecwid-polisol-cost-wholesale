// server/api/polisol/health.get.ts  - v46
import { defineEventHandler, setResponseHeader } from 'h3';
import { getTenantCtx } from '~~/utils/tenant';
import { useRuntimeConfig } from '#imports';

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, OPTIONS');

  const cfg = (useRuntimeConfig?.() as any) || {};
  const env = (process?.env as any) || {};
  const ctx = getTenantCtx(event);

  const tokenPresent = !!(ctx as any).token && String((ctx as any).token).length > 8;

  return {
    ok: true,
    tenant: ctx.tenant,
    storeId: ctx.storeId || null,
    pvCategoryId: ctx.pvCategoryId ?? null,
    masterProductId: ctx.masterProductId ?? null,
    tokenPresent,
    ecwidApiBase: ctx.storeId ? `https://app.ecwid.com/api/v3/${ctx.storeId}` : null,

    // где вообще "видны" ключи прямо сейчас:
    cfgPresence: {
      NUXT_ECWID_STORE_ID__test: !!cfg.NUXT_ECWID_STORE_ID__test,
      NUXT_ECWID_TOKEN__test: !!cfg.NUXT_ECWID_TOKEN__test,
      NUXT_PV_CATEGORY_ID__test: !!cfg.NUXT_PV_CATEGORY_ID__test,
      NUXT_ECWID_STORE_ID__prod: !!cfg.NUXT_ECWID_STORE_ID__prod,
      NUXT_ECWID_TOKEN__prod: !!cfg.NUXT_ECWID_TOKEN__prod,
      NUXT_PV_CATEGORY_ID__prod: !!cfg.NUXT_PV_CATEGORY_ID__prod,
    },
    envPresence: {
      NUXT_ECWID_STORE_ID__test: !!env.NUXT_ECWID_STORE_ID__test,
      NUXT_ECWID_TOKEN__test: !!env.NUXT_ECWID_TOKEN__test,
      NUXT_PV_CATEGORY_ID__test: !!env.NUXT_PV_CATEGORY_ID__test,
      NUXT_ECWID_STORE_ID__prod: !!env.NUXT_ECWID_STORE_ID__prod,
      NUXT_ECWID_TOKEN__prod: !!env.NUXT_ECWID_TOKEN__prod,
      NUXT_PV_CATEGORY_ID__prod: !!env.NUXT_PV_CATEGORY_ID__prod,
    },
  };
});
