// Порог полноты: всё ли из пакета процесса попало в модель.
//
//   node polnota.mjs PROC-012          что из пакета модель не покрывает
//   node polnota.mjs PROC-012 --json
//
// Прогон проверяет модель саму по себе: 5 правил и 50 правил дают одинаковое «логика готова».
// Порог сверяет модель с пакетом — с тем, что про процесс известно в карте:
//
//   шаг        каждый шаг пакета есть в модели; исполнитель — стол из пакета;
//   срок       у шага пакета есть норма → у шага модели есть срок (deadline, таймер или правило срока);
//   отказ      у шага пакета описан отказ → в модели у шага есть правило или решение с отказом/возвратом;
//   решение    каждое решение карты с ключом процесса упомянуто в модели кодом (в source, why, searched…);
//   число      суммы, время и сроки из норм, отказов и входов шагов есть в модели.
//
// Что сознательно не берётся в модель, записывается в модель же: "coverage_skip": [{ "ref": "G123", "why": "…" }].
// ref — ровно тот, что печатает порог. Без why пропуск не засчитывается: молча выбросить нельзя.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { ВЫХОД, МОДЕЛИ, напрямую } from './mesto.mjs';

const текст = (x) => (x == null ? '' : typeof x === 'string' ? x : JSON.stringify(x));
const экран = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Числа из текста нормы, отказа, входа: деньги, время суток, длительности. */
function числа(т) {
  const out = [];
  const s = текст(т).replace(/(\d)[\s  ](?=\d{3}\b)/g, '$1');
  for (const м of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:AED|дирхам\p{L}*)/giu)) out.push({ вид: 'сумма', v: м[1].replace(',', '.'), подпись: м[0] });
  for (const м of s.matchAll(/(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])/g)) out.push({ вид: 'время', v: `${м[1].padStart(2, '0')}:${м[2]}`, мин: Number(м[1]) * 60 + Number(м[2]), подпись: м[0] });
  for (const м of s.matchAll(/(\d+)\s*(р\.\s?д\.?|рабоч\p{L}*\s+(?:дн\p{L}*|час\p{L}*)|календарн\p{L}*\s+дн\p{L}*|дн(?:я|ей|ь)\b|час(?:а|ов)?\b|мин(?:ут\p{L}*)?\b|месяц\p{L}*|недел\p{L}*)/giu)) {
    if (Number(м[1]) === 0) continue;
    out.push({ вид: 'срок', v: м[1], подпись: м[0].replace(/\s+/g, ' ') });
  }
  return out;
}

/** Есть ли число в модели. Для малых чисел срока нужен контекст срока, иначе совпадение ничего не значит. */
function естьЧисло(модельТекст, ч) {
  if (ч.вид === 'сумма') return new RegExp(`(?<![\\d.])${экран(ч.v.replace(/\.0+$/, ''))}(?![\\d])`).test(модельТекст);
  if (ч.вид === 'время') return модельТекст.includes(`"${ч.v}"`) || модельТекст.includes(ч.v) || new RegExp(`"(?:value|minutes|at|from|to|min)"\\s*:\\s*${ч.мин}(?!\\d)`).test(модельТекст);
  const n = ч.v;
  return new RegExp(`"(?:workdays|days|hours|workhours|minutes|value|max_passes|deadline_min)"\\s*:\\s*${n}(?!\\d)`).test(модельТекст)
    || new RegExp(`(?<!\\d)${n}\\s*(?:р\\.?\\s?д|рабоч|календарн|дн|час|мин|месяц|недел)`, 'iu').test(модельТекст);
}

