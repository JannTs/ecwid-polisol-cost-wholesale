// server/api/polisol/quote.post.ts
// server/api/polisol/quote.post.ts
import { defineEventHandler, readBody, createError, setResponseHeader } from 'h3';
import { EcwidClient } from '~~/utils/ecwid';
import {
  toCanonLabel,
  unitPrice,
  BATCH_INDEX_TO_COUNT,
  isKvas,
  SUFFIX_BY_CONTENT,
} from '~~/utils/polisol';

export default defineEventHandler(async (event) => {
  // --- CORS (пока звёздочка, потом можно заменить на whitelist доменов) ---
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');

  // --- Читаем тело запроса ---
  const body = await readBody<{
    contentLabel?: string;
    batchIndex?: number;
  }>(event);

  if (!body.contentLabel || !body.batchIndex) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing contentLabel or batchIndex',
    });
  }

  // --- Определяем канонический лейбл ---
  const canon = toCanonLabel(body.contentLabel);
  if (!canon) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown contentLabel: ${body.contentLabel}`,
    });
  }

  // --- Определяем SKU-суффикс по канону ---
  const suffix = SUFFIX_BY_CONTENT[canon];
  if (!suffix) {
    throw createError({
      statusCode: 400,
      statusMessage: `No SKU suffix for content: ${canon}`,
    });
  }

  // --- Определяем размер партии ---
  const batchIndex = body.batchIndex as 1 | 2 | 3 | 4 | 5;
  const batchCount = BATCH_INDEX_TO_COUNT[batchIndex];
  if (!batchCount) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid batchIndex: ${batchIndex}`,
    });
  }

  // --- Цена ---
  const unit = unitPrice(canon, batchIndex);

  // --- Ecwid клиент ---
  const ecwid = new EcwidClient(process.env.NUXT_ECWID_STORE_ID!, process.env.NUXT_ECWID_TOKEN!);

  // --- Категория (служебная "Скло-опт") ---
  const catIdEnv = process.env.NUXT_PV_CATEGORY_ID;
  let categoryIds: number[] | undefined = undefined;
  if (catIdEnv) {
    const id = Number(catIdEnv);
    if (Number.isFinite(id) && id > 0) {
      categoryIds = [id];
    }
  }

  // --- Генерация читаемого имени товара ---
  const name = isKvas(canon)
    ? `${canon} (ціна в партії ${batchCount})`
    : `ПОЛІСОЛ™ ${canon} (ціна в партії ${batchCount})`;

  // --- Технический SKU ---
  const techSku = `ПОЛІСОЛ-${suffix}-${batchIndex}`;

  // --- Подготовка payload ---
  const payload: any = {
    name,
    sku: techSku,
    price: unit,
    description: `Ціна за 1 банку у партії ${batchCount}.`,
    attributes: [
      { name: 'Партія', value: String(batchCount) },
      { name: 'Вміст', value: canon },
    ],
  };
  if (categoryIds) {
    payload.categoryIds = categoryIds;
  }

  // --- Создание товара ---
  try {
    const productId = await ecwid.createProduct(payload);

    return {
      ok: true,
      productId,
      unitPrice: unit,
      batchIndex,
      batchCount,
    };
  } catch (err: any) {
    console.error('Ecwid error', err);
    throw createError({
      statusCode: 500,
      statusMessage: err?.message || 'Ecwid API error',
    });
  }
});
