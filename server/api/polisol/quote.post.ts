// server/api/polisol/quote.post.ts - v57
// v57-tenant — customSlug кирилицею: "полісол-{вміст}-{N}-банок" (нижній регістр)
// + як і раніше: multi-tenant (test/prod), PV-категорія, картинка з варіації, ідемпотентність по SKU
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

const KEY_TO_CANON: Record<string, string> = {
  classic: 'Класичний',
  mans: 'Чоловіча Сила',
  mother: "Матусине здоров'я",
  rosehip: 'Шипшина',
  cranberry: 'Журавлина',
  kvas: 'Квас трипільський',
  kvas_white: 'Квас трипільський (білий)',
  kvas_coriander: 'Квас трипільський з коріандром',
  // альтернативи з фронта
  cholovicha: 'Чоловіча Сила',
  matusyne: "Матусине здоров'я",
  kvas_bilyi: 'Квас трипільський (білий)',
  kvas_koriandr: 'Квас трипільський з коріандром',
};

function buildProductName(humanLabel: string, batchCount: number, kvas: boolean): string {
  if (kvas) return `${humanLabel} (ціна в партії ${batchCount})`;
  const quoted = humanLabel.match(/[«»]/) ? humanLabel : `«${humanLabel}»`;
  return `ПОЛІСОЛ™ ${quoted} (ціна в партії ${batchCount})`;
}

/** ---------- UA slug helpers (кирилиця, нижній регістр) ---------- */
function normalizeApostrophes(s: string): string {
  return String(s || '')
    .replace(/[`´’ʼ′]/g, "'") // уніфікуємо апостроф
    .replace(/[«»"]/g, ''); // прибираємо лапки
}
function toCyrSlug(s: string): string {
  // лишаемо букви/цифри; решту → дефіс; схлопуємо дефіси; прибираємо крайні
  return normalizeApostrophes(s)
    .toLowerCase()
    .replace(/[^0-9\p{L}]+/gu, '-') // усе не літера/цифра → '-'
    .replace(/-+/g, '-') // схлопнути повтори '-'
    .replace(/^-|-$/g, ''); // обрізати краї
}
function buildCyrCustomSlug(canonContent: string, batchCount: number): string {
  // приклад: "полісол-класичний-15-банок"
  return toCyrSlug(`полісол ${canonContent} ${batchCount} банок`);
}

/** ---- Ecwid REST (per-tenant) ---- */
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

async function findMasterByBaseSku(ctx: TenantCtx, baseSku: string) {
  const j = await ecwidFetch(ctx, '/products', { sku: baseSku });
  const items = Array.isArray(j?.items) ? j.items : [];
  return items[0] || null;
}
async function getProductFull(ctx: TenantCtx, productId: number) {
  return await ecwidFetch(ctx, `/products/${productId}`);
}
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
async function uploadMainImageByExternalUrl(
  ctx: TenantCtx,
  productId: number,
  externalUrl: string
) {
  await ecwidFetch(ctx, `/products/${productId}/image`, { externalUrl }, { method: 'POST' });
}

/** --------------------- Handler --------------------- */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Access-Control-Allow-Origin', '*');
  setResponseHeader(event, 'Access-Control-Allow-Headers', 'Content-Type, Authorization');
  setResponseHeader(event, 'Access-Control-Allow-Methods', 'POST, OPTIONS');

  const ctxAll = getTenantCtx(event);
  const ctx: TenantCtx = { storeId: ctxAll.storeId, token: ctxAll.token };

  // явная проверка конфігурації
  if (!ctx.storeId || !ctx.token) {
    throw createError({
      statusCode: 500,
      statusMessage: 'Server misconfiguration',
      message: `Missing ECWID credentials for tenant=${ctxAll.tenant}`,
    });
  }

  const body = await readBody<{
    contentLabel?: string;
    contentKey?: string;
    batchIndex?: number; // 1..5
    customSlug?: string; // опціонально — якщо хочеш задати вручну
  }>(event);

  // Нормалізація входу
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

  const canon = toCanonLabel(humanLabel); // канонічна назва «Вмісту»
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

  // Визначаємо бажаний slug: або з тіла, або генеруємо кириличний
  const explicitSlug = typeof body?.customSlug === 'string' && body.customSlug.trim().length > 0;
  const desiredSlug = explicitSlug
    ? toCyrSlug(body!.customSlug!)
    : buildCyrCustomSlug(canon, batchCount);

  const client = new EcwidClient(ctxAll.storeId, ctxAll.token);

  // Картинка з варіації (по базовому SKU, без -idx)
  const baseVariationSku = `${FAMILY_PREFIX}${suffix}`;
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
    // 1) Ідемпотентність по SKU
    const existing = await client.findFirstProductBySku(sku);
    if (existing) {
      const patch: any = {};
      if (existing.name !== name) patch.name = name;
      if (Number(existing.price) !== Number(price)) patch.price = price;
      if (Number(existing.weight) !== 0.8) patch.weight = 0.8;

      // Додаємо PV-категорію м'яко
      if (ctxAll.pvCategoryId) {
        const existingIds = Array.isArray(existing.categoryIds)
          ? existing.categoryIds
              .map((x: any) => Number(x))
              .filter((n: number) => Number.isFinite(n) && n > 0)
          : [];
        if (!existingIds.includes(ctxAll.pvCategoryId)) {
          patch.categoryIds = Array.from(new Set([...existingIds, ctxAll.pvCategoryId]));
        }
      }

      // customSlug: якщо прийшов явно — ставимо; якщо пусто — ставимо згенерований
      if (explicitSlug) {
        patch.customSlug = desiredSlug;
      } else if (!existing.customSlug) {
        patch.customSlug = desiredSlug;
      }

      if (Object.keys(patch).length) await client.updateProduct(existing.id, patch);

      if (!existing?.imageUrl && variationImageUrl) {
        await uploadMainImageByExternalUrl(ctx, existing.id, variationImageUrl);
      }

      return { ok: true, productId: existing.id, unitPrice: price, batchIndex: idx, batchCount };
    }

    // 2) Створення
    const payload: any = {
      name,
      sku,
      price,
      enabled: true,
      customSlug: desiredSlug, // кириличний slug при створенні
      description: `Оптова ціна для партії ${batchCount} шт. Вміст: ${humanLabel}.`,
      attributes: [
        { name: 'Партія', value: String(batchCount) },
        { name: 'Вміст', value: humanLabel },
      ],
      weight: 0.8,
    };
    if (ctxAll.pvCategoryId) payload.categoryIds = [ctxAll.pvCategoryId];

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
