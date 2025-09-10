// server/api/polisol/quote.post.ts v43
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

// Новый: безопасный fetch к Ecwid REST
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

// Новый: найти мастер по базовому SKU вариации ("ПОЛІСОЛ-Ш", без индекса)
async function findMasterByBaseSku(baseSku: string) {
  // Ecwid вернёт товар, содержащий этот SKU (включая SKU вариаций). Требуется точное совпадение. :contentReference[oaicite:2]{index=2}
  const j = await ecwidFetch('/products', { sku: baseSku });
  const items = Array.isArray(j?.items) ? j.items : [];
  return items[0] || null; // ожидаем, что это мастер
}

// Новый: прочитать товар целиком (с combinations и image URLs)
async function getProductFull(productId: number) {
  // В ответе поля вариаций содержат thumbnailUrl / imageUrl / smallThumbnailUrl / hdThumbnailUrl / originalImageUrl. :contentReference[oaicite:3]{index=3}
  return await ecwidFetch(`/products/${productId}`);
}

// Новый: вытащить URL исходной картинки вариации по её базовому SKU
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

// Новый: загрузить основную картинку вновь созданному товару «по ссылке» вариации
async function uploadMainImageByExternalUrl(productId: number, externalUrl: string) {
  // Ecwid сам создаст все размеры на базе одного файла; дополнительные размеры загружать не требуется. :contentReference[oaicite:4]{index=4}
  await ecwidFetch(`/products/${productId}/image`, { externalUrl }, { method: 'POST' });
}

// Новый: генерация customSlug (кириллица поддерживается Ecwid, но при желании можно сделать транслитерацию)
function buildCustomSlug(suffix: string, idx: number, kvas: boolean) {
  // Пример: "ПОЛІСОЛ-Ш-1-ОПТОМ" / "ПОЛІСОЛ-КВ-2-ОПТОМ"
  const tail = 'ОПТОМ';
  return `${FAMILY_PREFIX}${suffix}-${idx}-${tail}`;
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
    contentKey?: string; // ASCII-альтернатива
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

  // --- Новый блок: подготовим данные вариации мастер-товара (для картинки и, при желании, проверки batch)
  const baseVariationSku = `${FAMILY_PREFIX}${suffix}`; // без -idx
  let variationImageUrl: string | null = null;

  try {
    const master = await findMasterByBaseSku(baseVariationSku); // точный поиск по SKU вариации. :contentReference[oaicite:5]{index=5}
    if (master?.id) {
      const full = await getProductFull(master.id); // нужен массив combinations + ссылки картинок. :contentReference[oaicite:6]{index=6}
      variationImageUrl = pickVariationOriginalUrl(full, baseVariationSku);
    }
  } catch (e) {
    // ничего критичного: просто не поставим картинку при создании
    console.warn('[POLISOL quote] failed to load variation image', e);
  }

  try {
    // 1) Ищем по SKU (идемпотентность)
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
      // Если не было слага – зададим (мягко, чтобы не ломать уже ручные правки)
      if (!existing.customSlug) {
        patch.customSlug = buildCustomSlug(suffix, idx, isKvas(canon));
      }
      if (Object.keys(patch).length) await client.updateProduct(existing.id, patch);

      // Если у существующего товара нет основной картинки, а у вариации есть — загрузим
      if (!existing?.imageUrl && variationImageUrl) {
        await uploadMainImageByExternalUrl(existing.id, variationImageUrl);
      }

      return { ok: true, productId: existing.id, unitPrice: price, batchIndex: idx, batchCount };
    }

    // 2) Создаём новый «технічний» товар
    const payload: any = {
      name,
      sku,
      price,
      enabled: true,
      customSlug: buildCustomSlug(suffix, idx, isKvas(canon)), // <- читаемый URL-хвост
      description: `Оптова ціна для партії ${batchCount} шт. Вміст: ${humanLabel}.`,
      attributes: [
        { name: 'Партія', value: String(batchCount) },
        { name: 'Вміст', value: humanLabel },
      ],
    };
    if (categoryId) payload.categoryIds = [categoryId];

    const created = await client.createProduct(payload);

    // Подтянем основную картинку с вариации, если нашли URL
    if (variationImageUrl) {
      await uploadMainImageByExternalUrl(created.id, variationImageUrl); // загрузка по внешней ссылке. :contentReference[oaicite:7]{index=7}
    }

    return { ok: true, productId: created.id, unitPrice: price, batchIndex: idx, batchCount };
  } catch (e: any) {
    // Пробрасываем подробности наружу (в т.ч. 403 от Ecwid)
    const statusGuess = Number(e?._status) || Number(e?.statusCode) || 502;
    throw createError({
      statusCode: statusGuess,
      statusMessage: 'Ecwid API error',
      message: String(e?.message || e || 'Ecwid error'),
    });
  }
});
