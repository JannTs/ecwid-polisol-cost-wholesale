/* POLISOL widget v2025-09-06-18  */
/* ecwid-polisol-cost-wholesale — CPC VUE WIDGET (v2025-09-06-18)
   Новое:
   - Компонент "Підсумок кошика POLISOL" перед #productDescription:
       | № | ПОЛІСОЛ™«{Вміст}» (ціна в партії N) | {X банок} | {ціна} | {сума} |
       + итого "Сума разом"
   - Динамическое обновление при добавлении/удалении/изменении qty (Ecwid.OnCartChanged).
   - Показ только для семейства ПОЛІСОЛ- и только на карточке товара.
   Остальное: фиксация ТОЛЬКО размера партії, смешивание “Вмістів” разрешено до лимита; quote через contentLabel.
*/
(() => {
      console.info('POLISOL widget v2025-09-06-18 ready');

      // === Endpoints ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app';
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Family/SKU ===
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';

      // === Globals ===
      let pricingCache = null; // { ok, pricing:{}, __index:{} }
      let initialPriceText = null;
      const __cpc = (window.__cpc = window.__cpc || {
            optsBound: false,
            mo: null,
            moScheduled: false,
            warned: new Set(),
            cartBound: false,
            adding: false,
            currentSku: null,
            isTargetMemo: null,
            cssInjected: false,
            summaryBound: false
      });

      // === Lock (фиксируем ТОЛЬКО размер партии) ===
      const LOCK_KEY = 'POLISOL_LOCK';
      function getLock() { try { return JSON.parse(sessionStorage.getItem(LOCK_KEY) || 'null'); } catch (_) { return null; } }
      function setLock(obj) { try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(obj)); } catch (_) { } }
      function clearLock() { try { sessionStorage.removeItem(LOCK_KEY); } catch (_) { } }

      // === Ecwid helpers ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }
      function fetchCart() {
            return new Promise((resolve) => {
                  try { Ecwid.Cart.get((cart) => resolve(cart || { items: [] })); }
                  catch (_) { resolve({ items: [] }); }
            });
      }
      function itemSku(it) { return (it && (it.sku || (it.product && it.product.sku) || it.productSku)) || ''; }
      function cartHasFamily(items) { return (items || []).some((it) => itemSku(it).indexOf(FAMILY_PREFIX) === 0); }
      function sumFamilyQty(items) { return (items || []).reduce((acc, it) => acc + ((itemSku(it).indexOf(FAMILY_PREFIX) === 0 ? (it.quantity || 0) : 0)), 0); }

      // === Utils ===
      async function ensureVue() {
            try {
                  if (typeof window.Vue === 'object' && window.Vue && window.Vue.createApp) return;
                  await new Promise((res) => {
                        const s = document.createElement('script');
                        s.src = 'https://unpkg.com/vue@3/dist/vue.global.prod.js';
                        s.onload = res;
                        s.onerror = () => res();
                        document.head.appendChild(s);
                  });
            } catch (_) { }
      }
      function formatUAH(n) {
            try { return '₴' + Number(n || 0).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
            catch (_) { return '₴' + (Number(n || 0)).toFixed(2); }
      }
      function replaceAll(src, what, withWhat) { return String(src).split(what).join(withWhat); }
      function removeQuotes(s) { return replaceAll(replaceAll(replaceAll(String(s), '«', ''), '»', ''), '"', ''); }
      function normApos(s) {
            let r = String(s || '');
            r = replaceAll(r, '’', "'"); r = replaceAll(r, 'ʼ', "'"); r = replaceAll(r, '′', "'"); r = replaceAll(r, '´', "'");
            return r;
      }
      function normalizeKey(s) { return removeQuotes(normApos(String(s))).trim().toLowerCase(); }

      // === Page detection ===
      function getSku() {
            const sels = [
                  '[itemprop="sku"]', '.product-details__product-sku', '[data-product-sku]',
                  '.product-details__sku', '.details-product-code__value', '.ec-store__product-sku', '.ecwid-productBrowser-sku'
            ];
            for (const s of sels) {
                  const el = document.querySelector(s);
                  if (!el) continue;
                  const raw = (el.getAttribute('content') || el.textContent || '').trim();
                  if (!raw) continue;
                  const up = raw.toUpperCase();
                  const tokens = up.split(' ').filter(Boolean);
                  const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }
      function isTargetProduct() {
            if (typeof __cpc.isTargetMemo === 'boolean') return __cpc.isTargetMemo;
            const memo = __cpc.currentSku;
            if (memo) { __cpc.isTargetMemo = memo.indexOf(FAMILY_PREFIX) === 0; return __cpc.isTargetMemo; }
            const sku = getSku() || '';
            if (sku) __cpc.currentSku = sku;
            __cpc.isTargetMemo = sku.indexOf(FAMILY_PREFIX) === 0;
            return __cpc.isTargetMemo;
      }

      // === Batch helpers ===
      function extractAllowedNumber(str, allowed) {
            const a = String(str || ''); let curr = '';
            for (let i = 0; i < a.length; i++) {
                  const ch = a[i];
                  if (ch >= '0' && ch <= '9') curr += ch;
                  else if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; curr = ''; }
            }
            if (curr.length) { const v = parseInt(curr, 10); if (allowed.indexOf(v) >= 0) return v; }
            return null;
      }
      function findBatchControl() {
            const selects = Array.from(document.querySelectorAll('.form-control__select'));
            for (const s of selects) {
                  const opts = Array.from(s.options || []).map(o => o.textContent || '').join(' ');
                  if (extractAllowedNumber(opts, [15, 30, 45, 60, 75]) != null) return s.closest('.form-control') || null;
            }
            const controls = Array.from(document.querySelectorAll('.form-control'));
            for (const fc of controls) {
                  const t = (fc.innerText || '').trim();
                  if (extractAllowedNumber(t, [15, 30, 45, 60, 75]) != null) return fc;
            }
            return null;
      }
      function readBatchCount() {
            const fc = findBatchControl();
            if (!fc) return null;
            const sel = fc.querySelector('.form-control__select');
            if (sel && sel.value && ['Виберіть', 'Выберите', 'Select'].every(x => sel.value.indexOf(x) < 0)) {
                  const v = extractAllowedNumber(sel.value, [15, 30, 45, 60, 75]); return v != null ? v : null;
            }
            const txt = (fc.querySelector('.form-control__select-text')?.textContent || fc.textContent || '').trim();
            const vv = extractAllowedNumber(txt, [15, 30, 45, 60, 75]); return vv != null ? vv : null;
      }
      function batchCountToIndex(n) { return (n === 15 ? 1 : (n === 30 ? 2 : (n === 45 ? 3 : (n === 60 ? 4 : (n === 75 ? 5 : null))))); }
      function batchLimitByIndex(idx) { return (idx === 1 ? 15 : (idx === 2 ? 30 : (idx === 3 ? 45 : (idx === 4 ? 60 : (idx === 5 ? 75 : null))))); }

      // === "Вміст" helpers ===
      function canonContent(label) {
            const t = normalizeKey(label);
            if (!t) return null;
            if (t.indexOf('білий') >= 0) return 'Квас трипільський (білий)';
            if (t.indexOf('коріандр') >= 0) return 'Квас трипільський з коріандром';
            if (t.indexOf('класич') >= 0) return 'Класичний';
            if (t.indexOf('шипшин') >= 0) return 'Шипшина';
            if (t.indexOf('журавлин') >= 0) return 'Журавлина';
            if (t.indexOf('матусин') >= 0 || t.indexOf("матусине здоров'я") >= 0 || t.indexOf('матусине здоров') >= 0) return "Матусине здоров'я";
            if (t.indexOf('чоловіч') >= 0) return 'Чоловіча Сила';
            if (t.indexOf('квас') >= 0) return 'Квас трипільський';
            return null;
      }
      function contentKeyForCanon(canon) {
            switch (canon) {
                  case 'Класичний': return 'classic';
                  case 'Шипшина': return 'rosehip';
                  case 'Журавлина': return 'cranberry';
                  case "Матусине здоров'я": return 'matusyne';
                  case 'Чоловіча Сила': return 'cholovicha';
                  case 'Квас трипільський': return 'kvas';
                  case 'Квас трипільський (білий)': return 'kvas_bilyi';
                  case 'Квас трипільський з коріандром': return 'kvas_koriandr';
                  default: return null;
            }
      }
      function inferCanonFromName(name) {
            // попытка вытащить канон из названия товара в корзине
            return canonContent(name) || name;
      }
      function getCheckedContent() {
            const radios = Array.from(document.querySelectorAll('input.form-control__radio'));
            const r = radios.find(x => x.checked);
            if (!r) return null;
            const lbl = (document.querySelector('label[for="' + r.id + '"]')?.textContent || r.value || '').trim();
            return removeQuotes(lbl).trim();
      }

      // === Цена (UI) ===
      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]')
                  || document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }
      function setPriceUI(numOrNull) {
            const { span, box } = priceEls();
            if (!span) return;
            if (initialPriceText == null) initialPriceText = span.textContent;
            if (typeof numOrNull === 'number' && Number.isFinite(numOrNull) && numOrNull > 0) {
                  span.textContent = formatUAH(numOrNull);
                  if (box) box.setAttribute('content', String(numOrNull));
            } else {
                  span.textContent = initialPriceText || '€0';
                  if (box) box.setAttribute('content', '0');
            }
      }
      function refreshUnitPrice() {
            if (!pricingCache || !pricingCache.ok) { setPriceUI(null); return { idx: null, canon: null, price: null }; }
            const bCount = readBatchCount();
            const idx = bCount ? batchCountToIndex(bCount) : null;
            const rawLabel = getCheckedContent();
            const canon = rawLabel ? canonContent(rawLabel) : null;

            if (idx && canon) {
                  const key = normalizeKey(canon);
                  const row = (pricingCache.__index && pricingCache.__index[key]) || null;
                  if (!row) {
                        if (!__cpc.warned.has(key)) {
                              console.warn('[POLISOL] price row not found for', canon, 'key=', key, 'available=', Object.keys(pricingCache.__index || {}));
                              __cpc.warned.add(key);
                        }
                        setPriceUI(null);
                        return { idx, canon, price: null };
                  }
                  const price = row[(idx - 1) | 0] || 0;
                  setPriceUI(price);
                  return { idx, canon, price };
            } else {
                  setPriceUI(null);
                  return { idx: idx || null, canon: canon || null, price: null };
            }
      }

      // === Robust quote request (contentLabel first) ===
      async function requestQuote({ contentKey, canon, idx }) {
            const attempts = [
                  { payload: { contentLabel: canon, batchIndex: idx }, tag: 'contentLabel' },
                  { payload: { contentKey, batchIndex: idx }, tag: 'contentKey' },
                  { payload: { content: contentKey, batchIndex: idx }, tag: 'content' },
                  { payload: { label: canon, batchIndex: idx }, tag: 'label' },
                  { payload: { name: canon, batchIndex: idx }, tag: 'name' },
            ];

            let lastErr = null;
            for (let i = 0; i < attempts.length; i++) {
                  const { payload, tag } = attempts[i];
                  try {
                        console.info('[POLISOL] quote attempt:', tag, payload);
                        const resp = await fetch(QUOTE_ENDPOINT, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(payload)
                        });
                        let data = null, text = '';
                        try { data = await resp.json(); }
                        catch (_) { try { text = await resp.text(); } catch (__) { } }

                        if (!resp.ok || !data || data.ok === false || !data.productId) {
                              const msg = (data && (data.message || data.error || data.err || data.detail)) || text || resp.statusText || 'Unknown error';
                              lastErr = { status: resp.status, tag, msg, data };
                              console.warn('[POLISOL] quote failed (' + tag + '):', lastErr);
                        } else {
                              console.info('[POLISOL] quote success via', tag, '→ productId:', data.productId);
                              return { ok: true, productId: data.productId };
                        }
                  } catch (e) {
                        lastErr = { status: 0, tag, msg: e?.message || String(e) };
                        console.warn('[POLISOL] quote exception (' + tag + '):', lastErr);
                  }
            }
            return { ok: false, error: lastErr };
      }

      // === CART SUMMARY WIDGET ===
      function ensureSummaryStyles() {
            if (__cpc.cssInjected) return;
            const css = `
#polisol-cart-summary { margin: 16px 0 8px; border: 1px solid #eee; border-radius: 12px; overflow: hidden; }
#polisol-cart-summary .pcs-head { padding: 10px 14px; font-weight: 600; background: #fafafa; }
#polisol-cart-summary table { width: 100%; border-collapse: collapse; }
#polisol-cart-summary th, #polisol-cart-summary td { padding: 10px 12px; border-top: 1px solid #eee; text-align: left; vertical-align: middle; }
#polisol-cart-summary th:nth-child(1), #polisol-cart-summary td:nth-child(1) { width: 44px; text-align: center; }
#polisol-cart-summary td.pcs-right, #polisol-cart-summary th.pcs-right { text-align: right; white-space: nowrap; }
#polisol-cart-summary .pcs-muted { color: #777; font-weight: 400; }
#polisol-cart-summary .pcs-total td { font-weight: 700; border-top: 2px solid #ddd; }
#polisol-cart-summary .pcs-empty { padding: 10px 14px; color: #777; }
    `.trim();
            const style = document.createElement('style');
            style.id = 'polisol-cart-summary-style';
            style.textContent = css;
            document.head.appendChild(style);
            __cpc.cssInjected = true;
      }

      function ensureSummaryContainer() {
            let host = document.getElementById('polisol-cart-summary');
            if (host) return host;

            ensureSummaryStyles();

            host = document.createElement('div');
            host.id = 'polisol-cart-summary';
            host.innerHTML = `
      <div class="pcs-head">Підсумок кошика POLISOL</div>
      <div class="pcs-body pcs-empty">Кошик порожній для цієї партії.</div>
    `;

            // вставляем перед описанием товара
            const descr = document.querySelector('#productDescription.product-details__product-description') || document.getElementById('productDescription');
            if (descr && descr.parentNode) {
                  descr.parentNode.insertBefore(host, descr);
            } else {
                  // запасной вариант — в начало карточки
                  const container = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') || document.body;
                  container.insertBefore(host, container.firstChild);
            }
            return host;
      }

      function renderCartSummarySync(cart) {
            const host = ensureSummaryContainer();
            const items = (cart && cart.items) || [];
            const fam = items.filter(it => itemSku(it).indexOf(FAMILY_PREFIX) === 0);

            const lock = getLock();
            const limit = lock ? batchLimitByIndex(lock.batchIndex) : null;

            if (!fam.length) {
                  host.querySelector('.pcs-body').outerHTML = `<div class="pcs-body pcs-empty">Кошик порожній для POLISOL.</div>`;
                  return;
            }

            let rows = '';
            let total = 0;
            fam.forEach((it, i) => {
                  const idx = i + 1;
                  const canon = inferCanonFromName(it.name || '');
                  const label = `ПОЛІСОЛ™«${canon}»${limit ? ' (ціна в партії ' + limit + ')' : ''}`;
                  const qty = Number(it.quantity || 0);
                  const unit = Number(it.price || 0);
                  const sum = unit * qty;
                  total += sum;
                  rows += `
        <tr>
          <td class="pcs-center">${idx}</td>
          <td>${label}</td>
          <td class="pcs-right">${qty} банок</td>
          <td class="pcs-right">${formatUAH(unit)}</td>
          <td class="pcs-right">${formatUAH(sum)}</td>
        </tr>
      `;
            });

            const table = `
      <div class="pcs-body">
        <table>
          <thead>
            <tr>
              <th>№</th>
              <th>Найменування</th>
              <th class="pcs-right">Кількість</th>
              <th class="pcs-right">Ціна</th>
              <th class="pcs-right">Сума</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr class="pcs-total">
              <td></td>
              <td>Сума разом</td>
              <td></td>
              <td></td>
              <td class="pcs-right">${formatUAH(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
            host.querySelector('.pcs-body').outerHTML = table;
      }

      async function renderCartSummary() {
            try { const cart = await fetchCart(); renderCartSummarySync(cart); }
            catch (_) { /* noop */ }
      }

      // === Add to Cart interception ===
      function findQtyInput() {
            return document.querySelector('.details-product-purchase__qty input[type="number"]')
                  || document.querySelector('input[type="number"][name="quantity"]');
      }

      async function handleAddToBagClick(e) {
            const tgt = e.target;
            if (!(tgt instanceof Element)) return;
            const btn = tgt.closest('.details-product-purchase__add-to-bag button.form-control__button');
            if (!btn) return;
            if (!isTargetProduct()) return; // до preventDefault

            e.preventDefault();
            e.stopPropagation();

            if (__cpc.adding) return;
            __cpc.adding = true;

            let preLocked = false; // ставили ли lock в этом клике

            try {
                  const { idx, canon } = refreshUnitPrice();
                  if (!idx) { alert('Оберіть розмір партії.'); return; }
                  if (!canon) { alert('Оберіть «Вміст».'); return; }

                  const contentKey = contentKeyForCanon(canon);
                  if (!contentKey) { alert('Невідомий «Вміст» (contentKey).'); return; }

                  const qty = Math.max(1, parseInt((findQtyInput()?.value || '1'), 10) || 1);

                  // Текущее состояние корзины + lock
                  const cart = await fetchCart();
                  const hasFam = cartHasFamily(cart.items);
                  let lock = getLock();

                  // Наследие без lock — блок
                  if (hasFam && !lock) { alert('У кошику вже є POLISOL з попередніх дій. Оформіть/очистьте його перед зміною партії.'); return; }

                  // Проверка/установка лока по партии
                  if (lock) {
                        if (String(lock.batchIndex) !== String(idx)) {
                              const lim = batchLimitByIndex(lock.batchIndex);
                              alert('У кошику зафіксована інша партія на ' + lim + ' шт. Очистьте кошик або оформіть замовлення.');
                              return;
                        }
                  } else {
                        setLock({ batchIndex: idx });
                        preLocked = true;
                        lock = getLock();
                  }

                  // Контроль лимита партии
                  const limit = batchLimitByIndex(lock.batchIndex);
                  const currentQty = sumFamilyQty(cart.items);
                  const remaining = limit - currentQty;
                  if (remaining <= 0) { alert('Досягнуто ліміт партії (' + limit + ' шт.).'); return; }
                  if (qty > remaining) { alert('Можна додати не більше ' + remaining + ' шт. (ліміт ' + limit + ').'); return; }

                  // Получаем productId (contentLabel сначала)
                  const quo = await requestQuote({ contentKey, canon, idx });
                  if (!quo.ok) {
                        const err = quo.error || {};
                        const status = (err.status != null ? 'HTTP ' + err.status + ' ' : '');
                        const detail = (typeof err.msg === 'string' ? err.msg : (err.msg == null ? '' : String(err.msg)));
                        alert('Помилка серверу: ' + status + (detail || 'невідома помилка'));
                        return;
                  }

                  // Добавление + FAILSAFE 6s
                  const result = await Promise.race([
                        new Promise((resolve) => {
                              try { Ecwid.Cart.addProduct({ id: quo.productId, quantity: qty }, function () { resolve('cb'); }); }
                              catch (_) { resolve('catch'); }
                        }),
                        new Promise((resolve) => setTimeout(() => resolve('timeout'), 6000))
                  ]);
                  if (result === 'timeout') console.warn('[POLISOL] addProduct callback timeout');

                  // Обновим мини-таблицу
                  await renderCartSummary();
            } catch (err) {
                  if (preLocked) clearLock();
                  alert('Помилка серверу: ' + (err?.message || err));
            } finally {
                  __cpc.adding = false;
            }
      }

      function attachAddToCart() {
            if (window.__cpc_add_bound) return;
            document.addEventListener('click', handleAddToBagClick, true);
            window.__cpc_add_bound = true;
      }

      // === Reactivity / observers ===
      function bindOptionChange() {
            if (__cpc.optsBound) return;
            document.addEventListener('change', (e) => {
                  if (e.target && e.target.matches && e.target.matches('.form-control__select')) refreshUnitPrice();
            }, true);
            document.addEventListener('change', (e) => {
                  if (e.target && e.target.matches && e.target.matches('input.form-control__radio')) refreshUnitPrice();
            }, true);
            __cpc.optsBound = true;
      }

      function observeDom() {
            const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details')
                  || document.querySelector('.ec-store, .ecwid-productBrowser')
                  || document.body;

            if (__cpc.mo) { try { __cpc.mo.disconnect(); } catch (_) { } }

            const mo = new MutationObserver(() => {
                  if (__cpc.moScheduled) return;
                  __cpc.moScheduled = true;
                  requestAnimationFrame(async () => {
                        __cpc.moScheduled = false;
                        refreshUnitPrice();
                        // небольшое обновление таблицы, если корзина менялась в другом месте
                        await renderCartSummary();
                  });
            });
            mo.observe(root, { childList: true, subtree: true });
            __cpc.mo = mo;
      }

      function bindCartGuard() {
            if (__cpc.cartBound) return;
            Ecwid.OnCartChanged.add((cart) => {
                  const items = (cart && cart.items) || [];
                  if (!cartHasFamily(items)) clearLock();
                  // при любом изменении корзины — перерисовываем таблицу
                  try { renderCartSummarySync({ items }); } catch (_) { }
            });
            __cpc.cartBound = true;
      }

      // === Boot ===
      waitEcwid(async () => {
            Ecwid.OnAPILoaded.add(async () => {
                  await ensureVue();
                  Ecwid.OnPageLoaded.add(async (page) => {
                        if (page && page.type === 'PRODUCT') {
                              const sku = getSku();
                              if (sku) __cpc.currentSku = sku;
                              __cpc.isTargetMemo = (sku || '').indexOf(FAMILY_PREFIX) === 0;
                        } else {
                              __cpc.currentSku = null; __cpc.isTargetMemo = null;
                        }

                        if (page.type !== 'PRODUCT' || !isTargetProduct()) return;

                        try {
                              const res = await fetch(PRICING_ENDPOINT);
                              const pr = await res.json();
                              if (!pr?.ok) throw new Error('pricing not ok');

                              const idxMap = {};
                              const entries = Object.entries(pr.pricing || {});
                              for (let i = 0; i < entries.length; i++) idxMap[normalizeKey(entries[i][0])] = entries[i][1];
                              pricingCache = { ...pr, __index: idxMap };
                        } catch (e) {
                              console.error('Failed to load pricing', e);
                              pricingCache = null;
                        }

                        // UI hooks
                        bindOptionChange();
                        observeDom();
                        bindCartGuard();
                        attachAddToCart();

                        // Стартовый рендер мини-таблицы
                        await renderCartSummary();

                        // Цена
                        refreshUnitPrice();
                  });
            });
      });
})();
