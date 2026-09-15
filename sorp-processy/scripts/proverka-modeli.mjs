// Проверка модели процесса до прогона: ключи, ссылки, выражения.
//
// Ошибка — модель нельзя исполнить (ссылка в пустоту, неизвестная операция, время не
// разбирается). Предупреждение — исполнить можно, но это пробел: нет основания,
// шаг без стола, список без значений.

import { вМинуты, календарь } from './dvizhok.mjs';

const ОПЕРАЦИИ = new Set(['filled', 'empty', '==', '!=', 'in', '<', '<=', '>', '>=', 'same_day', 'workday', 'contains_all', 'subset', 'done', 'not_same_actor', 'and', 'or', 'not']);
const ВЫЧИСЛЕНИЯ = new Set(['+', '-', '*', '/', 'min', 'max', 'floor']);
const ТИПЫ = new Set(['text', 'number', 'money', 'percent', 'date', 'datetime', 'bool', 'enum', 'multienum', 'ref', 'file', 'user', 'table']);
const ИСХОДЫ = new Set(['отказ', 'сигнал', 'эскалация']);
const АДРЕСАТЫ = new Set(['владелец', 'аналитик', 'стол', 'настройка']);
const СДВИГИ = new Set(['minutes', 'hours', 'days', 'workdays', 'workhours']);

