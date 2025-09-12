// server/api/polisol/quote.post.ts - v46
// v45-tenant — на  базе вашей текущей версии:
//   + поддержка двух тенантов (test/prod) через utils/tenant
//   + мягкое присвоение категории PV (NUXT_PV_CATEGORY_ID__*)
//   + customSlug для SEO (ПОЛІСОЛ-<суф>-<idx>-ОПТОМ)
//   + подтягивание картинки из вариации мастер-товара по базовому SKU (ПОЛІСОЛ-<суф>)
//   + идемпотентность по SKU (как и было)
import { defineEventHandler, readBody, setResponseHeader, createError } from 'h3';
import { EcwidClient } from '~~/utils/ecwid';
import {
  toCanonLabel,
  unitPrice,
  BATCH_INDEX_TO_COUNT,
  isKvas,
  SUFFIX_BY_CONTENT,
} from '~~/utils/polisol';
import { getTenantCtx } from '~~/utils/tenant';

const FAMILY_PREFIX = 'ПОЛІСОЛ-';

// ASCII-ключи для CLI/интеграций без кириллицы (опционно)
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

/** --------- Ecwid REST helpers (per-tenant) --------- */
type TenantCtx = { storeId: string; token: string };
async function ecwidFetch(
  ctx: TenantCtx,
  path: string,
  qs: Record<string, any> = {},
  opts: RequestInit = {}
) {
  const u = new URL(`https://app.ecwid.com/api/v3/${ctx.storeId}${path}`);
  Object.entries(qs).forEach(([k, v]) => u.searchParams.set(k, String(v)));
  const res = await fetch(u.toString(), {
    ...opts,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
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
async function findMasterByBaseSku(ctx: TenantCtx, baseSku: string) {
  // Ecwid ищет по ТOЧНОМУ SKU (включая SKU вариаций)
  const j = await ecwidFetch(ctx, '/products', { sku: baseSku });
  const items = Array.isArray(j?.items) ? j.items : [];
  return items[0] || null;
}

// Прочитать товар полностью (нужны combinations с imageUrl/…)
async function getProductFull(ctx: TenantCtx, productId: number) {
  return await ecwidFetch(ctx, `/products/${productId}`);
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
async function uploadMainImageByExternalUrl(
  ctx: TenantCtx,
  productId: number,
  externalUrl: string
) {
  // Ecwid сам создаёт все размеры на базе одного файла
  await ecwidFetch(ctx, `/products/${productId}/image`, { externalUrl }, { method: 'POST' });
}

// Человекочитаемый slug (можно заменить на транслитерацию)
function buildCustomSlug(suffix: string, idx: number, _kvas: boolean) {
  // Примеры: "ПОЛІСОЛ-Ш-1-ОПТОМ", "ПОЛІСОЛ-КВ-2-ОПТОМ"
  const tail = 'ОПТОМ';
  return `${FAMILY_PREFIX}${suffix}-${idx}-${tail}`;
}

/** --------------------- Handler --------------------- */
export default defineEventHandler(async (event) => {
  // CORS
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');

  // Контекст выбранного тенанта
  const ctxAll = getTenantCtx(event);
  const ctx: TenantCtx = { storeId: ctxAll.storeId, token: ctxAll.token };
  if (!ctx.storeId || !ctx.token) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Server misconfiguration',
      message: `Missing ECWID credentials for tenant=${ctxAll.tenant}`,
    });
  }

  const pvCategoryId = ctxAll.pvCategoryId;

  const body = await readBody<{
    contentLabel?: string;
    contentKey?: string; // ASCII-alias
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

  // Ecwid client для выбранного тенанта
  const client = new EcwidClient(ctxAll.storeId, ctxAll.token);

  // Подготовим данные вариации мастер-товара (для картинки)
  const baseVariationSku = `${FAMILY_PREFIX}${suffix}`; // без -idx
  let variationImageUrl: string | null = null;

  try {
    const master = await findMasterByBaseSku(ctx, baseVariationSku);
    if (master?.id) {
      const full = await getProductFull(ctx, master.id);
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

      // v45: мягко ДОБАВЛЯЕМ PV-категорию, не затирая остальные
      if (pvCategoryId) {
        const existingIds = Array.isArray(existing.categoryIds)
          ? existing.categoryIds
              .map((x: any) => Number(x))
              .filter((n: number) => Number.isFinite(n) && n > 0)
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
        await uploadMainImageByExternalUrl(ctx, existing.id, variationImageUrl);
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
      await uploadMainImageByExternalUrl(ctx, created.id, variationImageUrl);
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
