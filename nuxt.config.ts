// nuxt.config.ts
export default defineNuxtConfig({
  typescript: {
    strict: true,
  },
  /**
   * Эти ключи будут доступны через useRuntimeConfig() на сервере.
   * Значения подставятся из переменных окружения Vercel:
   *   NUXT_ECWID_STORE_ID, NUXT_ECWID_TOKEN, NUXT_PV_CATEGORY_ID, NUXT_MASTER_PRODUCT_ID
   * Плюс наш utils/tenant.ts умеет читать и суффиксные пары (__test/__prod) и process.env.
   */
  runtimeConfig: {
    NUXT_ECWID_STORE_ID: '',
    NUXT_ECWID_TOKEN: '',
    NUXT_PV_CATEGORY_ID: '',
    NUXT_MASTER_PRODUCT_ID: '',
    public: {
      // опционально: если когда-нибудь захочешь  читать базу API на клиенте
      POLISOL_API_BASE: '',
    },
  },

  /**
   * Удобно включить CORS для всех /api/* (можно убрать, если выставляешь заголовки в хэндлерах)
   */
  nitro: {
    routeRules: {
      '/api/**': { cors: true },
    },
  },
});
