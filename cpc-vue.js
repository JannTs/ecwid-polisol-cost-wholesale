/* POLISOL widget v2025-09-06-38  */
/* ecwid-polisol-cost-wholesale — CPC VUE WIDGET (v2025-09-06-38)
   - Жёсткий таргетинг: работает ТОЛЬКО на мастер-карточке POLISOL:
       * SKU начинается с "ПОЛІСОЛ-"
       * И page.productId === window.POLISOL_MASTER_PRODUCT_ID (777... задан извне)
   - Без автодетекта/learning и без localStorage.
   - Остальное: заголовок описания по «официалке», сводка корзины, ссылка «Оформити замовлення» → #!/cart,
     предохранитель на странице CART.
*/
(() => {
      console.info('POLISOL widget v2025-09-06-38 ready');

      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app';
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';

      // Заголовок описания
      const DESC_KEY = 'ProductDetails.description_title';
      const DESC_DEFAULT = 'Деталі';
      const DESC_POLISOL = 'Виберіть партію, вміст та кількість для додавання в кошик';

      let pricingCache = null;
      let initialPriceText = null;

      const __cpc = (window.__cpc = window.__cpc || {
            optsBound: false, mo: null, moScheduled: false, warned: new Set(),
            cartBound: false, adding: false, currentSku: null, isTargetMemo: null,
            cssInjected: false, summaryFP: null, cartLinkBound: false, pageType: null,
            cartSafetyBound: false, cartGuardTimer: null, cartGuardState: null,
            currentProductId: null
      });

      // ----- MASTER ID (жёстко из window, без fallback)
      function getMasterId() {
            const id = Number(window.POLISOL_MASTER_PRODUCT_ID || 0);
            return (isFinite(id) && id > 0) ? id : null;
      }
      function isMasterPolisolPage() {
            if (__cpc.pageType !== 'PRODUCT') return false;
            const masterId = getMasterId();
            if (!masterId) return false;
            const sku = getSku() || '';
            if (!sku || sku.indexOf(FAMILY_PREFIX) !== 0) return false;
            return __cpc.currentProductId === masterId;
      }

      // ----- Ecwid helpers
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }
      function fetchCart() { return new Promise((resolve) => { try { Ecwid.Cart.get((cart) => resolve(cart || { items: [] })); } catch (_) { resolve({ items: [] }); } }); }

      // ----- Лок блокировки партии (product page)
      const LOCK_KEY = 'POLISOL_LOCK';
      const getLock = () => { try { return JSON.parse(sessionStorage.getItem(LOCK_KEY) || 'null'); } catch (_) { return null; } };
      const setLock = (o) => { try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(o)); } catch (_) { } };
      const clearLock = () => { try { sessionStorage.removeItem(LOCK_KEY); } catch (_) { } };

      // ----- FP ожидание (для add-to-cart)
      async function waitForCartChange(prevFP, tries = 10, delay = 300) {
            for (let i = 0; i < tries; i++) {
                  const cart = await fetchCart();
                  const fp = cartFingerprint(cart.items, getLock());
                  if (fp !== prevFP) return cart;
                  await new Promise(r => setTimeout(r, delay));
            }
            return await fetchCart();
      }

      // ----- Item utils
      const itemSku = (it) => (it?.sku || it?.productSku || it?.product?.sku || '').toString();
      const itemName = (it) => (it?.name || it?.product?.name || '').toString();
      function isPolisolItem(it) {
            const skuU = itemSku(it).toUpperCase();
            const nameU = itemName(it).toUpperCase();
            return (skuU.indexOf(FAMILY_PREFIX) === 0) || nameU.includes('ПОЛІСОЛ') || nameU.includes('POLISOL');
      }
      const cartHasFamily = (items) => (items || []).some(isPolisolItem);
      const sumFamilyQty = (items) => (items || []).reduce((a, it) => a + (isPolisolItem(it) ? (Number(it.quantity) || 0) : 0), 0);

      // ----- Utils
      const formatUAH = (n) => { try { return '₴' + Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } catch (_) { return '₴' + (Number(n || 0)).toFixed(2); } };
      const replaceAll = (s, a, b) => String(s).split(a).join(b);
      const removeQuotes = (s) => replaceAll(replaceAll(replaceAll(String(s), '«', ''), '»', ''), '"', '');
      function normApos(s) { let r = String(s || ''); r = replaceAll(r, '’', "'"); r = replaceAll(r, 'ʼ', "'"); r = replaceAll(r, '′', "'"); r = replaceAll(r, '´', "'"); return r; }
      const normalizeKey = (s) => removeQuotes(normApos(String(s))).trim().toLowerCase();

      // ----- Детекция карточки/sku
      function getSku() {
            const sels = ['[itemprop="sku"]', '.product-details__product-sku', '[data-product-sku]', '.product-details__sku', '.details-product-code__value', '.ec-store__product-sku', '.ecwid-productBrowser-sku'];
            for (const s of sels) {
                  const el = document.querySelector(s); if (!el) continue;
                  const raw = (el.getAttribute('content') || el.textContent || '').trim(); if (!raw) continue;
                  const up = raw.toUpperCase(); const tokens = up.split(' ').filter(Boolean); const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }

      // ----- Партія helpers
      function extractAllowedNumber(str, allowed) {
            const a = String(str || ''); let curr = '';
            for (let i = 0; i < a.length; i++) {
                  const ch = a[i];
                  if (ch >= '0' && ch <= '9') curr += ch; else if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; curr = ''; }
            }
            if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; } return null;
      }
      function findBatchControl() {
            const selects = Array.from(document.querySelectorAll('.form-control__select'));
            for (const s of selects) {
                  const opts = Array.from(s.options || []).map(o => o.textContent || '').join(' ');
                  if (extractAllowedNumber(opts, [15, 30, 45, 60, 75]) != null) return s.closest('.form-control') || null;
            }
            const controls = Array.from(document.querySelectorAll('.form-control'));
            for (const fc of controls) { const t = (fc.innerText || '').trim(); if (extractAllowedNumber(t, [15, 30, 45, 60, 75]) != null) return fc; }
            return null;
      }
      function readBatchCount() {
            const fc = findBatchControl(); if (!fc) return null;
            const sel = fc.querySelector('.form-control__select');
            if (sel && sel.value && ['Виберіть', 'Выберите', 'Select'].every(x => sel.value.indexOf(x) < 0)) {
                  const v = extractAllowedNumber(sel.value, [15, 30, 45, 60, 75]); return v != null ? v : null;
            }
            const txt = (fc.querySelector('.form-control__select-text')?.textContent || fc.textContent || '').trim();
            const vv = extractAllowedNumber(txt, [15, 30, 45, 60, 75]); return vv != null ? vv : null;
      }
      const batchCountToIndex = (n) => (n === 15 ? 1 : (n === 30 ? 2 : (н === 45 ? 3 : (n === 60 ? 4 : (n === 75 ? 5 : null)))));
      const batchLimitByIndex = (idx) => (idx === 1 ? 15 : (idx === 2 ? 30 : (idx === 3 ? 45 : (idx === 4 ? 60 : (idx === 5 ? 75 : null)))));

      // ----- "Вміст"
      function canonContent(label) {
            const t = normalizeKey(label); if (!t) return null;
            if (t.includes('білий')) return 'Квас трипільський (білий)';
            if (t.includes('коріандр')) return 'Квас трипільський з коріандром';
            if (t.includes('класич')) return 'Класичний';
            if (t.includes('шипшин')) return 'Шипшина';
            if (t.includes('журавлин')) return 'Журавлина';
            if (t.includes('матусин') || t.includes("матусине здоров'я") || t.includes('матусине здоров')) return "Матусине здоров'я";
            if (t.includes('чоловіч')) return 'Чоловіча Сила';
            if (t.includes('квас')) return 'Квас трипільський';
            return null;
      }
      function getItemContentLabel(it) {
            const lists = [];
            const pushList = (val) => {
                  if (!val) return;
                  if (Array.isArray(val)) lists.push(val);
                  else if (typeof val === 'object') lists.push(Object.values(val));
            };
            pushList(it?.options);
            pushList(it?.selectedOptions);
            pushList(it?.product?.options);
            pushList(it?.product?.selectedOptions);

            for (const list of lists) {
                  for (const o of (Array.isArray(list) ? list : [])) {
                        const name = String(o?.name || '').toLowerCase();
                        if (name.includes('вміст') || name.includes('content') || name.includes('содерж')) {
                              const v = removeQuotes(o?.value || '');
                              if (v) return v;
                        }
                  }
            }
            const name = itemName(it);
            const m = name.match(/«([^»]+)»/);
            if (m && m[1]) return removeQuotes(m[1]);
            return canonContent(name) || '';
      }

      // ----- Цены
      function getUnitPriceFromCache(it, lock) {
            try {
                  if (!pricingCache?.__index || !lock?.batchIndex) return 0;
                  const canon = canonContent(getItemContentLabel(it) || itemName(it)); if (!canon) return 0;
                  const row = pricingCache.__index[normalizeKey(canon)];
                  const p = row ? Number(row[(lock.batchIndex - 1) | 0]) : 0;
                  return isFinite(p) && p > 0 ? p : 0;
            } catch (_) { return 0; }
      }
      function getUnitPrice(it, lock) {
            const cand = [it?.price, it?.product?.price, it?.productPrice, it?.priceWithoutTax, it?.salePrice, it?.priceInProductCurrency];
            for (const v of cand) { const n = Number(v); if (isFinite(n) && n > 0) return n; }
            return getUnitPriceFromCache(it, lock);
      }

      // ----- Price UI
      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]') || document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }
      function setPriceUI(numOrNull) {
            const { span, box } = priceEls(); if (!span) return;
            if (initialPriceText == null) initialPriceText = span.textContent;
            if (typeof numOrNull === 'number' && isFinite(numOrNull) && numOrNull > 0) { span.textContent = formatUAH(numOrNull); if (box) box.setAttribute('content', String(numOrNull)); }
            else { span.textContent = initialPriceText || '€0'; if (box) box.setAttribute('content', '0'); }
      }
      function refreshUnitPrice() {
            if (!pricingCache?.ok) { setPriceUI(null); return { idx: null, canon: null, price: null }; }
            const bCount = readBatchCount(); const idx = bCount ? batchCountToIndex(bCount) : null;
            const radios = Array.from(document.querySelectorAll('input.form-control__radio')); const r = radios.find(x => x.checked);
            const rawLabel = r ? (document.querySelector('label[for="' + r.id + '"]')?.textContent || r.value || '').trim() : null;
            const canon = rawLabel ? canonContent(rawLabel) : null;
            if (idx && canon) {
                  const key = normalizeKey(canon); const row = pricingCache.__index?.[key] || null;
                  if (!row) { if (!__cpc.warned.has(key)) { console.warn('[POLISOL] price row not found for', canon, 'key=', key); __cpc.warned.add(key); } setPriceUI(null); return { idx, canon, price: null }; }
                  const price = row[(idx - 1) | 0] || 0; setPriceUI(price); return { idx, canon, price };
            } else { setPriceUI(null); return { idx: idx || null, canon: canon || null, price: null }; }
      }

      // ----- Quote API
      async function requestQuote({ canon, contentKey, idx }) {
            const attempts = [
                  { payload: { contentLabel: canon, batchIndex: idx }, tag: 'contentLabel' },
                  { payload: { contentKey, batchIndex: idx }, tag: 'contentKey' },
                  { payload: { content: contentKey, batchIndex: idx }, tag: 'content' },
                  { payload: { label: canon, batchIndex: idx }, tag: 'label' },
                  { payload: { name: canon, batchIndex: idx }, tag: 'name' },
            ];
            let lastErr = null;
            for (const { payload, tag } of attempts) {
                  try {
                        const resp = await fetch(QUOTE_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        let data = null, text = ''; try { data = await resp.json(); } catch (_) { try { text = await resp.text(); } catch (__) { } }
                        if (!resp.ok || !data || data.ok === false || !data.productId) {
                              const msg = (data && (data.message || data.error || data.err || data.detail)) || text || resp.statusText || 'Unknown error';
                              lastErr = { status: resp.status, tag, msg, data }; console.warn('[POLISOL] quote failed(' + tag + '):', lastErr);
                        } else { return { ok: true, productId: data.productId }; }
                  } catch (e) { lastErr = { status: 0, tag, msg: e?.message || String(e) }; }
            }
            return { ok: false, error: lastErr };
      }

      // ----- Стили (флаг)
      function ensureStyles() {
            if (__cpc.cssInjected) return;
            const style = document.createElement('style'); style.id = 'polisol-style'; style.textContent = ''; document.head.appendChild(style);
            __cpc.cssInjected = true;
      }

      // ----- Контейнер сводки (только на мастер POLISOL)
      function removeSummaryContainer() {
            const host = document.getElementById('polisol-cart-summary');
            if (host && host.parentNode) host.parentNode.removeChild(host);
            __cpc.summaryFP = null;
      }
      function ensureSummaryContainer() {
            if (!isMasterPolisolPage()) { removeSummaryContainer(); return null; }
            let host = document.getElementById('polisol-cart-summary'); if (host) return host;
            ensureStyles();
            host = document.createElement('div'); host.id = 'polisol-cart-summary';
            host.setAttribute('style', 'margin:16px 0 8px;border:1px solid #e7e7e7;border-radius:12px;overflow:hidden;background:#fff;');
            host.innerHTML = `
      <div id="polisol-title" style="padding:12px 16px;font-weight:600;background:#f8f8f8;">Підсумок кошика: кошик порожній</div>
      <div id="polisol-body" style="padding:8px 0 12px;"></div>`;
            const descr = document.querySelector('#productDescription.product-details__product-description') || document.getElementById('productDescription');
            if (descr && descr.parentNode) {
                  descr.parentNode.insertBefore(host, descr);
            } else {
                  console.debug('[POLISOL] skip summary mount: no productDescription');
                  return null;
            }
            return host;
      }

      // ----- Лимит M из корзины
      function inferCanonFromName(name) { const n = String(name || ''); const m = n.match(/«([^»]+)»/); if (m && m[1]) return removeQuotes(m[1]); return canonContent(n) || ''; }
      function inferLimitFromCart(items) {
            const fam = (items || []).filter(isPolisolItem);
            if (!fam.length) return null;
            const allowed = [15, 30, 45, 60, 75];
            for (const it of fam) {
                  const opt = (it?.options || it?.selectedOptions || []).find?.(o => String(o?.name || '').toLowerCase().includes('парт'));
                  const fromOpt = opt ? extractAllowedNumber(String(opt.value || opt.text || opt.valueText || ''), allowed) : null;
                  if (fromOpt) return fromOpt;
                  const fromName = extractAllowedNumber(itemName(it), allowed);
                  const fromProd = extractAllowedNumber(it?.product?.name || '', allowed);
                  if (fromName) return fromName;
                  if (fromProd) return fromProd;
            }
            return null;
      }

      // ----- FP корзины
      function cartFingerprint(items, lock) {
            const fam = (items || []).filter(isPolisolItem);
            const li = (lock && lock.batchIndex) ? String(lock.batchIndex) : '0';
            const parts = ['L' + li];
            for (const it of fam) { parts.push(itemSku(it) + ':' + (it.quantity || 0) + ':' + (getUnitPrice(it, lock) || 0)); }
            return parts.join('|');
      }

      // ----- Перехват «Оформити замовлення»
      function bindCartLinkHandler() {
            if (__cpc.cartLinkBound) return;
            document.addEventListener('click', (e) => {
                  const a = e.target instanceof Element ? e.target.closest('a.polisol-go-cart') : null;
                  if (!a) return;
                  e.preventDefault();
                  try {
                        if (typeof Ecwid !== 'undefined' && Ecwid.openPage) Ecwid.openPage('cart');
                        else location.hash = '!/cart';
                  } catch (_) {
                        location.hash = '!/cart';
                  }
            }, true);
            __cpc.cartLinkBound = true;
      }

      // ----- Рендер сводки
      function renderCartSummarySync(cart) {
            if (!isMasterPolisolPage()) { removeSummaryContainer(); return; }

            const host = ensureSummaryContainer(); if (!host) return;
            const body = host.querySelector('#polisol-body'); const titleEl = host.querySelector('#polisol-title');
            const items = (cart && cart.items) || []; const fam = items.filter(isPolisolItem);
            const lock = getLock();

            const fp = cartFingerprint(items, lock);
            if (__cpc.summaryFP === fp) return;
            __cpc.summaryFP = fp;

            if (!fam.length) {
                  if (titleEl) titleEl.textContent = 'Підсумок кошика: кошик порожній';
                  body.innerHTML = '';
                  return;
            }

            let limit = lock ? batchLimitByIndex(lock.batchIndex) : null;
            if (!limit) {
                  const uiCount = readBatchCount(); const uiIdx = uiCount ? batchCountToIndex(uiCount) : null;
                  if (uiIdx) limit = batchLimitByIndex(uiIdx);
            }
            if (!limit) {
                  const inf = inferLimitFromCart(fam);
                  if (inf) limit = inf;
            }

            const currentQty = sumFamilyQty(items);

            if (limit) {
                  const remaining = Math.max(0, limit - currentQty);
                  if (remaining <= 0) {
                        if (titleEl) {
                              titleEl.innerHTML = `Партія ${limit} сформована. <a href="#!/cart" class="polisol-go-cart" style="margin-left:10px; text-decoration:underline;">Оформити замовлення</a>`;
                        }
                  } else {
                        if (titleEl) titleEl.textContent = `Підсумок кошика: Залишилось ${remaining} із ${limit}`;
                  }
            } else {
                  if (titleEl) titleEl.textContent = 'Підсумок кошика';
            }

            const tblStyle = 'width:100%;border-collapse:collapse;';
            const thStyle = 'padding:10px 12px;border-top:1px solid #eee;text-align:center;vertical-align:middle;';
            const tdL = 'padding:10px 12px;border-top:1px solid #eee;text-align:left;vertical-align:middle;';
            const tdR = 'padding:10px 12px;border-top:1px solid #eee;text-align:right;white-space:nowrap;vertical-align:middle;';
            const totalL = 'padding:12px 12px;border-top:2px solid #ddd;font-weight:700;text-align:right;';
            const totalR = 'padding:12px 12px;border-top:2px solid #ddd;font-weight:700;text-align:right;white-space:nowrap;';

            let rows = '', total = 0;
            for (let i = 0; i < items.length; i++) {
                  const it = items[i]; if (!isPolisolItem(it)) continue;
                  try {
                        const idx = (rows.match(/<tr>/g) || []).length + 1;
                        const canon = getItemContentLabel(it) || inferCanonFromName(itemName(it)) || '—';
                        const needPrefix = !/^Квас/i.test(canon);
                        const label = `${needPrefix ? 'ПОЛІСОЛ™' : ''}«${canon}»${limit ? ' (ціна в партії ' + limit + ')' : ''}`;
                        const qty = Number(it.quantity || 0);
                        const unit = getUnitPrice(it, getLock());
                        const sum = unit * qty; total += sum;
                        rows += `<tr>
          <td style="${thStyle}">${idx}</td>
          <td style="${tdL}">${label}</td>
          <td style="${tdR}">${qty}</td>
          <td style="${tdR}">${formatUAH(unit)}</td>
          <td style="${tdR}">${formatUAH(sum)}</td>
        </tr>`;
                  } catch (ex) { console.warn('[POLISOL] row render failed:', ex, it); }
            }

            if (!rows) { body.innerHTML = ''; return; }

            body.innerHTML = `
      <table style="${tblStyle}">
        <thead>
          <tr>
            <th style="${thStyle}">№</th>
            <th style="${thStyle}">Найменування</th>
            <th style="${thStyle}">К-сть</th>
            <th style="${thStyle}">Ціна</th>
            <th style="${thStyle}">Сума</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td colspan="4" style="${totalL}">Сума разом</td>
            <td style="${totalR}">${formatUAH(total)}</td>
          </tr>
        </tfoot>
      </table>`;
      }
      async function renderCartSummary() { try { const cart = await fetchCart(); renderCartSummarySync(cart); } catch (_) { } }

      // ----- Add to Bag (только на мастер POLISOL)
      function findQtyInput() {
            return document.querySelector('.details-product-purchase__qty input[type="number"]') || document.querySelector('input[type="number"][name="quantity"]');
      }
      async function handleAddToBagClick(e) {
            const tgt = e.target; if (!(tgt instanceof Element)) return;
            const btn = tgt.closest('.details-product-purchase__add-to-bag button.form-control__button'); if (!btn) return;
            if (!isMasterPolisolPage()) return;

            e.preventDefault(); e.stopPropagation();
            if (__cpc.adding) return; __cpc.adding = true;

            let lockSetThisClick = false; let added = false;
            try {
                  const { idx, canon } = refreshUnitPrice();
                  if (!idx) { alert('Оберіть розмір партії.'); return; }
                  if (!canon) { alert('Оберіть «Вміст».'); return; }

                  const contentKey = ({ 'Класичний': 'classic', 'Шипшина': 'rosehip', 'Журавлина': 'cranberry', "Матусине здоров'я": 'matusyne', 'Чоловіча Сила': 'cholovicha', 'Квас трипільський': 'kvas', 'Квас трипільський (білий)': 'kvas_bilyi', 'Квас трипільський з коріандром': 'kvas_koriandr' })[canon];
                  if (!contentKey) { alert('Невідомий «Вміст».'); return; }

                  const qty = Math.max(1, parseInt((findQtyInput()?.value || '1'), 10) || 1);

                  const beforeCart = await fetchCart(); const beforeFP = cartFingerprint(beforeCart.items, getLock());
                  const hasFam = cartHasFamily(beforeCart.items);
                  let lock = getLock();

                  if (hasFam && !lock) { alert('У кошику вже є POLISOL з попередніх дій. Оформіть/очистьте його перед зміною партії.'); return; }
                  if (lock) {
                        if (String(lock.batchIndex) !== String(idx)) { const lim = batchLimitByIndex(lock.batchIndex); alert('У кошику зафіксована інша партія на ' + lim + ' шт. Очистьте кошик або оформіть замовлення.'); return; }
                  } else { setLock({ batchIndex: idx }); lockSetThisClick = true; lock = getLock(); }

                  const limit = batchLimitByIndex(lock.batchIndex);
                  const currentQty = sumFamilyQty(beforeCart.items);
                  const remaining = limit - currentQty;
                  if (remaining <= 0) { alert('Досягнуто ліміт партії (' + limit + ' шт.).'); return; }
                  if (qty > remaining) { alert('Можна додати не більше ' + remaining + ' шт. (ліміт ' + limit + ').'); return; }

                  const quo = await requestQuote({ canon, contentKey, idx });
                  if (!quo.ok) { const err = quo.error || {}; const status = (err.status != null ? 'HTTP ' + err.status + ' ' : ''); const detail = (typeof err.msg === 'string' ? err.msg : (err.msg == null ? '' : String(err.msg))); alert('Помилка серверу: ' + status + (detail || 'невідома помилка')); return; }

                  const result = await Promise.race([
                        new Promise((resolve) => { try { Ecwid.Cart.addProduct({ id: quo.productId, quantity: qty }, () => resolve('cb')); } catch (_) { resolve('catch'); } }),
                        new Promise((resolve) => setTimeout(() => resolve('timeout'), 6000))
                  ]);
                  added = (result === 'cb' || result === 'timeout' || result === 'catch');

                  const updatedCart = await waitForCartChange(beforeFP, 10, 300);
                  renderCartSummarySync(updatedCart);
            } catch (err) {
                  if (lockSetThisClick && !added) clearLock();
                  alert('Помилка серверу: ' + (err?.message || err));
            } finally {
                  __cpc.adding = false;
            }
      }
      function attachAddToCart() { if (window.__cpc_add_bound) return; document.addEventListener('click', handleAddToBagClick, true); window.__cpc_add_bound = true; }

      // ----- Реактивность
      function bindOptionChange() {
            if (__cpc.optsBound) return;
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('.form-control__select')) refreshUnitPrice(); }, true);
            document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('input.form-control__radio')) refreshUnitPrice(); }, true);
            __cpc.optsBound = true;
      }
      function observeDom() {
            const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') || document.querySelector('.ec-store, .ecwid-productBrowser') || document.body;
            if (__cpc.mo) { try { __cpc.mo.disconnect(); } catch (_) { } }
            const mo = new MutationObserver(() => {
                  if (__cpc.moScheduled) return; __cpc.moScheduled = true;
                  requestAnimationFrame(() => {
                        __cpc.moScheduled = false;
                        if (isMasterPolisolPage()) refreshUnitPrice();
                  });
            });
            mo.observe(root, { childList: true, subtree: true }); __cpc.mo = mo;
      }
      function bindCartGuard() {
            if (__cpc.cartBound) return;
            Ecwid.OnCartChanged.add(async (_cart) => {
                  try {
                        if (isMasterPolisolPage()) await renderCartSummary();
                        const items = _cart?.items || [];
                        if (!cartHasFamily(items)) clearLock();
                  } catch (_) { }
            });
            __cpc.cartBound = true;
      }

      // ----- Индекс цен
      function priceIndex(pr) {
            const idxMap = {}; const ent = Object.entries(pr.pricing || {});
            for (let i = 0; i < ent.length; i++) idxMap[normalizeKey(ent[i][0])] = ent[i][1];
            return idxMap;
      }

      // ----- Заголовок описания (официально + нуджи)
      function setDescTitleSmart(text) {
            window.ecwidMessages = window.ecwidMessages || {};
            window.ecwidMessages[DESC_KEY] = text;
            try { Ecwid.refreshConfig && Ecwid.refreshConfig(); } catch (_) { }

            const nudge = () => {
                  const desc = document.getElementById('productDescription');
                  if (!desc) return;
                  const candidates = [];
                  const prev = desc.previousElementSibling;
                  if (prev && prev.classList && prev.classList.contains('product-details-module__title')) candidates.push(prev);
                  const scope = desc.closest('.product-details, .product-details__description, .product-details__product-description, .product-details__product') || desc.parentElement;
                  if (scope) scope.querySelectorAll('.product-details-module__title').forEach(n => candidates.push(n));
                  const seen = new Set();
                  for (const n of candidates) {
                        if (!n || seen.has(n)) continue; seen.add(n);
                        const cur = (n.textContent || '').trim();
                        if (cur !== text) n.textContent = text;
                  }
            };
            requestAnimationFrame(nudge);
            setTimeout(nudge, 300);
      }

      // ----- CART safety
      function getItemBatchValue(it) {
            const allowed = [15, 30, 45, 60, 75];

            const lists = [];
            const pushList = (val) => {
                  if (!val) return;
                  if (Array.isArray(val)) lists.push(val);
                  else if (typeof val === 'object') lists.push(Object.values(val));
            };
            pushList(it?.options);
            pushList(it?.selectedOptions);
            pushList(it?.product?.options);
            pushList(it?.product?.selectedOptions);
            for (const list of lists) {
                  for (const o of (Array.isArray(list) ? list : [])) {
                        const name = String(o?.name || '').toLowerCase();
                        if (name.includes('парт')) {
                              const raw = String(o?.value || o?.text || o?.valueText || '');
                              const v = extractAllowedNumber(raw, allowed);
                              if (v != null) return v;
                        }
                  }
            }

            const fromName = extractAllowedNumber(itemName(it), allowed);
            if (fromName) return fromName;
            const fromProd = extractAllowedNumber(it?.product?.name || '', allowed);
            if (fromProd) return fromProd;

            return null;
      }
      function analyzePolisol(items) {
            const fam = (items || []).filter(isPolisolItem);
            if (!fam.length) return { status: 'none' };

            const batches = new Set();
            for (const it of fam) {
                  const b = getItemBatchValue(it);
                  if (b != null) batches.add(b);
            }

            if (batches.size > 1) {
                  return { status: 'mix' };
            }

            const batch = batches.size === 1 ? [...batches][0] : inferLimitFromCart(fam);
            if (!batch) return { status: 'ok' };

            const total = fam.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
            if (total > batch) return { status: 'over', total, batch };
            if (total < batch) return { status: 'under', total, batch };
            return { status: 'ok', total, batch };
      }
      function cartGuardFingerprint(res) {
            if (!res) return 'null';
            return [res.status, res.batch ?? 'x', res.total ?? 'x'].join('|');
      }
      async function runCartSafetyCheck() {
            try {
                  if (__cpc.pageType !== 'CART') return;
                  const cart = await fetchCart();
                  const res = analyzePolisol(cart.items || []);
                  const fp = cartGuardFingerprint(res);
                  if (fp === __cpc.cartGuardState) return;
                  __cpc.cartGuardState = fp;

                  switch (res.status) {
                        case 'mix':
                              alert('У кошику вже є POLISOL з попередніх дій. Оформіть/очистьте його перед зміною партії.');
                              break;
                        case 'over':
                              alert(`У кошику ${res.total} шт., що перевищує ліміт партії ${res.batch} шт. Приберіть зайві товари.`);
                              break;
                        case 'under':
                              alert(`У кошику ${res.total} із ${res.batch} шт. Фактична кількість не досягає розміру партії.`);
                              break;
                        default:
                              break;
                  }
            } catch (_) { }
      }
      function scheduleCartSafetyCheck(delay = 200) {
            if (__cpc.cartGuardTimer) clearTimeout(__cpc.cartGuardTimer);
            __cpc.cartGuardTimer = setTimeout(runCartSafetyCheck, delay);
      }
      function bindCartSafety() {
            if (__cpc.cartSafetyBound) return;
            Ecwid.OnCartChanged.add((_cart) => { if (__cpc.pageType === 'CART') scheduleCartSafetyCheck(150); });
            document.addEventListener('click', (e) => {
                  if (__cpc.pageType !== 'CART') return;
                  const t = e.target instanceof Element ? e.target : null;
                  if (!t) return;
                  if (t.closest && t.closest('.ec-cart, .ec-cart__items, .ec-cart__item')) scheduleCartSafetyCheck(100);
            }, true);
            __cpc.cartSafetyBound = true;
      }

      // ----- Boot
      waitEcwid(() => {
            Ecwid.OnAPILoaded.add(async () => {
                  Ecwid.OnPageSwitch.add(function (page) {
                        __cpc.pageType = page?.type || null;
                        if (page && typeof page.productId !== 'undefined') __cpc.currentProductId = page.productId || null;

                        if (page.type !== 'PRODUCT') {
                              setDescTitleSmart(DESC_DEFAULT);
                              removeSummaryContainer();
                        }
                        if (page.type === 'CART') {
                              scheduleCartSafetyCheck(50);
                        }
                  });

                  Ecwid.OnPageLoaded.add(async (page) => {
                        __cpc.pageType = page?.type || null;
                        if (page && typeof page.productId !== 'undefined') __cpc.currentProductId = page.productId || null;

                        // SKU det
                        if (page && page.type === 'PRODUCT') {
                              const sku = getSku(); if (sku) __cpc.currentSku = sku;
                              __cpc.isTargetMemo = (sku || '').indexOf(FAMILY_PREFIX) === 0;
                        } else { __cpc.currentSku = null; __cpc.isTargetMemo = null; }

                        // Заголовок
                        if (page.type === 'PRODUCT') {
                              setDescTitleSmart(isMasterPolisolPage() ? DESC_POLISOL : DESC_DEFAULT);
                        } else {
                              setDescTitleSmart(DESC_DEFAULT);
                        }

                        // CART safety
                        if (page.type === 'CART') {
                              bindCartSafety();
                              scheduleCartSafetyCheck(60);
                        }

                        // Только на МАСТЕР POLISOL — сводка/цены/перехват
                        if (!isMasterPolisolPage()) { removeSummaryContainer(); return; }

                        ensureStyles();
                        ensureSummaryContainer();
                        bindCartLinkHandler();

                        try {
                              const res = await fetch(PRICING_ENDPOINT); const pr = await res.json();
                              if (!pr?.ok) throw new Error('pricing not ok');
                              pricingCache = { ...pr, __index: priceIndex(pr) };
                        } catch (e) { console.error('Failed to load pricing', e); pricingCache = null; }

                        bindOptionChange();
                        observeDom();
                        bindCartGuard();
                        attachAddToCart();

                        await renderCartSummary();
                        refreshUnitPrice();
                  });
            });
      });
})();
