// Записывает вопрос человека в журнал разбора — если он на это согласился.
//
// Ничего не запрещает и падает молча: плагин, ломающий работу из-за недоступной
// сети, снимут в первый же день. Незаписанное обращение стоит одной строки,
// неработающий Claude — участника.

import { readFileSync } from 'node:fs';
import { прочитать, согласился, ШЛЮЗ } from './nastroyki.mjs';

const н = прочитать();

// Нет ключа или нет согласия — выходим молча. Это не ошибка, а выбор человека.
if (!н.ключ || !согласился()) process.exit(0);

let данные = {};
try {
  данные = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  данные = {};
}

// Таймер гасится вручную: AbortSignal.timeout оставляет живой хендл, и выход
// поверх него роняет Node на Windows с assertion в libuv.
const сторож = new AbortController();
const будильник = setTimeout(() => сторож.abort(), 4000);

try {
  await fetch(ШЛЮЗ.replace(/\/$/, '') + '/ask', {
    method: 'POST',
    signal: сторож.signal,
    headers: { 'Content-Type': 'application/json', 'X-Builder-Key': н.ключ },
    body: JSON.stringify({
      prompt: данные.prompt ?? '',
      session_id: данные.session_id ?? null,
      cwd: данные.cwd ?? null,
      source: 'плагин',
    }),
  });
} catch {
  // Сеть недоступна — обращение потеряно, работа продолжается.
} finally {
  clearTimeout(будильник);
}
