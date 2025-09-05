// server/api/polisol/quote.post.ts
import { defineEventHandler, readBody, setResponseHeader, createError } from 'h3';
import { EcwidClient } from '../../../utils/ecwid';
import {
  toCanonLabel,
  unitPrice,
  BATCH_INDEX_TO_COUNT,
  isKvas,
  SUFFIX_BY_CONTENT,
} from '../../../utils/polisol';

const FAMILY_PREFIX = 'ПОЛІСОЛ-';

// Формат имени по требованиям:
// - для ПОЛІСОЛ™: "ПОЛІСОЛ™ «<Вміст>» (ціна в партії <N>)"
// - для квасу:    "<Вміст> (ціна в партії <N>)"
function buildProductName(humanLabel: string, batchCount: number, kvas: boolean): string {
  if (kvas) {
    return `${humanLabel} (ціна в партії ${batchCount})`;
  }
  // гарантируем пробел между ™ и «
  const quoted = humanLabel.match(/[«»]/) ? humanLabel : `«${humanLabel}»`;
  return `ПОЛІСОЛ™ ${quoted} (ціна в партії ${batchCount})`;
}

export default defineEventHandler(async (event) => {
  // CORS
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');

  const {
    NUXT_ECWID_STORE_ID,
    NUXT_ECWID_TOKEN,
    NUXT_ECWID_WHOLESALE_CATEGORY_ID,
    NUXT_ECWID_TECH_CATEGORY_ID,
    NUXT_ECWID_CATEGORY_ID,
  } = useRuntimeConfig();

  const body = await readBody<{
    contentLabel?: string;
    batchIndex?: number; // 1..5
  }>(event);

  const humanLabel = (body?.contentLabel || '').trim();
  const idx = Number(body?.batchIndex || 0);

  if (!humanLabel || !idx || idx < 1 || idx > 5) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing or invalid contentLabel / batchIndex',
    });
  }

  // Канонизация и суффикс
  const canon = toCanonLabel(humanLabel); // нормализованный ключ
  const suffix = SUFFIX_BY_CONTENT[canon];
  if (!suffix) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `Unknown contentLabel: ${humanLabel}`,
    });
  }

  // Цена за единицу
  const price = unitPrice(canon, idx);
  if (price <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `No price for ${humanLabel} (batchIndex=${idx})`,
    });
  }

  const batchCount = BATCH_INDEX_TO_COUNT[idx]; // 15/30/45/60/75
  const sku = `${FAMILY_PREFIX}${suffix}-${idx}`;

  // Готовим Ecwid client
  const client = new EcwidClient(String(NUXT_ECWID_STORE_ID), String(NUXT_ECWID_TOKEN));
  const categoryId =
    Number(
      NUXT_ECWID_WHOLESALE_CATEGORY_ID || NUXT_ECWID_TECH_CATEGORY_ID || NUXT_ECWID_CATEGORY_ID || 0
    ) || undefined;

  // Имя товара по правилам
  const name = buildProductName(humanLabel, batchCount, isKvas(canon));

  // === ИДЕМПОТЕНТНОСТЬ ПО SKU ===
  // 1) Ищем существующий товар с таким SKU
  const existing = await client.findFirstProductBySku(sku);

  if (existing) {
    // 2) Если найден, при необходимости обновим имя, цену, категорию
    const patch: any = {};
    if (existing.name !== name) patch.name = name;
    if (Number(existing.price) !== Number(price)) patch.price = price;
    if (
      categoryId &&
      (!Array.isArray(existing.categoryIds) || existing.categoryIds[0] !== categoryId)
    ) {
      patch.categoryIds = [categoryId];
    }

    if (Object.keys(patch).length > 0) {
      await client.updateProduct(existing.id, patch);
    }

    return {
      ok: true,
      productId: existing.id,
      unitPrice: price,
      batchIndex: idx,
      batchCount,
    };
  }

  // 3) Если нет — создаём новый
  const payload: any = {
    sku,
    name,
    price,
    enabled: true,
    // необязательные поля по вкусу:
    // unlimited: true,
    // trackInventory: false,
    // manageStock: false,
  };
  if (categoryId) payload.categoryIds = [categoryId];

  // (опционально) описание — компактное
  payload.description = `<p>Оптова ціна для партії <b>${batchCount}</b> шт. Вміст: <b>${humanLabel}</b>.</p>`;

  const created = await client.createProduct(payload);

  return {
    ok: true,
    productId: created.id,
    unitPrice: price,
    batchIndex: idx,
    batchCount,
  };
});
