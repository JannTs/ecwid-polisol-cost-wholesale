(function () {
      // === Endpoints ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app'; // при необходимости замени на свой домен Vercel
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Константы ===
      const LOCK_KEY = 'polisol_batch_lock'; // localStorage
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';           // таргет по SKU
      const TOOLTIP_TEXT = 'Партію зафіксовано. Щоб змінити, очистіть кошик і оберіть знову.';

      // Имя радио-группы может отличаться; ищем гибко
      const RADIO_NAME_CANDIDATES = ['Вміст', 'Вмiст', 'Вміст ', 'вміст', 'content', 'состав'];

      // Подпись для дропдауна партии — ищем гибко
      const BATCH_ARIA_CANDS = [
            'розмір партії (вплив на опт.ціни)',
            'розмір партії',
            'размер партии',
            'партія',
            'партия'
      ];

      // === Утилиты ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }

      function ensureVue(cb) {
            if (window.Vue && window.Vue.createApp) return cb();
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/vue@3.5.11/dist/vue.global.prod.min.js';
            s.onload = cb;
            s.onerror = () => console.error('[cpc] failed to load Vue CDN');
            document.head.appendChild(s);
      }

      function qsAll(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

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
                  const tokens = raw.toUpperCase().match(/[A-ZА-ЯІЇЄҐ0-9._-]+/g) || [];
                  const filtered = tokens.filter(t => t !== 'SKU');
                  if (filtered.length) return filtered[filtered.length - 1];
            }
            return null;
      }
      function isTargetProduct() {
            const sku = getSku() || '';
            return sku.startsWith(FAMILY_PREFIX);
      }

      // Найти сам input (aria-label) для блока партии — удобно для поиска .form-control
      function findBatchInput() {
            // 1) точное совпадение aria-label
            for (const label of BATCH_ARIA_CANDS) {
                  const el = document.querySelector(`input[aria-label="${label}"]`);
                  if (el) return el;
            }
            // 2) частичное совпадение (contains) по aria-label
            const allInputs = qsAll('input[aria-label]');
            const el2 = allInputs.find(i => {
                  const v = (i.getAttribute('aria-label') || '').toLowerCase();
                  return BATCH_ARIA_CANDS.some(c => v.includes(c.toLowerCase()));
            });
            if (el2) return el2;

            // 3) любой readonly input рядом с .form-control__select-text, содержащей 15/30/45/60/75
            const candidates = qsAll('.form-control input[readonly], .form-control input[tabindex="-1"]');
            for (const inp of candidates) {
                  const txt = inp.closest('.form-control')?.querySelector('.form-control__select-text')?.textContent?.trim() || '';
                  if (/\b(15|30|45|60|75)\b/.test(txt)) return inp;
            }
            return null;
      }

      // === ВАЖНО: сначала объявляем findBatchControl, потом readBatchCount ===
      function findBatchControl() {
            // 1) по aria-label → ближайшая .form-control
            const aria = findBatchInput();
            if (aria) return aria.closest('.form-control') || null;

            // 2) .form-control__select-text с цифрами партии
            const controls = qsAll('.form-control');
            for (const fc of controls) {
                  const txt = fc.querySelector('.form-control__select-text')?.textContent?.trim() || '';
                  if (/\b(15|30|45|60|75)\b/.test(txt)) return fc;
            }

            // 3) fallback: по innerText всего блока
            for (const fc of controls) {
                  const txt = (fc.innerText || '').trim();
                  if (/\b(15|30|45|60|75)\b/.test(txt)) return fc;
            }
            return null;
      }

      function readBatchCount() {
            const fc = findBatchControl();
            if (!fc) return null;

            // 0) Нативный <select>: читаем выбранную опцию
            const sel = fc.querySelector('select.form-control__select');
            if (sel) {
                  const idx = sel.selectedIndex ?? -1; // 0 — placeholder "Виберіть"
                  if (idx > 0) {
                        const txt = sel.options[idx]?.textContent?.trim() || '';
                        const m = txt.match(/\b(15|30|45|60|75)\b/);
                        if (m) return parseInt(m[0], 10);
                  } else {
                        return null; // ещё не выбрано
                  }
            }

            // 1) Псевдо-select Ecwid
            const txtA = fc.querySelector('.form-control__select-text')?.textContent?.trim() || '';
            const mA = txtA.match(/\b(15|30|45|60|75)\b/);
            if (mA) return parseInt(mA[0], 10);

            // 2) Иногда кладут в input.value
            const inp = fc.querySelector('input[aria-label], input.form-control__text');
            const txtB = (inp?.value || '').trim();
            const mB = txtB.match(/\b(15|30|45|60|75)\b/);
            if (mB) return parseInt(mB[0], 10);

            // 3) Осторожный fallback по innerText — только если блок уже не «пустой»
            const isEmpty = fc.classList.contains('form-control--empty');
            if (!isEmpty) {
                  const txtC = (fc.innerText || '').trim();
                  const mC = txtC.match(/\b(15|30|45|60|75)\b/);
                  if (mC) return parseInt(mC[0], 10);
            }

            return null;
      }

      function batchCountToIndex(n) { return (n === 15 ? 1 : n === 30 ? 2 : n === 45 ? 3 : n === 60 ? 4 : n === 75 ? 5 : null); }
      function indexToBatchCount(idx) { return ({ 1: 15, 2: 30, 3: 45, 4: 60, 5: 75 })[idx] || null; }

      function findQtyInput() {
            return document.querySelector('.details-product-purchase__qty input[type="number"]') ||
                  document.querySelector('input[type="number"][name="quantity"]');
      }
      function findAddButton() {
            return document.querySelector('.details-product-purchase__add-to-bag button.form-control__button');
      }

      function priceEls() {
            const span = document.querySelector('.details-product-price__value.ec-price-item');
            const box = document.querySelector('.product-details__product-price.ec-price-item[itemprop="price"]') ||
                  document.querySelector('.product-details__product-price.ec-price-item');
            return { span, box };
      }

      function formatUAH(n) {
            const THIN_NBSP = '\u202F';
            const s = Number(n).toFixed(2);
            const [i, d] = s.split('.');
            const withThin = i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
            return `₴${withThin}.${d}`;
      }

      function getRadioList() {
            // 1) по точному имени
            for (const nm of RADIO_NAME_CANDIDATES) {
                  const els = qsAll(`input.form-control__radio[name="${nm}"]`);
                  if (els.length) return els;
            }
            // 2) имя содержит
            const allRadios = qsAll('input.form-control__radio[name], input[type="radio"][name]');
            const subset = allRadios.filter(r => {
                  const n = (r.getAttribute('name') || '').toLowerCase();
                  return RADIO_NAME_CANDIDATES.some(c => n.includes(c.toLowerCase()));
            });
            if (subset.length) return subset;

            // 3) «всё что внутри блока опций»
            const inBlock = qsAll('.product-details__size-item-container input[type="radio"]');
            if (inBlock.length) return inBlock;

            return [];
      }
      function getCheckedContent() {
            const list = getRadioList();
            const checked = list.find(el => el.checked);
            if (!checked) return null;
            const label = document.querySelector(`label[for="${checked.id}"]`)?.textContent?.trim() || checked.value || '';
            return label.replace(/[«»"]/g, '').trim();
      }

      // === Канонизация лейбла "Вміст" к ключам таблицы прайса
      /* function canonContentLabel(label) {
            if (!label) return null;
            const t = label.toLowerCase().replace(/[«»"]/g, '').trim();

            // "Класичний" vs "Класічний" (и любые вариации "и/і/i")
            if (/клас[иiі]ч/.test(t)) return 'Класичний';

            if (/шипшин/.test(t)) return 'З шипшиною';
            if (/журавлин/.test(t)) return 'З журавлиною';

            // Матусине здоров'я (ловим и "матусин", и "матусине")
            if (/матусин|матусине/.test(t)) return "Матусине здоров'я";

            if (/чоловіч/.test(t)) return 'Чоловіча сила';

            // Квасы
            if (/білий/.test(t)) return 'Квас трипільський (білий)';
            if (/коріандр/.test(t)) return 'Квас трипільський з коріандром';
            if (/квас/.test(t)) return 'Квас трипільський';

            // fallback — вернём очищенный исходник
            return label.replace(/[«»"]/g, '').trim();
      } */


      function saveLock(st) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(st)); } catch { } }
      function loadLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; } }
      function clearLock() { try { localStorage.removeItem(LOCK_KEY); } catch { } }

      // === Стили
      (function ensureCpcStyles() {
            if (document.getElementById('cpc-base-style')) return;
            const st = document.createElement('style');
            st.id = 'cpc-base-style';
            st.textContent = `
      .cpc-disabled-lite{opacity:.6;}
      .cpc-overlay{position:absolute;inset:0;cursor:not-allowed;background:transparent;}
    `;
            document.head.appendChild(st);
      })();

      // === Блокировка дропдауна (overlay + tooltip)
      function lockBatchSelectUI() {
            const sel = findBatchInput();
            const fc = sel?.closest('.form-control');
            if (!fc) return;
            fc.classList.add('cpc-disabled-lite');
            if (getComputedStyle(fc).position === 'static') fc.style.position = 'relative';
            let ov = fc.querySelector('.cpc-overlay');
            if (!ov) {
                  ov = document.createElement('div');
                  ov.className = 'cpc-overlay';
                  fc.appendChild(ov);
            }
            ov.setAttribute('title', TOOLTIP_TEXT);
      }
      function unlockBatchSelectUI() {
            const sel = findBatchInput();
            const fc = sel?.closest('.form-control');
            if (!fc) return;
            fc.classList.remove('cpc-disabled-lite');
            const ov = fc.querySelector('.cpc-overlay');
            if (ov) ov.remove();
      }

      // === Vue-приложение
      function mountApp(pricing) {
            const { createApp, ref, computed, onMounted } = Vue;

            // якорь под таблицу
            let host = document.getElementById('cpc-polisol-summary');
            if (!host) {
                  host = document.createElement('div');
                  host.id = 'cpc-polisol-summary';
                  host.style.marginTop = '10px';
                  const desc = document.getElementById('productDescription');
                  if (desc) desc.appendChild(host);
            }

            const app = createApp({
                  setup() {
                        const originalPriceText = ref(null);
                        const locked = ref(false);
                        const batchIndex = ref(null);  // 1..5
                        const unitPrice = ref(0);
                        const contentLabel = ref('');
                        const cartItems = ref([]);

                        const batchCount = computed(() => batchIndex.value ? indexToBatchCount(batchIndex.value) : null);

                        function updatePriceUI() {
                              const { span, box } = priceEls();
                              if (!span) return;

                              if (!originalPriceText.value) originalPriceText.value = span.textContent;

                              const nextText = unitPrice.value
                                    ? formatUAH(unitPrice.value)
                                    : originalPriceText.value;

                              // если текст тот же — не трогаем DOM
                              if (span.textContent === nextText) return;

                              span.textContent = nextText;
                              if (box) {
                                    const numeric = unitPrice.value ? String(unitPrice.value) : '';
                                    box.setAttribute('content', numeric);
                              }
                        }


                        async function refreshUnitPrice() {
                              const bCount = readBatchCount();
                              const idx = bCount ? batchCountToIndex(bCount) : null;

                              // авто-фиксация при первом выборе партии
                              if (idx && !locked.value) {
                                    locked.value = true;
                                    saveLock({ locked: true, batchIndex: idx });
                                    lockBatchSelectUI();
                              }

                              batchIndex.value = idx;

                              const lbl = getCheckedContent();
                              contentLabel.value = lbl || '';

                              if (idx && lbl) {
                                    const canon = canonContentLabel(lbl);      // <<< НОВОЕ
                                    const row = pricing.pricing[canon] || null;
                                    unitPrice.value = row ? (row[idx - 1] || 0) : 0;
                              } else {
                                    unitPrice.value = 0;
                              }

                              updatePriceUI();
                        }

                        function applyLockFromState() {
                              const st = loadLock();
                              if (st && st.locked && st.batchIndex) {
                                    locked.value = true;
                                    batchIndex.value = st.batchIndex;
                                    lockBatchSelectUI();
                              }
                        }

                        function renderCartTable(items) { cartItems.value = items; }
                        function sumForItems(items) { return items.reduce((a, it) => a + (it.price * it.quantity), 0); }

                        function skuMatchesOurBatch(sku, idx) {
                              if (!sku) return false;
                              return new RegExp(`^${FAMILY_PREFIX.replace('-', '\\-')}.+\\-${idx}$`).test(sku);
                        }

                        function fetchCartAndRender() {
                              Ecwid.Cart.get(function (cart) {
                                    const idx = batchIndex.value;
                                    if (!idx) { renderCartTable([]); return; }
                                    const ours = (cart.items || []).filter(it => skuMatchesOurBatch(it.sku, idx));
                                    renderCartTable(ours.map((it, i) => ({
                                          n: i + 1, name: it.name, quantity: it.quantity, price: it.price, sum: it.quantity * it.price
                                    })));
                              });
                        }

                        function attachAddToCartInterceptor() {
                              if (window.__cpc_add_hooked) return;
                              const btn = findAddButton(); if (!btn) return;

                              document.addEventListener('click', async (e) => {
                                    const b = e.target.closest('.details-product-purchase__add-to-bag button.form-control__button');
                                    if (!b) return;
                                    if (!isTargetProduct()) return;

                                    e.preventDefault(); e.stopPropagation();

                                    const idx = batchIndex.value;
                                    if (!idx) { return alert('Оберіть партію спочатку.'); }

                                    const lbl = getCheckedContent();
                                    if (!lbl) { return alert('Оберіть «Вміст».'); }

                                    const qtyInp = findQtyInput();
                                    const qty = Math.max(1, parseInt((qtyInp?.value || '1'), 10) || 1);

                                    // лимит по сумме партии
                                    Ecwid.Cart.get(async function (cart) {
                                          const batchMax = indexToBatchCount(idx);
                                          const current = (cart.items || []).filter(it => skuMatchesOurBatch(it.sku, idx))
                                                .reduce((acc, it) => acc + it.quantity, 0);
                                          const remaining = batchMax - current;
                                          if (qty > remaining) {
                                                return alert(`Перевищено ліміт партії (${batchMax}). Доступно ще: ${remaining}.`);
                                          }

                                          try {
                                                const payload = { contentLabel: lbl, batchIndex: idx }; // суффикс сервер определит сам
                                                const r = await fetch(QUOTE_ENDPOINT, {
                                                      method: 'POST',
                                                      headers: { 'Content-Type': 'application/json' },
                                                      body: JSON.stringify(payload)
                                                });
                                                const data = await r.json();
                                                if (!r.ok || !data.ok) throw new Error(data?.error || r.statusText);

                                                Ecwid.Cart.addProduct({ id: data.productId, quantity: qty }, function () {
                                                      fetchCartAndRender();
                                                });
                                          } catch (err) {
                                                alert(`Помилка серверу: ${err?.message || err}`);
                                          }
                                    });
                              }, true);

                              window.__cpc_add_hooked = true;
                        }

                        // Обновления при изменении опций
                        function observeOptionChanges() {
                              const root =
                                    document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') ||
                                    document.querySelector('.ec-store, .ecwid-productBrowser') ||
                                    document.body;
                              let timer = null;
                              const mo = new MutationObserver(() => {
                                    clearTimeout(timer);
                                    timer = setTimeout(() => { refreshUnitPrice(); }, 60);
                              });
                              mo.observe(root, { childList: true, subtree: true });
                        }

                        onMounted(() => {
                              applyLockFromState();
                              refreshUnitPrice();
                              attachAddToCartInterceptor();
                              observeOptionChanges();

                              Ecwid.OnCartChanged.add(fetchCartAndRender);
                              fetchCartAndRender();
                        });

                        const total = computed(() => formatUAH(sumForItems(cartItems.value)));
                        return { cartItems, total, formatUAH };
                  },
                  template: `
        <div v-if="cartItems.length" style="margin-top:8px;border-top:1px solid rgba(0,0,0,.08);padding-top:8px">
          <div style="font-weight:600;margin-bottom:6px">Ваш набір (для обраної партії)</div>
          <div style="overflow:auto">
            <table style="width:100%;border-collapse:collapse;font-size:14px">
              <thead>
                <tr>
                  <th style="text-align:left;padding:4px 6px">№</th>
                  <th style="text-align:left;padding:4px 6px">Товар</th>
                  <th style="text-align:right;padding:4px 6px">К-сть</th>
                  <th style="text-align:right;padding:4px 6px">Ціна</th>
                  <th style="text-align:right;padding:4px 6px">Сума</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="it in cartItems" :key="it.n">
                  <td style="padding:4px 6px">{{ it.n }}</td>
                  <td style="padding:4px 6px">{{ it.name }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ it.quantity }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ formatUAH(it.price) }}</td>
                  <td style="padding:4px 6px;text-align:right">{{ formatUAH(it.sum) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="4" style="padding:6px 6px;text-align:right;font-weight:600">Разом</td>
                  <td style="padding:6px 6px;text-align:right;font-weight:600">{{ total }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `
            });

            app.mount('#cpc-polisol-summary');
      }

      // === Bootstrap ===
      waitEcwid(() => {
            Ecwid.OnAPILoaded.add(() => {
                  Ecwid.OnPageLoaded.add(async page => {
                        if (page.type !== 'PRODUCT') return;

                        // уход/не наш товар — мягкий teardown
                        if (!isTargetProduct()) {
                              const host = document.getElementById('cpc-polisol-summary');
                              if (host) host.remove();
                              unlockBatchSelectUI();
                              return;
                        }

                        // анти-дубль по productId
                        if (window.__cpc_vue_pid === page.productId) return;
                        window.__cpc_vue_pid = page.productId;

                        try {
                              const res = await fetch(PRICING_ENDPOINT, { cache: 'no-store' });
                              const pricing = await res.json();
                              if (!pricing?.ok) throw new Error('pricing not ok');
                              ensureVue(() => mountApp(pricing));
                        } catch (e) {
                              console.error('[cpc] Failed to load pricing or Vue', e);
                        }
                  });
            });
      });

})();
