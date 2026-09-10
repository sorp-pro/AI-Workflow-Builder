// Самообновление папки с GitHub.
//
// ── Только для папки, не для плагина ─────────────────────────────────────────
// Поставленный плагин Claude Code держит в своём кэше и обновляет сам —
// `claude plugin update`. Переписать файлы у него под рукой значит получить
// кэш, который врёт о собственной версии. Поэтому здесь работаем, только когда
// нас открыли папкой: CLAUDE_PLUGIN_ROOT не задан.
//
// ── Почему не архив ──────────────────────────────────────────────────────────
// Разбирать zip в Node нечем без сторонних пакетов, а зависимостей у плагина
// нет и не должно быть: каждая — это ещё одно, что сломается у человека,
// который ставил разбор процессов, а не npm. Файлы берутся по одному с raw.
//
// ── Всё или ничего ───────────────────────────────────────────────────────────
// Сначала скачивается всё в память, потом пишется разом. Наполовину
// обновлённая папка — хуки новые, настройки старые — хуже необновлённой: она
// ломается так, что понять, почему, нельзя.

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { прочитать, записать } from './nastroyki.mjs';

const РЕПО = 'sorp-pro/AI-Workflow-Builder';
const ВЕТКА = 'main';
const СЫРОЕ = `https://raw.githubusercontent.com/${РЕПО}/${ВЕТКА}/`;
const ДЕРЕВО = `https://api.github.com/repos/${РЕПО}/git/trees/${ВЕТКА}?recursive=1`;

/** Чаще не проверяем: у GitHub шестьдесят запросов в час на адрес, и офис за одним адресом их выест. */
const РАЗ_В = 60 * 60 * 1000;

const КОРЕНЬ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function взять(адрес, ждать, как = 'text') {
  const сторож = new AbortController();
  const будильник = setTimeout(() => сторож.abort(), ждать);
  try {
    const о = await fetch(адрес, {
      signal: сторож.signal,
      headers: { 'User-Agent': 'sorp-svod', Accept: как === 'json' ? 'application/vnd.github+json' : '*/*' },
    });
    if (!о.ok) return null;
    return как === 'json' ? await о.json() : Buffer.from(await о.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(будильник);
  }
}

const версия = (т) => {
  try {
    return JSON.parse(String(т)).version || null;
  } catch {
    return null;
  }
};

/** «1.2.10» новее «1.2.9»: сравниваем числами, не строками. */
function новее(а, б) {
  const x = String(а).split('.').map(Number);
  const y = String(б).split('.').map(Number);
  for (let и = 0; и < Math.max(x.length, y.length); и++) {
    if ((x[и] || 0) !== (y[и] || 0)) return (x[и] || 0) > (y[и] || 0);
  }
  return false;
}

/**
 * Обновить папку, если на GitHub есть версия новее.
 *
 * Возвращает строку для Claude, если что-то произошло, и null, если нет.
 * Любая ошибка — это «не обновились», а не упавший старт сессии: человек
 * пришёл разбирать процессы, и недоступный GitHub не повод ему мешать.
 */
export async function обновить() {
  if (process.env.CLAUDE_PLUGIN_ROOT) return null;
  if (process.env.SORP_NO_UPDATE === '1') return null;

  const н = прочитать();
  if (н.проверкаОбновления && Date.now() - н.проверкаОбновления < РАЗ_В) return null;
  записать({ проверкаОбновления: Date.now() });

  const здесь = версия(existsSync(resolve(КОРЕНЬ, '.claude-plugin/plugin.json'))
    ? readFileSync(resolve(КОРЕНЬ, '.claude-plugin/plugin.json'), 'utf8')
    : '{}');
  const там = версия(await взять(СЫРОЕ + '.claude-plugin/plugin.json', 3000));
  if (!здесь || !там || !новее(там, здесь)) return null;

  const дерево = await взять(ДЕРЕВО, 3000, 'json');
  const файлы = (дерево?.tree || []).filter((у) => у.type === 'blob').map((у) => у.path);
  if (!файлы.length) return null;

  // Всё в память — разом, а не по очереди: хуку на старт отведено немного, и
  // двадцать файлов подряд в него не уложатся.
  const куда = файлы.map((путь) => resolve(КОРЕНЬ, путь));
  // Путь из чужого ответа — не повод писать за пределы папки.
  if (куда.some((к) => !к.startsWith(КОРЕНЬ + sep))) return null;
  const тела = await Promise.all(
    файлы.map((путь) => взять(СЫРОЕ + путь.split('/').map(encodeURIComponent).join('/'), 6000)),
  );
  if (тела.some((т) => !т)) return null;
  const новые = куда.map((к, и) => ({ куда: к, тело: тела[и] }));

  // Потом разом. Каждый файл — через временный и rename, чтобы хук, запущенный
  // в эту же секунду, не прочитал его наполовину записанным.
  for (const { куда, тело } of новые) {
    mkdirSync(dirname(куда), { recursive: true });
    const врем = куда + '.новый';
    writeFileSync(врем, тело);
    renameSync(врем, куда);
  }

  return (
    `[SORP] Плагин обновился с GitHub: ${здесь} → ${там}. ` +
    'Скажи человеку об этом одной строкой и добавь, что новые хуки заработают со следующей сессии.'
  );
}
