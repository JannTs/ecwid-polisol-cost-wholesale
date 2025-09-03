// server/api/polisol/quote.post.ts
import {
  defineEventHandler,
  readBody,
  createError,
  setResponseHeader,
} from "h3";
import { EcwidClient } from "../../../utils/ecwid";
import {
  toCanonLabel,
  unitPrice,
  BATCH_INDEX_TO_COUNT,
  isKvas,
  SUFFIX_BY_CONTENT,
} from "../../../utils/ecwid";

type Body = {
  contentLabel?: string; // лейбл из радио «Вміст»
  variantSuffix?: string; // К/Ш/Ж/М/Ч/КВ/КБ/КК (необязателен — вычислим по лейблу)
  batchIndex?: number; // 1..5  (1→15, 2→30, 3→45, 4→60, 5→75)
};

export default defineEventHandler(async (event) => {
  // CORS (при желании ужесточите на домен магазина)
  setResponseHeader(event, "Access-Control-Allow-Origin", "*");
  setResponseHeader(
    event,
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  setResponseHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");

  try {
    const body = (await readBody<Body>(event)) || {};
    const batchIndex = Number(body.batchIndex);

    if (!body.contentLabel) {
      throw createError({
        statusCode: 400,
        statusMessage: "Missing contentLabel",
      });
    }
    if (!(batchIndex >= 1 && batchIndex <= 5)) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid batchIndex",
      });
    }

    // Канонизируем лейбл и выводим суффикс варианта (если не передан)
    const canon = toCanonLabel(body.contentLabel);
    const variantSuffix =
      (body.variantSuffix && body.variantSuffix.trim()) ||
      SUFFIX_BY_CONTENT[canon];
    if (!variantSuffix) {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot infer variant suffix",
      });
    }

    // Цена за 1 банку в выбранной партии
    const unit = unitPrice(canon, batchIndex as 1 | 2 | 3 | 4 | 5);
    const batchCount = BATCH_INDEX_TO_COUNT[batchIndex as 1 | 2 | 3 | 4 | 5];

    // SKU техтовара: ПОЛІСОЛ-<суффикс>-<batchIndex>, напр. ПОЛІСОЛ-К-2
    const techSku = `ПОЛІСОЛ-${variantSuffix}-${batchIndex}`;
    const name = isKvas(canon)
      ? `${canon} (ціна в партії ${batchCount})`
      : `ПОЛІСОЛ™«${canon}»(ціна в партії ${batchCount})`;

    // Доступ к Ecwid
    const config = useRuntimeConfig();
    const storeId = String(config.NUXT_ECWID_STORE_ID || "");
    const token = String(config.NUXT_ECWID_TOKEN || "");
    if (!storeId || !token) {
      throw createError({
        statusCode: 500,
        statusMessage: "Missing Ecwid credentials",
      });
    }

    const ecwid = new EcwidClient(storeId, token);

    // Если такой SKU уже есть — возвращаем его
    const existing = await ecwid.findBySku(techSku);
    if (existing?.id) {
      return {
        ok: true,
        productId: existing.id,
        unitPrice: unit,
        batchIndex,
        batchCount,
        duplicate: true,
      };
    }

    // (Опционально) Положить в служебную категорию (если указан env NUXT_PV_CATEGORY_ID)
    const catIdEnv = process.env.NUXT_PV_CATEGORY_ID;
    const categoryIds = catIdEnv ? [Number(catIdEnv)] : undefined;

    // Создаём техтовар с ценой за 1 банку
    const productId = await ecwid.createProduct({
      name,
      sku: techSku,
      price: unit,
      description: `Ціна за 1 банку у партії ${batchCount}.`,
      attributes: [
        { name: "Партія", value: String(batchCount) },
        { name: "Вміст", value: canon },
      ],
      categoryIds,
    } as any);

    return { ok: true, productId, unitPrice: unit, batchIndex, batchCount };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.statusMessage || e?.message || "Unknown error",
      status: e?.statusCode || 500,
    };
  }
});
