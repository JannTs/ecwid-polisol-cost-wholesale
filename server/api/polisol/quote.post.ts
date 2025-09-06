import { defineEventHandler, readBody, setResponseHeader, createError } from 'h3';
import { EcwidClient } from '~~/utils/ecwid';
import {
  toCanonLabel,
  unitPrice,
  BATCH_INDEX_TO_COUNT,
  isKvas,
  SUFFIX_BY_CONTENT,
} from '~~/utils/polisol';

const FAMILY_PREFIX = 'ПОЛІСОЛ-';

// ASCII-ключи для CLI/интеграций без кириллицы
const KEY_TO_CANON: Record<string, string> = {
  classic: 'Класичний',
  mans: 'Чоловіча Сила',
  mother: "Матусине Здоров'я",
  rosehip: 'Шипшина',
  cranberry: 'Журавлина',
  kvas: 'Квас трипільський',
  kvas_white: 'Квас трипільський (білий)',
  kvas_coriander: 'Квас трипільський з коріандром',
};

function buildProductName(humanLabel: string, batchCount: number, kvas: boolean): string {
  if (kvas) return `${humanLabel} (ціна в партії ${batchCount})`;
  // гарантируем пробел между ™ и «»
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
    contentKey?: string; // <- ASCII альтернативa
    batchIndex?: number; // 1..5
  }>(event);

  // Выбираем label либо по contentKey
  let humanLabel = (body?.contentLabel || '').trim();
  if (!humanLabel && body?.contentKey) {
    const key = String(body.contentKey).trim().toLowerCase();
    if (KEY_TO_CANON[key]) humanLabel = KEY_TO_CANON[key];
  }

  const idx = Number(body?.batchIndex || 0);
  if (!humanLabel || !idx || idx < 1 || idx > 5) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: 'Missing or invalid contentLabel/contentKey or batchIndex',
    });
  }

  const canon = toCanonLabel(humanLabel);
  const suffix = SUFFIX_BY_CONTENT[canon];
  if (!suffix) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `Unknown content: ${humanLabel}`,
    });
  }

  const price = unitPrice(canon, idx);
  if (price <= 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: `No price for ${humanLabel} (batchIndex=${idx})`,
    });
  }

  const batchCount = BATCH_INDEX_TO_COUNT[idx]; // 15..75
  const sku = `${FAMILY_PREFIX}${suffix}-${idx}`;
  const name = buildProductName(humanLabel, batchCount, isKvas(canon));

  const client = new EcwidClient(String(NUXT_ECWID_STORE_ID), String(NUXT_ECWID_TOKEN));
  const categoryId =
    Number(
      NUXT_ECWID_WHOLESALE_CATEGORY_ID || NUXT_ECWID_TECH_CATEGORY_ID || NUXT_ECWID_CATEGORY_ID || 0
    ) || undefined;

  try {
    // 1) Ищем по SKU
    const existing = await client.findFirstProductBySku(sku);

    if (existing) {
      const patch: any = {};
      if (existing.name !== name) patch.name = name;
      if (Number(existing.price) !== Number(price)) patch.price = price;
      if (
        categoryId &&
        (!Array.isArray(existing.categoryIds) || existing.categoryIds[0] !== categoryId)
      ) {
        patch.categoryIds = [categoryId];
      }
      if (Object.keys(patch).length) await client.updateProduct(existing.id, patch);

      return { ok: true, productId: existing.id, unitPrice: price, batchIndex: idx, batchCount };
    }

    // 2) Создаём новый
    const payload: any = {
      name,
      sku,
      price,
      enabled: true,
      description: `<p>Оптова ціна для партії <b>${batchCount}</b> шт. Вміст: <b>${humanLabel}</b>.</p>`,
      attributes: [
        { name: 'Партія', value: String(batchCount) },
        { name: 'Вміст', value: humanLabel },
      ],
    };
    if (categoryId) payload.categoryIds = [categoryId];

    const created = await client.createProduct(payload);
    return { ok: true, productId: created.id, unitPrice: price, batchIndex: idx, batchCount };
  } catch (e: any) {
    // Пробрасываем подробности наружу (в т.ч. 403 от Ecwid)
    const statusGuess = Number(e?._status) || 502;
    throw createError({
      statusCode: statusGuess,
      statusMessage: 'Ecwid API error',
      message: String(e?.message || e || 'Ecwid error'),
    });
  }
});
