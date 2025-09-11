// server/api/polisol/quote.post.ts
// v44 — техтовар из вариации мастер-товара + customSlug + загрузка картинки вариации
//     + присвоение категории PV (NUXT_PV_CATEGORY_ID) при создании/обновлении
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

// ASCII-ключи для CLI/интеграций без кириллицы (опционально)
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
  const quoted = humanLabel.match(/[«»]/) ? humanLabel : `«${humanLabel}»`;
  return `ПОЛІСОЛ™ ${quoted} (ціна в партії ${batchCount})`;
}

/** ---- Ecwid REST helpers (локально, без зависимостей проекта) ---- */
async function ecwidFetch(path: string, qs: Record<string, any> = {}, opts: RequestInit = {}) {
  const { NUXT_ECWID_STORE_ID, NUXT_ECWID_TOKEN } = useRuntimeConfig();
  const u = new URL(`https://app.ecwid.com/api/v3/${NUXT_ECWID_STORE_ID}${path}`);
  Object.entries(qs).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const res = await fetch(u.toString(), {
    ...opts,
    headers: {
      Authorization: `Bearer ${NUXT_ECWID_TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    cache: 'no-store',
  });
  const txt = await res.text();
  let json: any = null;
  try {
    json = txt ? JSON.parse(txt) : null;
  } catch {}
  if (!res.ok) {
    const msg = json?.errorMessage || json?.message || res.statusText;
    throw createError({ statusCode: res.status, statusMessage: 'Ecwid API error', message: msg });
  }
  return json ?? {};
}

// Найти мастер-товар по базовому SKU вариации (например, "ПОЛІСОЛ-Ш")
async function findMasterByBaseSku(baseSku: string) {
  // Ecwid ищет по точному SKU (включая SKU вариаций)
  const j = await ecwidFetch('/products', { sku: baseSku });
  const items = Array.isArray(j?.items) ? j.items : [];
  return items[0] || null;
}

// Прочитать товар полностью (нужны combinations с imageUrl/…)
async function getProductFull(productId: number) {
  return await ecwidFetch(`/products/${productId}`);
}

// Вытянуть URL исходной картинки вариации по её базовому SKU
function pickVariationOriginalUrl(product: any, baseSku: string): string | null {
  const combos = Array.isArray(product?.combinations) ? product.combinations : [];
  const v = combos.find((c: any) => (c?.sku || '').trim() === baseSku);
  const url =
    v?.originalImageUrl ||
    v?.imageUrl ||
    v?.hdThumbnailUrl ||
    v?.thumbnailUrl ||
    v?.smallThumbnailUrl ||
    null;
  return url || null;
}

// Загрузить основную картинку для созданного товара по внешней ссылке
async function uploadMainImageByExternalUrl(productId: number, externalUrl: string) {
  // Ecwid сам создаёт все размеры на базе одного файла
  await ecwidFetch(`/products/${productId}/image`, { externalUrl }, { method: 'POST' });
}

// Человекочитаемый slug (можно заменить на транслитерацию)
function buildCustomSlug(suffix: string, idx: number, _kvas: boolean) {
  // Примеры: "ПОЛІСОЛ-Ш-1-ОПТОМ", "ПОЛІСОЛ-КВ-2-ОПТОМ"
  const tail = 'ОПТОМ';
  return `${FAMILY_PREFIX}${suffix}-${idx}-${tail}`;
}

// Утилита выбора валидной категорийки (PV приоритетно)
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export default defineEventHandler(async (event) => {
  // CORS (при необходимости)
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');

  const {
    NUXT_ECWID_STORE_ID,
    NUXT_ECWID_TOKEN,
    NUXT_PV_CATEGORY_ID, // ← добавлено в v44
    NUXT_ECWID_WHOLESALE_CATEGORY_ID,
    NUXT_ECWID_TECH_CATEGORY_ID,
    NUXT_ECWID_CATEGORY_ID,
  } = useRuntimeConfig();

  // Итоговый ID категории для техтоваров: PV > TECH > WHOLESALE > DEFAULT
  const pvCategoryId =
    toNum(NUXT_PV_CATEGORY_ID) ??
    toNum(NUXT_ECWID_TECH_CATEGORY_ID) ??
    toNum(NUXT_ECWID_WHOLESALE_CATEGORY_ID) ??
    toNum(NUXT_ECWID_CATEGORY_ID);

  const body = await readBody<{
    contentLabel?: string;
    contentKey?: string;
    batchIndex?: number; // 1..5
  }>(event);

  // Нормализация входа
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

  // Подготовим данные вариации мастер-товара (для картинки)
  const baseVariationSku = `${FAMILY_PREFIX}${suffix}`; // без -idx
  let variationImageUrl: string | null = null;

  try {
    const master = await findMasterByBaseSku(baseVariationSku);
    if (master?.id) {
      const full = await getProductFull(master.id);
      variationImageUrl = pickVariationOriginalUrl(full, baseVariationSku);
    }
  } catch (e) {
    console.warn('[POLISOL quote] failed to load variation image', e);
  }

  try {
    // 1) Идемпотентный поиск по SKU
    const existing = await client.findFirstProductBySku(sku);
    if (existing) {
      const patch: any = {};
      if (existing.name !== name) patch.name = name;
      if (Number(existing.price) !== Number(price)) patch.price = price;

      // v44: мягко ДОБАВЛЯЕМ PV-категорию, не затирая остальные
      if (pvCategoryId) {
        const existingIds = Array.isArray(existing.categoryIds)
          ? existing.categoryIds
              .map((x: any) => Number(x))
              .filter((n: number) => Number.isFinite(n))
          : [];
        if (!existingIds.includes(pvCategoryId)) {
          patch.categoryIds = Array.from(new Set([...existingIds, pvCategoryId]));
        }
      }

      // Если не было слага – зададим (мягко, чтобы не ломать ручные правки)
      if (!existing.customSlug) {
        patch.customSlug = buildCustomSlug(suffix, idx, isKvas(canon));
      }
      if (Object.keys(patch).length) await client.updateProduct(existing.id, patch);

      if (!existing?.imageUrl && variationImageUrl) {
        await uploadMainImageByExternalUrl(existing.id, variationImageUrl);
      }

      return { ok: true, productId: existing.id, unitPrice: price, batchIndex: idx, batchCount };
    }

    // 2) Создание «технічного» товара
    const payload: any = {
      name,
      sku,
      price,
      enabled: true,
      customSlug: buildCustomSlug(suffix, idx, isKvas(canon)),
      description: `Оптова ціна для партії ${batchCount} шт. Вміст: ${humanLabel}.`,
      attributes: [
        { name: 'Партія', value: String(batchCount) },
        { name: 'Вміст', value: humanLabel },
      ],
    };
    if (pvCategoryId) payload.categoryIds = [pvCategoryId];

    const created = await client.createProduct(payload);

    if (variationImageUrl) {
      await uploadMainImageByExternalUrl(created.id, variationImageUrl);
    }

    return { ok: true, productId: created.id, unitPrice: price, batchIndex: idx, batchCount };
  } catch (e: any) {
    const statusGuess = Number(e?._status) || Number(e?.statusCode) || 502;
    throw createError({
      statusCode: statusGuess,
      statusMessage: 'Ecwid API error',
      message: String(e?.message || e || 'Ecwid error'),
    });
  }
});
