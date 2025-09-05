// server/api/polisol/pricing.get.ts

import { defineEventHandler, setResponseHeader } from 'h3';
import { PRICING_TABLE, SUFFIX_BY_CONTENT, BATCH_INDEX_TO_COUNT } from '~~/utils/polisol';

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  return {
    ok: true,
    pricing: PRICING_TABLE,
    suffixMap: SUFFIX_BY_CONTENT,
    batches: [15, 30, 45, 60, 75],
  };
});
