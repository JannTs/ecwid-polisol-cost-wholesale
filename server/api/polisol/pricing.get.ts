// server/api/polisol/pricing.get.ts

import { defineEventHandler, setResponseHeader } from 'h3';
import { PRICING_TABLE, SUFFIX_BY_CONTENT, BATCH_INDEX_TO_COUNT } from '~~/utils/polisol';

export default defineEventHandler((event) => {
  // CORS (при необходимости позже ужесточим под домен витрины)
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'GET, OPTIONS');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type');

  return {
    ok: true,
    currency: 'UAH',
    batchIndexToCount: BATCH_INDEX_TO_COUNT, // {1:15,2:30,3:45,4:60,5:75}
    suffixByContent: SUFFIX_BY_CONTENT, // мапа лейбл → SKU-суффикс
    pricing: PRICING_TABLE, // таблица цен (₴ за 1 шт)
  };
});
