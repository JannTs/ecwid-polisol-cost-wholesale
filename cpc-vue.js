(function () {
      // === Endpoints  ===
      const API_BASE = 'https://ecwid-polisol-cost-wholesale.vercel.app'; // замени на свой Vercel-домен при необходимости
      const PRICING_ENDPOINT = API_BASE + '/api/polisol/pricing';
      const QUOTE_ENDPOINT = API_BASE + '/api/polisol/quote';

      // === Константы ===
      const LOCK_KEY = 'polisol_batch_lock'; // localStorage
      const FAMILY_PREFIX = 'ПОЛІСОЛ-';           // базовое семейство для таргета
      const RADIO_NAME = 'Вміст';
      const BATCH_ARIA = 'розмір партії (вплив на опт.ціни)';

      // === Базовые утилиты ===
      function waitEcwid(cb) { (typeof Ecwid !== 'undefined' && Ecwid.OnAPILoaded) ? cb() : setTimeout(() => waitEcwid(cb), 100); }
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
      function isTargetProduct() { const sku = getSku() || ''; return sku.startsWith(FAMILY_PREFIX); }

      function findBatchInput() {
            // Ecwid dropdown — это чаще readonly input, а отображаемый текст в .form-control__select-text
            return document.querySelector(`input[aria-label="${BATCH_ARIA}"]`);
      }
      function readBatchCount() {
            const inp = findBatchInput(); if (!inp) return null;
            const container = inp.closest('.form-control');
            const txt = container?.querySelector('.form-control__select-text')?.textContent?.trim() || inp.value || '';
            const m = txt.match(/\d+/);
            return m ? parseInt(m[0], 10) : null; // 15 / 30 / 45 / 60 / 75
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
            // ₴ + узкие неразрывные пробелы между тысячными группами (U+202F), 2 знака
            const THIN_NBSP = '\u202F';
            const s = Number(n).toFixed(2);
            const [i, d] = s.split('.');
            const withThin = i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_NBSP);
            return `₴${withThin}.${d}`;
      }

      function getCheckedContent() {
            const list = Array.from(document.querySelectorAll(`input.form-control__radio[name="${RADIO_NAME}"]`));
            const checked = list.find(el => el.checked);
            if (!checked) return null;
            const label = document.querySelector(`label[for="${checked.id}"]`)?.textContent?.trim() || checked.value || '';
            return label.replace(/[«»"]/g, '').trim();
      }

      function saveLock(state) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(state)); } catch { } }
      function loadLock() { try { return JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch { return null; } }
      function clearLock() { try { localStorage.removeItem(LOCK_KEY); } catch { } }

      // === Стили для disabled состояния ===
      (function ensureCpcStyles() {
            if (document.getElementById('cpc-base-style')) return;
            const st = document.createElement('style');
            st.id = 'cpc-base-style';
            st.textContent = `.cpc-disabled{opacity:.6;user-select:none;pointer-events:none;}`;
            document.head.appendChild(st);
      })();

      // === Vue-приложение ===
      function mountApp(pricing) {
            const { createApp, ref, computed, onMounted } = Vue;

            // Впишемся в #productDescription: создадим якорь под таблицу
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
                        const batchIndex = ref(null); // 1..5
                        const unitPrice = ref(0);
                        const contentLabel = ref('');
                        const variantSuffix = ref('');
                        const cartItems = ref([]);   // только позиции нашей партии
                        const batchCount = computed(() => batchIndex.value ? indexToBatchCount(batchIndex.value) : null);

                        function updatePriceUI() {
                              const { span, box } = priceEls();
                              if (!span) return;
                              if (!originalPriceText.value) originalPriceText.value = span.textContent;
                              if (unitPrice.value) {
                                    span.textContent = formatUAH(unitPrice.value);
                                    if (box) box.setAttribute('content', String(unitPrice.value));
                              } else {
                                    if (originalPriceText.value) span.textContent = originalPriceText.value;
                              }
                        }

                        async function refreshUnitPrice() {
                              const bCount = readBatchCount();
                              const idx = bCount ? batchCountToIndex(bCount) : null;
                              batchIndex.value = idx;

                              const lbl = getCheckedContent();
                              contentLabel.value = lbl || '';

                              const canon = lbl ? lbl.replace(/[«»"]/g, '').trim() : '';
                              const suffix = canon && pricing.suffixByContent[canon] ? pricing.suffixByContent[canon] : null;
                              variantSuffix.value = suffix || '';

                              if (idx && canon) {
                                    const row = pricing.pricing[canon] || null;
                                    unitPrice.value = row ? (row[idx - 1] || 0) : 0;
                              } else {
                                    unitPrice.value = 0;
                              }
                              updatePriceUI();
                        }

                        function ensureLockVisibility() {
                              const bCount = readBatchCount();
                              const lockBox = document.getElementById('cpc-batch-lock');
                              if (!lockBox) return;
                              if (bCount) {
                                    lockBox.style.display = 'flex';
                                    lockBox.querySelector('input').disabled = false;
                              } else {
                                    lockBox.style.display = 'none';
                                    lockBox.querySelector('input').disabled = true;
                              }
                        }

                        function renderLockCheckbox() {
                              if (document.getElementById('cpc-batch-lock')) return;
                              const target = findBatchInput()?.closest('.form-control');
                              if (!target) return;
                              const wrap = document.createElement('div');
                              wrap.id = 'cpc-batch-lock';
                              wrap.style.display = 'none';
                              wrap.style.marginTop = '8px';
                              wrap.style.alignItems = 'center';
                              wrap.style.gap = '8px';
                              wrap.innerHTML = `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" checked />
              <span>Блокування партії</span>
            </label>
          `;
                              target.appendChild(wrap);

                              const cb = wrap.querySelector('input');
                              cb.addEventListener('change', async () => {
                                    if (!cb.checked) {
                                          const ok = window.confirm('Розблокувати партію? Кошик буде очищено.');
                                          if (!ok) { cb.checked = true; return; }
                                          Ecwid.Cart.clear(() => {
                                                clearLock();
                                                locked.value = false;
                                                const sel = findBatchInput();
                                                if (sel) sel.closest('.form-control')?.classList.remove('cpc-disabled');
                                                unitPrice.value = 0;
                                                updatePriceUI();
                                                renderCartTable([]);
                                          });
                                    } else {
                                          const idx = batchIndex.value;
                                          if (!idx) { cb.checked = false; return; }
                                          locked.value = true;
                                          saveLock({ locked: true, batchIndex: idx });
                                          findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                                    }
                              });
                        }

                        function applyLockFromState() {
                              const st = loadLock();
                              if (st && st.locked && st.batchIndex) {
                                    locked.value = true;
                                    batchIndex.value = st.batchIndex;
                                    const cb = document.querySelector('#cpc-batch-lock input');
                                    if (cb) cb.checked = true;
                                    findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                              }
                        }

                        function renderCartTable(items) {
                              cartItems.value = items;
                        }
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
                                          n: i + 1,
                                          name: it.name,
                                          quantity: it.quantity,
                                          price: it.price,
                                          sum: it.quantity * it.price
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

                                    if (!locked.value) {
                                          const cb = document.querySelector('#cpc-batch-lock input');
                                          if (cb) cb.checked = true;
                                          locked.value = true;
                                          saveLock({ locked: true, batchIndex: idx });
                                          findBatchInput()?.closest('.form-control')?.classList.add('cpc-disabled');
                                    }

                                    Ecwid.Cart.get(async function (cart) {
                                          const batchMax = indexToBatchCount(idx);
                                          const current = (cart.items || []).filter(it => skuMatchesOurBatch(it.sku, idx))
                                                .reduce((acc, it) => acc + it.quantity, 0);
                                          const remaining = batchMax - current;
                                          if (qty > remaining) {
                                                return alert(`Перевищено ліміт партії (${batchMax}). Доступно ще: ${remaining}.`);
                                          }

                                          try {
                                                // suffix не отправляем — сервер сам определит
                                                const payload = { contentLabel: lbl, batchIndex: idx };
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

                        function observeOptionChanges() {
                              const root = document.querySelector('.ec-product-details, .ecwid-productBrowser-details, .product-details') ||
                                    document.querySelector('.ec-store, .ecwid-productBrowser') ||
                                    document.body;
                              let timer = null;
                              const mo = new MutationObserver(() => {
                                    clearTimeout(timer);
                                    timer = setTimeout(() => {
                                          ensureLockVisibility();
                                          refreshUnitPrice();
                                    }, 50);
                              });
                              mo.observe(root, { childList: true, subtree: true });
                        }

                        onMounted(() => {
                              renderLockCheckbox();
                              ensureLockVisibility();
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
                              const sel = findBatchInput();
                              if (sel) sel.closest('.form-control')?.classList.remove('cpc-disabled');
                              return;
                        }

                        // анти-дубль монтирования на один и тот же productId
                        if (window.__cpc_vue_pid === page.productId) return;
                        window.__cpc_vue_pid = page.productId;

                        try {
                              const res = await fetch(PRICING_ENDPOINT);
                              const pricing = await res.json();
                              if (!pricing?.ok) throw new Error('pricing not ok');
                              mountApp(pricing);
                        } catch (e) {
                              console.error('Failed to load pricing', e);
                        }
                  });
            });
      });

})();