export function проверить(м) {
  const ошибки = [], предупреждения = [];
  const о = (т) => ошибки.push(т), п = (т) => предупреждения.push(т);
  for (const ключ of ['process', 'desks', 'fields', 'steps', 'rules', 'numbers', 'paths', 'questions']) if (м?.[ключ] === undefined) о(`нет раздела ${ключ}`);
  if (ошибки.length) return { ошибки, предупреждения };
  if (!м.process.id || !м.process.title) о('process: нужны id и title');
  if (!м.process.fact) п('process: не названа точка факта процесса');
  let кал = null;
  try { кал = календарь(м); if (!/^\d{4}-\d{2}-\d{2}$/.test(кал.start) || !Array.isArray(кал.workdays) || кал.hours.length !== 2) о('calendar: start ГГГГ-ММ-ДД, workdays [1..7], hours ["09:00","18:00"]'); } catch (e) { о(`calendar: ${e.message}`); }

  const столы = new Set(м.desks.map((d) => d.code));
  const внешние = new Set((м.externals || []).map((x) => x.id));
  const записи = new Set((м.records || []).map((r) => r.key));
  const поля = new Map();
  for (const f of м.fields) {
    if (!f.key) { о(`поле без key: ${JSON.stringify(f).slice(0, 80)}`); continue; }
    if (поля.has(f.key)) о(`поле ${f.key} описано дважды`);
    поля.set(f.key, f);
    if (!ТИПЫ.has(f.type)) о(`поле ${f.key}: тип «${f.type}» не из списка`);
    if ((f.type === 'enum' || f.type === 'multienum') && !f.values?.length) п(`поле ${f.key}: список без значений`);
    if (f.record && записи.size && !записи.has(f.record)) о(`поле ${f.key}: записи ${f.record} нет в records`);
    if (!f.source) п(`поле ${f.key}: нет основания`);
  }
  for (const [k, ч] of Object.entries(м.numbers)) {
    if (!Number.isFinite(ч.value)) о(`число ${k}: value не число`);
    if ('inclusive' in ч && ![true, false, null].includes(ч.inclusive)) о(`число ${k}: inclusive — true, false или null`);
    if (!ч.source) п(`число ${k}: нет основания`);
  }
  const шаги = new Map();
  for (const ш of м.steps) {
    if (шаги.has(ш.key)) о(`шаг ${ш.key} описан дважды`);
    шаги.set(ш.key, ш);
  }
  const стол = (код, где) => { if (код && typeof код === 'object' && 'field' in код) { if (!поля.has(код.field)) о(`${где}: поля ${код.field} нет`); return; } if (код && !столы.has(код)) п(`${где}: стола ${код} нет в desks`); };
  const сдвиг = (s, где) => { if (!s || typeof s !== 'object') { о(`${где}: нужен сдвиг { workdays | days | … }`); return; } const k = Object.keys(s).filter((x) => СДВИГИ.has(x)); if (!k.length) о(`${где}: нет ни одного из ${[...СДВИГИ].join(', ')}`); for (const x of k) if (!Number.isFinite(s[x])) о(`${где}: ${x} не число`); };

  const выр = (в, где) => {
    if (в === null || typeof в !== 'object') return;
    if (Array.isArray(в)) { for (const x of в) выр(x, где); return; }
    if (в.plus) сдвиг(в.plus, `${где} (plus)`);
    if ('field' in в) { if (!поля.has(в.field)) о(`${где}: поля ${в.field} нет`); return; }
    if ('number' in в) { if (!(в.number in м.numbers)) о(`${где}: числа ${в.number} нет`); return; }
    if ('now' in в) { if (!['time', 'abs', 'date'].includes(в.now)) о(`${где}: now — time, abs или date`); return; }
    if ('date' in в) { try { вМинуты(в.date, кал); } catch (e) { о(`${где}: ${e.message}`); } return; }
    for (const k of ['decision', 'step_time', 'step_desk', 'step_actor', 'passes']) if (k in в) { if (!шаги.has(в[k])) о(`${где}: шага ${в[k]} нет`); return; }
    if ('desk' in в || 'actor' in в) return;
    if ('external' in в) { if (!внешние.has(в.external)) о(`${где}: внешнего события ${в.external} нет в externals`); return; }
    for (const k of ['signoff_desk', 'signoff_actor', 'count']) if (k in в) { if (!поля.has(в[k])) о(`${где}: поля ${в[k]} нет`); return; }
    if ('calc' in в) { if (!ВЫЧИСЛЕНИЯ.has(в.calc)) о(`${где}: неизвестное вычисление «${в.calc}»`); for (const x of в.args || []) выр(x, где); return; }
    if (!ОПЕРАЦИИ.has(в.op)) { о(`${где}: неизвестная операция «${в.op}»`); return; }
    if ((в.op === 'done' || в.op === 'not_same_actor') && !шаги.has(в.step)) о(`${где}: шага ${в.step} нет`);
    for (const x of [в.a, в.b, ...(в.args || [])]) выр(x, где);
  };

  for (const ш of м.steps) {
    if (!Number.isInteger(ш.no)) о(`шаг ${ш.key}: no не целое`);
    if (!ш.desk) п(`шаг ${ш.key}: нет стола — шаг не попадёт ни в одну очередь`);
    else if (!столы.has(ш.desk) && ш.desk !== 'ИНИЦИАТОР') о(`шаг ${ш.key}: стола ${ш.desk} нет в desks`);
    for (const d of ш.desks || []) if (!столы.has(d) && d !== 'ИНИЦИАТОР') о(`шаг ${ш.key}: стола ${d} нет в desks`);
    for (const пш of ш.fields || []) {
      if (!поля.has(пш.field)) о(`шаг ${ш.key}: поля ${пш.field} нет в fields`);
      if (!['пишет', 'читает', 'разрез'].includes(пш.role)) о(`шаг ${ш.key}: роль поля «${пш.role}»`);
      if (пш.required && typeof пш.required === 'object') выр(пш.required.when, `шаг ${ш.key}, обязательность ${пш.field}`);
      for (const d of [].concat(пш.by_desk || [])) стол(d, `шаг ${ш.key}, виза ${пш.field}`);
    }
    if (ш.decision && !ш.decision.options?.length) о(`шаг ${ш.key}: решение без вариантов`);
    for (const р of ш.next || []) {
      if (р.step !== 'END' && !шаги.has(р.step)) о(`шаг ${ш.key}: следом ${р.step} — такого шага нет`);
      if (р.when && р.when !== '*' && ш.decision && [].concat(р.when).some((x) => !ш.decision.options.includes(x))) о(`шаг ${ш.key}: ветка «${р.when}» не из вариантов решения`);
    }
    if (ш.deadline !== undefined) for (const d of [].concat(ш.deadline)) { сдвиг(d, `шаг ${ш.key}, срок`); выр(d.when, `шаг ${ш.key}, срок (when)`); выр(d.from, `шаг ${ш.key}, срок (from)`); for (const x of [].concat(d.to || [])) стол(x, `шаг ${ш.key}, срок (to)`); }
    for (const н of ш.notify || []) { if (!н.to) о(`шаг ${ш.key}: уведомление без адресата`); for (const x of [].concat(н.to || [])) стол(x, `шаг ${ш.key}, уведомление`); выр(н.when, `шаг ${ш.key}, уведомление`); }
    for (const x of [].concat(ш.requires_external || [])) if (!внешние.has(x)) о(`шаг ${ш.key}: внешнего события ${x} нет в externals`);
    if (ш.max_passes !== undefined && !(Number.isInteger(ш.max_passes) && ш.max_passes > 0)) о(`шаг ${ш.key}: max_passes — целое больше нуля`);
    if (!ш.fact) п(`шаг ${ш.key}: нет точки факта`);
    if (!ш.source) п(`шаг ${ш.key}: нет основания`);
  }

  const иды = new Set();
  for (const r of м.rules) {
    if (!r.id) { о('правило без id'); continue; }
    if (иды.has(r.id)) о(`правило ${r.id} описано дважды`);
    иды.add(r.id);
    if (!шаги.has(r.step)) о(`правило ${r.id}: шага ${r.step} нет`);
    if (r.kind === 'текст') { if (r.test) п(`правило ${r.id}: kind «текст», но есть test`); }
    else if (!r.test) о(`правило ${r.id}: нет test — либо выражение, либо kind «текст»`);
    выр(r.test, `правило ${r.id}`);
    выр(r.when, `правило ${r.id} (when)`);
    if (r.on_fail && !ИСХОДЫ.has(r.on_fail.outcome || 'отказ')) о(`правило ${r.id}: исход «${r.on_fail.outcome}»`);
    for (const x of [].concat(r.on_fail?.to || [])) стол(x, `правило ${r.id}`);
    if (!r.source) п(`правило ${r.id}: нет основания`);
  }
  for (const тм of м.timers || []) {
    const где = `таймер ${тм.id}`;
    if (!тм.id) о('таймер без id');
    if (!тм.from) о(`${где}: нет from`);
    else if (тм.from.step && !шаги.has(тм.from.step)) о(`${где}: шага ${тм.from.step} нет`);
    else if (тм.from.opened && !шаги.has(тм.from.opened)) о(`${где}: шага ${тм.from.opened} нет`);
    else if (!тм.from.step && !тм.from.opened && !тм.from.start) выр(тм.from, где);
    сдвиг(тм.after, `${где}, after`);
    if (тм.until?.step && !шаги.has(тм.until.step)) о(`${где}: шага ${тм.until.step} нет`);
    else if (тм.until?.op) выр(тм.until, `${где}, until`);
    выр(тм.pause_while, `${где}, pause_while`);
    for (const x of [].concat(тм.to || [])) стол(x, где);
    if (!тм.source) п(`${где}: нет основания`);
  }
  if (!м.paths.length) о('нет ни одного пути — сценарии не из чего выводить');
  for (const путь of м.paths) {
    for (const e of путь.events || []) {
      try { вМинуты(e.at, кал); } catch (ош) { о(`путь «${путь.name}»: ${ош.message}`); }
      if (e.tick) continue;
      if (e.external) { if (!внешние.has(e.external)) о(`путь «${путь.name}»: внешнего события ${e.external} нет в externals`); continue; }
      const где = `путь «${путь.name}», ${e.step}`;
      const ш = шаги.get(e.step);
      if (!ш) { о(`${где}: шага нет`); continue; }
      if (e.desk && !столы.has(e.desk) && e.desk !== 'ИНИЦИАТОР') о(`${где}: стола ${e.desk} нет`);
      const пишетШаг = new Set((ш.fields || []).filter((x) => x.role === 'пишет').map((x) => x.field));
      const пишетКтоТо = new Set(м.steps.flatMap((s) => (s.fields || []).filter((x) => x.role === 'пишет').map((x) => x.field)));
      for (const к of Object.keys(e.values || {})) {
        if (!поля.has(к)) о(`${где}: поля ${к} нет`);
        else if (!пишетШаг.has(к) && пишетКтоТо.has(к)) п(`${где}: путь вносит «${к}», а пишет его другой шаг — на столе этого ввода не будет`);
      }
      for (const [к, в] of Object.entries(e.signoffs || {})) { if (!поля.has(к)) о(`${где}: визы по полю ${к} — поля нет`); if (в?.desk && !столы.has(в.desk)) о(`${где}: визирует стол ${в.desk}, его нет`); }
      if (ш.decision && e.decision && !ш.decision.options.includes(e.decision)) о(`${где}: решения «${e.decision}» нет в вариантах`);
    }
  }
  for (const q of м.questions) {
    if (!q.id || !q.question) о(`вопрос без id или текста: ${JSON.stringify(q).slice(0, 80)}`);
    if (q.ask && !АДРЕСАТЫ.has(q.ask)) о(`вопрос ${q.id}: адресат «${q.ask}»`);
    if (!q.searched) п(`вопрос ${q.id}: не записано, где искали ответ`);
  }
  return { ошибки, предупреждения };
}
