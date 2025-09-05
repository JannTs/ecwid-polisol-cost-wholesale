// nuxt.config.ts
export default defineNuxtConfig({
  compatibilityDate: '2025-09-03',
  typescript: { strict: true },
  runtimeConfig: {
    NUXT_ECWID_STORE_ID: process.env.NUXT_ECWID_STORE_ID,
    NUXT_ECWID_TOKEN: process.env.NUXT_ECWID_TOKEN,
    // опционально: служебная категория для техтоваров
    NUXT_PV_CATEGORY_ID: process.env.NUXT_PV_CATEGORY_ID,
    public: {
      NUXT_PUBLIC_API_BASE: process.env.NUXT_PUBLIC_API_BASE || '/api',
    },
  },
});
