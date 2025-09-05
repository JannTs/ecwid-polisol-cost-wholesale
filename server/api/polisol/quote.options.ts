// server/api/polisol/quote.options.ts
import { defineEventHandler, setResponseHeader } from 'h3';

export default defineEventHandler((event) => {
  // На первом этапе оставляем '*' (потом сузим до домена витрины)
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');
  return 'OK';
});
