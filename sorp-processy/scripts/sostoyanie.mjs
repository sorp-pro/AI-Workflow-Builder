// Состояние работы — в файл, чтобы разговор можно было сжать без потери качества.
//
//   node sostoyanie.mjs zapisat [--prichina "…"]   собрать и записать vyhod/processy/sostoyanie.md
//   node sostoyanie.mjs pokazat [--hook]           показать (с --hook — JSON для SessionStart)
//
// Файл из двух частей:
//   1) ведомая часть — vyhod/processy/sostoyanie-ruchnoe.md: что запущено (номера запусков,
//      фоновые задачи), принятые решения, что ждёт человека, следующие шаги. Её пишет Claude
//      по навыку sostoyanie-i-szhatie — это то, чего нельзя восстановить из файлов;
//   2) собранная часть — считается здесь из того, что лежит на диске и на стенде: модели и
//      итог прогона, отметки «занято», выкладки вопросов, вопросы и ответы на стенде.
//
// Хуки плагина: перед сжатием разговора (PreCompact) — zapisat; после сжатия (SessionStart
// с источником compact) — pokazat --hook, и состояние возвращается в разговор целиком.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { МОДЕЛИ, ВЫХОД, РАБОЧАЯ, напрямую } from './mesto.mjs';

const ФАЙЛ = path.join(ВЫХОД, 'sostoyanie.md');
const РУЧНОЕ = path.join(ВЫХОД, 'sostoyanie-ruchnoe.md');
const ПРЕДЕЛ_ХУКА = 9000;
const СТЕНД = (process.env.SORP_API_URL || 'https://workflow-builder-934054964.development.catalystserverless.com/server/builder_api').replace(/\/$/, '');

const когда = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

function ключ() {
  if (process.env.SORP_KEY) return process.env.SORP_KEY;
  for (const ф of [path.join(homedir(), '.sorp-processy', 'klyuch.json'), path.join(homedir(), '.sorp-builder', 'klyuch.json'), path.join(homedir(), '.sorp-svod', 'nastroyki.json')]) {
    try { const с = JSON.parse(readFileSync(ф, 'utf8')); if (с.ключ || с.key) return с.ключ || с.key; } catch {}
  }
  return null;
}

async function стенд() {
  const k = ключ();
  if (!k) return '- стенд: ключа на этой машине нет';
  const сторож = new AbortController();
  const будильник = setTimeout(() => сторож.abort(), 6000);
  try {
    const взять = async (п) => { const о = await fetch(СТЕНД + п, { signal: сторож.signal, headers: { 'X-Builder-Key': k } }); return о.ok ? о.json() : null; };
    const [в, о] = await Promise.all([взять('/questions?state=all'), взять('/answers')]);
    const строки = [];
    if (в?.вопросы) {
      const по = {};
      for (const q of в.вопросы) по[q.state] = (по[q.state] || 0) + 1;
      строки.push(`- вопросы на стенде: ${Object.entries(по).map(([s, n]) => `${s} ${n}`).join(' · ') || 'нет'}`);
    }
    if (о?.ответы) строки.push(`- новых ответов, ждущих внесения: ${о.ответы.length}${о.ответы.length ? ` (процессы: ${[...new Set(о.ответы.map((x) => x.proc_id))].join(', ')})` : ''}`);
    return строки.join('\n') || '- стенд: ответ пустой (ключ гостя видит не всё)';
  } catch (е) {
    return `- стенд недоступен: ${е.name === 'AbortError' ? 'нет ответа 6 с' : е.message}`;
  } finally { clearTimeout(будильник); }
}

async function собрать(причина) {
  const части = [`# Состояние работы · ${когда(Date.now())}`, `Рабочая папка: ${РАБОЧАЯ}${причина ? ` · записано: ${причина}` : ''}`];

  части.push('## Ведомая часть (решения, запуски, следующие шаги)');
  части.push(existsSync(РУЧНОЕ) ? readFileSync(РУЧНОЕ, 'utf8').trim() : '_Не ведётся: vyhod/processy/sostoyanie-ruchnoe.md нет. Запиши, что запущено и что дальше (навык sostoyanie-i-szhatie)._');

  части.push('## Собрано с диска и стенда');
  const модели = existsSync(МОДЕЛИ) ? readdirSync(МОДЕЛИ).filter((f) => /^PROC-\d{3}\.json$/.test(f)) : [];
  const строки = [`- моделей в modeli/processy: ${модели.length}`];
  const сводка = path.join(ВЫХОД, 'svodka.json');
  if (existsSync(сводка)) {
    try {
      const с = JSON.parse(readFileSync(сводка, 'utf8'));
      const все = с.сводка || [];
      const готово = все.filter((x) => x.готово).length;
      const не = все.filter((x) => !x.готово).map((x) => x.proc);
      строки.push(`- последний общий прогон (${когда(statSync(сводка).mtimeMs)}): моделей ${все.length}, логика готова ${готово}${не.length ? `, не готово: ${не.join(', ')}` : ''}`);
    } catch {}
  }
  const занято = path.join(ВЫХОД, 'zanyato');
  if (existsSync(занято)) {
    const z = readdirSync(занято).filter((f) => f.endsWith('.json'));
    строки.push(`- отметки «занято»: ${z.length ? z.map((f) => f.replace('.json', '')).join(', ') : 'нет'}`);
  }
  if (existsSync(ВЫХОД)) {
    for (const f of readdirSync(ВЫХОД).filter((x) => /^vylozheno-.*\.json$/.test(x))) {
      try { const v = JSON.parse(readFileSync(path.join(ВЫХОД, f), 'utf8')); строки.push(`- выкладка вопросов ${f.slice(10, -5)}: процессов ${Object.keys(v).length} (последняя ${когда(statSync(path.join(ВЫХОД, f)).mtimeMs)})`); } catch {}
    }
  }
  строки.push(await стенд());
  части.push(строки.join('\n'));
  return части.join('\n\n') + '\n';
}

export async function главная(argv = process.argv.slice(2)) {
  const [команда] = argv;
  const причина = argv.includes('--prichina') ? argv[argv.indexOf('--prichina') + 1] : null;
  if (команда === 'zapisat') {
    if (!existsSync(МОДЕЛИ) && !existsSync(ВЫХОД)) return; // не рабочая папка процессов — молчим
    mkdirSync(ВЫХОД, { recursive: true });
    const текст = await собрать(причина);
    writeFileSync(ФАЙЛ, текст);
    if (argv.includes('--hook')) process.stdout.write(JSON.stringify({ systemMessage: `Состояние работы записано: ${path.relative(РАБОЧАЯ, ФАЙЛ)}` }));
    else console.log(`записано: ${ФАЙЛ}`);
    return;
  }
  if (команда === 'pokazat') {
    if (!existsSync(ФАЙЛ)) return;
    let текст = readFileSync(ФАЙЛ, 'utf8');
    if (argv.includes('--hook')) {
      if (текст.length > ПРЕДЕЛ_ХУКА) текст = текст.slice(0, ПРЕДЕЛ_ХУКА) + `\n…(обрезано, полностью — ${ФАЙЛ})`;
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `[sorp-processy] Разговор был сжат. Состояние работы до сжатия (файл ${ФАЙЛ}) — продолжай от него, а не от памяти:\n\n${текст}` } }));
    } else process.stdout.write(текст);
    return;
  }
  console.log('Команды: zapisat [--prichina "…"] · pokazat [--hook]');
}

if (напрямую(import.meta.url)) главная().catch(() => process.exit(0));
