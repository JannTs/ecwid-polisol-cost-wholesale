// utils/polisol.ts
export type BatchIndex = 1 | 2 | 3 | 4 | 5;

export const BATCH_INDEX_TO_COUNT: Record<BatchIndex, number> = {
  1: 15,
  2: 30,
  3: 45,
  4: 60,
  5: 75,
};

// Канонические метки (нормализуем user-facing лейблы радиосов)
export const CONTENT_CANON = {
  Класичний: "Класичний",
  Класічний: "Класичний", // доп. вариант написания
  "Чоловіча Сила": "Чоловіча Сила",
  "Матусине Здоров'я": "Матусине Здоров'я",
  Шипшина: "Шипшина",
  Журавлина: "Журавлина",
  "Квас трипільський": "Квас трипільський",
  "Квас трипільський (білий)": "Квас трипільський (білий)",
  "Квас трипільський з коріандром": "Квас трипільський з коріандром",
} as const;

export type CanonLabel = (typeof CONTENT_CANON)[keyof typeof CONTENT_CANON];

// Сопоставление канонической метки → суффикс SKU
export const SUFFIX_BY_CONTENT: Record<CanonLabel, string> = {
  Класичний: "К",
  "Чоловіча Сила": "Ч",
  "Матусине Здоров'я": "М",
  Шипшина: "Ш",
  Журавлина: "Ж",
  "Квас трипільський": "КВ",
  "Квас трипільський (білий)": "КБ",
  "Квас трипільський з коріандром": "КК",
};

// Цены в ₴ за 1 банку (столбцы — 15/30/45/60/75)
export const PRICING_TABLE: Record<
  CanonLabel,
  [number, number, number, number, number]
> = {
  Класичний: [71, 68, 65, 63, 61],
  Шипшина: [80, 77, 74, 72, 70],
  Журавлина: [82, 79, 76, 74, 72],
  "Матусине Здоров'я": [77, 74, 71, 69, 67],
  "Чоловіча Сила": [77, 74, 71, 69, 67],
  "Квас трипільський": [59, 56, 52, 50, 48],
  "Квас трипільський (білий)": [59, 56, 52, 50, 48],
  "Квас трипільський з коріандром": [59, 56, 52, 50, 48],
};

// Нормализация лейбла в канон
export function toCanonLabel(labelRaw: string): CanonLabel {
  const t = (labelRaw || "")
    .trim()
    .replace(/[«»"]/g, "") // уберём кавычки
    .replace(/\s+/g, " ");
  // сначала точные ключи:
  for (const k of Object.keys(CONTENT_CANON)) {
    if (t.toLowerCase() === k.toLowerCase())
      return CONTENT_CANON[k as keyof typeof CONTENT_CANON];
  }
  // fallback: простые эвристики
  if (/класич/i.test(t)) return "Класичний";
  if (/чоловіч/i.test(t)) return "Чоловіча Сила";
  if (/матусин/i.test(t)) return "Матусине Здоров'я";
  if (/шипшин/i.test(t)) return "Шипшина";
  if (/журавлин/i.test(t)) return "Журавлина";
  if (/білий/i.test(t)) return "Квас трипільський (білий)";
  if (/коріандр/i.test(t)) return "Квас трипільський з коріандром";
  return "Квас трипільський";
}

export function unitPrice(content: CanonLabel, batchIndex: BatchIndex): number {
  const row = PRICING_TABLE[content];
  return row[(batchIndex - 1) as 0 | 1 | 2 | 3 | 4];
}

export function isKvas(content: CanonLabel): boolean {
  return content.startsWith("Квас ");
}
