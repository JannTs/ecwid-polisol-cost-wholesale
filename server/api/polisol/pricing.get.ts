// server/api/polisol/pricing.get.ts
import { defineEventHandler, setResponseHeader } from "h3";
import {
  PRICING_TABLE,
  SUFFIX_BY_CONTENT,
  BATCH_INDEX_TO_COUNT,
} from "../../../utils/ecwid";

export default defineEventHandler((event) => {
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(event, "Access-Control-Allow-Methods", "GET, OPTIONS");
  setResponseHeader(event, "Access-Control-Allow-Headers", "Content-Type");

  return {
    ok: true,
    currency: "UAH",
    batchIndexToCount: BATCH_INDEX_TO_COUNT,
    suffixByContent: SUFFIX_BY_CONTENT,
    pricing: PRICING_TABLE,
  };
});
