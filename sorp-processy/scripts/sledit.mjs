// Следит за моделями процессов: печатает строку, когда модель изменилась и затихла.
//
//   node sledit.mjs
//
// Для Monitor: каждая строка «модели: PROC-012 PROC-038» — сигнал выложить их вопросы
// на страницу вопросов (voprosy.mjs + write_db). Агенты правят модель много раз за прогон,
// поэтому строка печатается, когда файл не менялся ТИХО секунд, а не на каждую запись.

import { readdirSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { МОДЕЛИ, напрямую } from './mesto.mjs';

const ТИХО = 90_000;
const ШАГ = 15_000;

export function главная() {
  mkdirSync(МОДЕЛИ, { recursive: true });
  const видели = new Map();
  const ждут = new Map();
  const снимок = () => new Map(readdirSync(МОДЕЛИ).filter((f) => /^PROC-\d{3}\.json$/.test(f)).map((f) => [f.replace('.json', ''), statSync(path.join(МОДЕЛИ, f)).mtimeMs]));
  for (const [id, t] of снимок()) видели.set(id, t);
  console.log(`слежу: моделей ${видели.size}`);
  setInterval(() => {
    const сейчас = Date.now();
    for (const [id, t] of снимок()) if (видели.get(id) !== t) { видели.set(id, t); ждут.set(id, t); }
    const готовы = [...ждут].filter(([, t]) => сейчас - t >= ТИХО).map(([id]) => id);
    if (готовы.length) {
      for (const id of готовы) ждут.delete(id);
      console.log(`модели: ${готовы.join(' ')}`);
    }
  }, ШАГ);
}

if (напрямую(import.meta.url)) главная();