export function полнота(модель, пакет) {
  const пропуск = new Map((модель.coverage_skip || []).filter((x) => x?.ref && String(x.why || '').trim()).map((x) => [String(x.ref), x.why]));
  const модельТекст = JSON.stringify({ ...модель, coverage_skip: undefined });
  const proc = модель.process?.id;
  const итог = { всего: 0, покрыто: 0, пропущено: 0, не_покрыто: [] };
  const учесть = (ref, что, есть) => {
    итог.всего++;
    if (есть) { итог.покрыто++; return; }
    if (пропуск.has(ref)) { итог.пропущено++; return; }
    итог.не_покрыто.push({ ref, что });
  };

  const шагиМодели = new Map((модель.steps || []).map((s) => [s.key, s]));
  const правилаШага = (key) => (модель.rules || []).filter((r) => r.step === key);
  const таймерыШага = (key) => (модель.timers || []).filter((t) => t.step === key || текст(t).includes(key));

  for (const ш of пакет.шаги || []) {
    const м = шагиМодели.get(ш.id);
    учесть(`${ш.id}`, `шаг ${ш.i} «${ш.a}» есть в модели`, !!м);
    if (!м) continue;
    if (/^DESK-\d{3}$/.test(ш.x || '')) учесть(`${ш.id}:стол`, `шаг ${ш.i}: исполнитель ${ш.x} (в модели ${м.desk || 'не назван'})`, м.desk === ш.x || (м.desks || []).includes(ш.x));
    const норма = текст(ш.norm).trim();
    if (норма && !/не\s+нормир/i.test(норма) && !ш.norm_ne_normiruetsya) {
      const срок = м.deadline || м.deadline_min != null || таймерыШага(ш.id).length || правилаШага(ш.id).some((r) => /deadline|workdays|workhours|"days"|"hours"|"minutes"|same_day|"now"/.test(текст(r)));
      учесть(`${ш.id}:срок`, `шаг ${ш.i}: срок из нормы «${норма.slice(0, 120)}»`, !!срок);
    }
    const отказ = ш.otkaz && (ш.otkaz.chto || typeof ш.otkaz === 'string');
    if (отказ) {
      const есть = правилаШага(ш.id).some((r) => r.on_fail || r.kind === 'текст')
        || (м.decision?.options || []).some((o) => /отказ|возврат|вернут|отклон|удерж|стоп|нет/i.test(o))
        || (м.next || []).some((n) => n.step === 'END' || (шагиМодели.get(n.step)?.no ?? 1e9) < (м.no ?? 0));
      учесть(`${ш.id}:отказ`, `шаг ${ш.i}: отказ «${текст(ш.otkaz.chto ?? ш.otkaz).slice(0, 120)}»`, есть);
    }
    for (const [откуда, т] of [['норма', ш.norm], ['отказ', ш.otkaz?.chto ?? (typeof ш.otkaz === 'string' ? ш.otkaz : '')], ['срок отказа', ш.otkaz?.srok], ['вход', ш.cond]]) {
      for (const ч of числа(т)) учесть(`${ш.id}:${ч.вид}:${ч.v}`, `шаг ${ш.i}, ${откуда}: ${ч.подпись}`, естьЧисло(модельТекст, ч));
    }
  }

  const видели = new Set();
  for (const d of пакет.решения || []) {
    if (!d.code || видели.has(d.code) || !(d.keys || []).includes(proc)) continue;
    видели.add(d.code);
    const есть = new RegExp(`(?<![\\p{L}\\d-])${экран(d.code)}(?![\\d\\p{L}])`, 'u').test(модельТекст);
    учесть(d.code, `решение ${d.code} (${d.date || ''}): ${текст(d.text).slice(0, 140)}`, есть);
  }
  // Итог по числам — без повторов одного числа одного шага.
  const уник = new Map();
  for (const x of итог.не_покрыто) if (!уник.has(x.ref)) уник.set(x.ref, x);
  итог.не_покрыто = [...уник.values()];
  return итог;
}

export function пакетПроцесса(proc) {
  const ф = path.join(ВЫХОД, 'pakety', `${proc}.json`);
  return existsSync(ф) ? JSON.parse(readFileSync(ф, 'utf8')) : null;
}

if (напрямую(import.meta.url)) {
  const [proc, флаг] = process.argv.slice(2);
  if (!proc) { console.error('node polnota.mjs PROC-xxx [--json]'); process.exit(1); }
  const модель = JSON.parse(readFileSync(path.join(МОДЕЛИ, `${proc}.json`), 'utf8'));
  const пакет = пакетПроцесса(proc);
  if (!пакет) { console.error(`нет пакета ${proc}: node paket.mjs ${proc}`); process.exit(2); }
  const и = полнота(модель, пакет);
  if (флаг === '--json') { process.stdout.write(JSON.stringify(и, null, 2)); process.exit(0); }
  console.log(`Полнота ${proc}: покрыто ${и.покрыто} из ${и.всего}, пропущено с причиной ${и.пропущено}, не покрыто ${и.не_покрыто.length}`);
  for (const x of и.не_покрыто) console.log(`  ✗ ${x.ref} — ${x.что}`);
}
