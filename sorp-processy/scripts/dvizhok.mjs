// Общий движок процесса: исполняет события по модели процесса и говорит, чем кончилось каждое.
//
// Формат модели — docs/format-modeli-processa.md (формат 2 совместим с 1). Движок один на все
// процессы и без зависимостей: тот же файл работает в прогоне (node) и на столе на имитации
// (браузер), в платформу он выкладывается генератором, а не копией (П4).
//
// Исходы действия:
//   принято         — шаг сдан;
//   отказ           — правило или маршрут запретили, шаг не сдан;
//   сигнал          — шаг сдан, но кто-то должен узнать (правило, просрочка, таймер);
//   уведомление     — шаг сдан, адресату ушло сообщение по ходу процесса (не нарушение);
//   не определено   — правило упёрлось в границу, про которую источник молчит;
//   сбой модели     — выражение не вычисляется: в модели ошибка.
//
// Время — минуты от полуночи дня D+0. День D+0 — это calendar.start; от него считаются даты
// полей («2026-09-20»), рабочие дни и часы (A32: календарь по Дубаю для всех контуров).

export const КАЛЕНДАРЬ = {
  tz: 'Asia/Dubai', start: '2026-09-14', workdays: [1, 2, 3, 4, 5], hours: ['09:00', '18:00'], holidays: [],
  source: 'A32 — рабочий календарь по Дубаю для всех контуров; пн–пт 09:00–18:00 — практика ОАЭ (допущение до слова владельца)',
};

const ДЕНЬ = 1440;
const чисел = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

export function календарь(модель) {
  const к = { ...КАЛЕНДАРЬ, ...(модель?.calendar || {}) };
  const [y, m, d] = к.start.split('-').map(Number);
  const старт = Date.UTC(y, m - 1, d);
  const праздники = new Set(к.holidays || []);
  const iso = (день) => new Date(старт + день * 86400000).toISOString().slice(0, 10);
  const рабочий = (день) => { const д = new Date(старт + день * 86400000).getUTCDay() || 7; return к.workdays.includes(д) && !праздники.has(iso(день)); };
  return { ...к, старт, начало: чисел(к.hours[0]), конец: чисел(к.hours[1]), iso, рабочий };
}

export function вМинуты(т, кал) {
  if (typeof т === 'number') return т;
  const s = String(т ?? '').trim();
  let м = s.match(/^D\+(\d+)\s+(\d{1,2}):(\d{2})$/);
  if (м) return +м[1] * ДЕНЬ + +м[2] * 60 + +м[3];
  м = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
  if (м) {
    const к = кал || календарь(null);
    return Math.round((Date.UTC(+м[1], +м[2] - 1, +м[3]) - к.старт) / 60000) + (м[4] ? +м[4] * 60 + +м[5] : 0);
  }
  throw new Error(`время «${т}» не в виде «D+0 10:00» или «2026-09-20»`);
}
const похожеНаВремя = (v) => typeof v === 'string' && /^(D\+\d+\s+\d{1,2}:\d{2}|\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?)$/.test(v.trim());
export const чч = (t) => `D+${Math.floor(t / ДЕНЬ)} ${String(Math.floor((t % ДЕНЬ) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
export const пусто = (з) => з === undefined || з === null || (typeof з === 'string' && !з.trim()) || (Array.isArray(з) && !з.length);

/** Сдвиг времени: { minutes | hours | days | workdays | workhours }. */
export function плюс(кал, t, p) {
  if (!p) return t;
  let r = t + (p.minutes || 0) + (p.hours || 0) * 60 + (p.days || 0) * ДЕНЬ;
  if (p.workdays !== undefined) {
    // «N рабочих дней» — до конца рабочего времени N-го рабочего дня после дня события.
    // Событие в нерабочее время считается с ближайшего рабочего дня (A32).
    let d = Math.floor(r / ДЕНЬ);
    let guard = 0;
    if (!(кал.рабочий(d) && r % ДЕНЬ < кал.конец)) { d++; while (!кал.рабочий(d) && guard++ < 400) d++; }
    for (let i = 0; i < p.workdays; i++) { d++; while (!кал.рабочий(d) && guard++ < 400) d++; }
    r = d * ДЕНЬ + кал.конец;
  }
  if (p.workhours !== undefined) {
    let осталось = p.workhours * 60, guard = 0;
    while (осталось > 0 && guard++ < 5000) {
      const d = Math.floor(r / ДЕНЬ), m = r % ДЕНЬ;
      if (!кал.рабочий(d) || m >= кал.конец) { r = (d + 1) * ДЕНЬ + кал.начало; continue; }
      if (m < кал.начало) { r = d * ДЕНЬ + кал.начало; continue; }
      const взять = Math.min(кал.конец - m, осталось);
      r += взять; осталось -= взять;
    }
  }
  return r;
}

/** Быстрый доступ к модели: шаги, поля, маршрут, правила по шагам, календарь. */
export function индекс(модель) {
  const шаги = new Map(модель.steps.map((ш) => [ш.key, ш]));
  const поля = new Map((модель.fields || []).map((п) => [п.key, п]));
  const числа = модель.numbers || {};
  const порядок = [...модель.steps].sort((a, b) => a.no - b.no);
  const следом = (ш) => {
    if (Array.isArray(ш.next)) return ш.next;
    const д = порядок.find((x) => x.no === ш.no + 1);
    return д ? [{ when: '*', step: д.key }] : [];
  };
  // Возврат — переход на шаг с меньшим номером (при равных номерах — на шаг, описанный в
  // модели раньше): это цикл доработки, а не предшественник. Иначе шаг, в который
  // возвращаются, никогда не открылся бы первым.
  const место = new Map(модель.steps.map((ш, i) => [ш.key, i]));
  const назад = (из, в) => {
    if (в === 'END' || !шаги.has(в)) return false;
    const цель = шаги.get(в);
    return цель.no < из.no || (цель.no === из.no && место.get(в) <= место.get(из.key));
  };
  const предки = new Map(модель.steps.map((ш) => [ш.key, []]));
  for (const ш of модель.steps) for (const р of следом(ш)) if (р.step !== 'END' && предки.has(р.step) && !назад(ш, р.step)) предки.get(р.step).push(ш.key);
  const правила = new Map(модель.steps.map((ш) => [ш.key, (модель.rules || []).filter((п) => п.step === ш.key)]));
  return { шаги, поля, числа, порядок, следом, предки, назад, правила, кал: календарь(модель) };
}

const подходит = (р, решение) => !р.when || р.when === '*' || [].concat(р.when).includes(решение);

// ─── Выражения ────────────────────────────────────────────────────────────────

function базовое(в, к) {
  if ('field' in в) return к.значения[в.field];
  if ('number' in в) {
    const ч = к.И.числа[в.number];
    if (!ч) throw new Error(`нет числа «${в.number}»`);
    return ч.value;
  }
  if ('now' in в) return в.now === 'abs' ? к.t : в.now === 'date' ? Math.floor(к.t / ДЕНЬ) * ДЕНЬ : к.t % ДЕНЬ;
  if ('decision' in в) return в.decision === к.шаг ? к.решение : к.с.решения[в.decision];
  if ('date' in в) return вМинуты(в.date, к.И.кал);
  if ('step_time' in в) return к.с.шаги[в.step_time]?.сделан_в ?? undefined;
  if ('step_desk' in в) return к.с.шаги[в.step_desk]?.стол ?? undefined;
  if ('step_actor' in в) return к.с.шаги[в.step_actor]?.кто ?? undefined;
  if ('passes' in в) return к.с.шаги[в.passes]?.проходов ?? 0;
  if ('desk' in в) return к.desk;
  if ('actor' in в) return к.actor;
  if ('external' in в) return к.с.внешние[в.external];
  if ('signoff_desk' in в) return к.визы[в.signoff_desk]?.desk;
  if ('signoff_actor' in в) return к.визы[в.signoff_actor]?.actor;
  if ('count' in в) { const v = к.значения[в.count]; return Array.isArray(v) ? v.length : пусто(v) ? 0 : 1; }
  if ('calc' in в) {
    const xs = (в.args || []).map((x) => число(значение(x, к), к));
    if (xs.some((x) => x === null)) return undefined;
    switch (в.calc) {
      case '+': return xs.reduce((a, b) => a + b, 0);
      case '-': return xs.slice(1).reduce((a, b) => a - b, xs[0]);
      case '*': return xs.reduce((a, b) => a * b, 1);
      case '/': return xs.slice(1).reduce((a, b) => a / b, xs[0]);
      case 'min': return Math.min(...xs);
      case 'max': return Math.max(...xs);
      case 'floor': return Math.floor(xs[0]);
      default: throw new Error(`неизвестное вычисление «${в.calc}»`);
    }
  }
  throw new Error(`непонятное значение ${JSON.stringify(в)}`);
}

function значение(в, к) {
  if (в === null || typeof в !== 'object' || Array.isArray(в)) return в;
  const v = базовое(в, к);
  if (!в.plus || пусто(v)) return v;
  return плюс(к.И.кал, число(v, к), в.plus);
}

function число(v, к) {
  if (пусто(v)) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (похожеНаВремя(v)) return вМинуты(v, к.И.кал);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`не число и не время: ${JSON.stringify(v)}`);
  return n;
}

/** true · false · null («не определено»). */
export function вычислить(в, к) {
  switch (в.op) {
    case 'filled': return !пусто(значение(в.a, к));
    case 'empty': return пусто(значение(в.a, к));
    case '==': return значение(в.a, к) === значение(в.b, к);
    case '!=': return значение(в.a, к) !== значение(в.b, к);
    case 'in': return [].concat(значение(в.b, к) || []).includes(значение(в.a, к));
    case '<': case '<=': case '>': case '>=': {
      const A = число(значение(в.a, к), к), B = число(значение(в.b, к), к);
      if (A === null || B === null) return null;
      if (A !== B) return в.op[0] === '<' ? A < B : A > B;
      if (в.op === '<' || в.op === '>') return false;
      const граница = [в.a, в.b].find((x) => x && typeof x === 'object' && 'number' in x);
      const вкл = граница ? к.И.числа[граница.number].inclusive : undefined;
      if (вкл === null) return null;
      return вкл !== false;
    }
    case 'same_day': {
      const A = число(значение(в.a, к), к), B = число(значение(в.b, к), к);
      if (A === null || B === null) return null;
      return Math.floor(A / ДЕНЬ) === Math.floor(B / ДЕНЬ);
    }
    case 'workday': {
      const A = число(значение(в.a, к), к);
      if (A === null) return null;
      return к.И.кал.рабочий(Math.floor(A / ДЕНЬ)) && A % ДЕНЬ >= к.И.кал.начало && A % ДЕНЬ < к.И.кал.конец;
    }
    case 'contains_all': case 'subset': {
      const A = [].concat(значение(в.a, к) ?? []), B = [].concat(значение(в.b, к) ?? []);
      return в.op === 'contains_all' ? B.every((x) => A.includes(x)) : A.every((x) => B.includes(x));
    }
    case 'done': return к.с.шаги[в.step]?.статус === 'сделан' || (к.с.шаги[в.step]?.проходов || 0) > 0;
    case 'not_same_actor': {
      const было = к.с.шаги[в.step];
      if (!было || !было.кто) return true;
      return было.кто !== к.actor;
    }
    case 'and': {
      const р = (в.args || []).map((x) => вычислить(x, к));
      return р.includes(false) ? false : р.includes(null) ? null : true;
    }
    case 'or': {
      const р = (в.args || []).map((x) => вычислить(x, к));
      return р.includes(true) ? true : р.includes(null) ? null : false;
    }
    case 'not': { const р = вычислить(в.a, к); return р === null ? null : !р; }
    default: throw new Error(`неизвестная операция «${в.op}»`);
  }
}

// ─── Исполнение ───────────────────────────────────────────────────────────────

export function новоеСостояние(модель, И = индекс(модель), t0 = 0) {
  const с = { шаги: {}, значения: {}, решения: {}, визы: {}, внешние: {}, таймеры: {}, журнал: [], конец: false };
  for (const ш of модель.steps) {
    const первый = И.предки.get(ш.key).length === 0;
    с.шаги[ш.key] = { статус: первый ? 'открыт' : 'закрыт', открыт_в: первый ? t0 : null, активирован: первый, кто: null, стол: null, проходов: 0 };
  }
  return с;
}

function переоткрыть(И, с, t) {
  for (const [key, сш] of Object.entries(с.шаги)) {
    if (сш.статус !== 'закрыт' || !сш.активирован) continue;
    if (!И.предки.get(key).some((п) => с.шаги[п].статус === 'открыт')) { сш.статус = 'открыт'; сш.открыт_в = t; }
  }
}

/** Возврат на доработку: цель снова открыта, всё, что за ней вперёд, снова ждёт. */
function вернуть(И, с, цель, t) {
  const очередь = [цель], видели = new Set();
  while (очередь.length) {
    const k = очередь.shift();
    if (видели.has(k)) continue;
    видели.add(k);
    const сш = с.шаги[k];
    if (k === цель) Object.assign(сш, { статус: 'открыт', открыт_в: t, активирован: true });
    else Object.assign(сш, { статус: 'закрыт', открыт_в: null, активирован: false });
    const ш = И.шаги.get(k);
    for (const р of И.следом(ш)) if (р.step !== 'END' && И.шаги.has(р.step) && !И.назад(ш, р.step)) очередь.push(р.step);
  }
}

const адресаты = (to, к) => {
  if (!to) return [];
  if (Array.isArray(to)) return to.flatMap((x) => адресаты(x, к));
  if (typeof to === 'object' && 'field' in to) return [].concat(к.значения[to.field] ?? []).map(String);
  return [String(to)];
};

export function контекст(модель, И, с, e, t) {
  return { И, с, значения: { ...с.значения, ...(e.values || {}) }, визы: { ...с.визы, ...(e.signoffs || {}) }, t, actor: e.actor ?? null, desk: e.desk ?? null, решение: e.decision ?? null, шаг: e.step ?? null, модель };
}

/** Обязательно ли поле шага при этом событии: true · { when_decision } · { when: выражение }. */
export function нужно(пш, к) {
  const r = пш.required;
  if (r === true) return true;
  if (!r || typeof r !== 'object') return false;
  if (r.when_decision !== undefined && ![].concat(r.when_decision).includes(к.решение)) return false;
  if (r.when) return вычислить(r.when, к) === true;
  return r.when_decision !== undefined;
}

/** Срок шага: { due, to } или null. deadline_min (формат 1) или deadline — объект или список с when. */
export function срокШага(модель, И, с, ш, к) {
  const сш = с.шаги[ш.key];
  if (ш.deadline_min && сш.открыт_в != null) return { due: сш.открыт_в + ш.deadline_min, to: [модель.process?.owner_desk || ш.desk].filter(Boolean) };
  if (!ш.deadline) return null;
  for (const d of [].concat(ш.deadline)) {
    if (d.when && вычислить(d.when, к) !== true) continue;
    const от = d.from ? значение(d.from, к) : сш.открыт_в;
    if (пусто(от)) return null;
    return { due: плюс(И.кал, число(от, к), d), to: адресаты(d.to, к).length ? адресаты(d.to, к) : [модель.process?.owner_desk || ш.desk].filter(Boolean) };
  }
  return null;
}

/** Таймеры процесса, у которых вышел срок к моменту t, — сигналами в журнал. */
export function проверитьТаймеры(модель, И, с, t) {
  for (const тм of модель.timers || []) {
    const к = контекст(модель, И, с, {}, t);
    let от;
    try {
      if (тм.from?.start) от = 0;
      else if (тм.from?.step) от = с.шаги[тм.from.step]?.сделан_в ?? null;
      else if (тм.from?.opened) от = с.шаги[тм.from.opened]?.статус === 'открыт' ? с.шаги[тм.from.opened].открыт_в : null;
      else if (тм.from) от = число(значение(тм.from, к), к);
    } catch (ош) { с.журнал.push({ t: чч(t), step: тм.step || '—', итог: 'сбой модели', правило: тм.id, текст: ош.message }); continue; }
    if (от === null || от === undefined) continue;
    const ключ = `${тм.id}@${от}`;
    if (с.таймеры[ключ]) continue;
    const due = плюс(И.кал, от, тм.after);
    if (t <= due) continue;
    if (тм.until?.step) { const сш = с.шаги[тм.until.step]; if (сш?.сделан_в != null && сш.сделан_в >= от && сш.сделан_в <= due) { с.таймеры[ключ] = 'снят'; continue; } }
    else if (тм.until?.op) { try { if (вычислить(тм.until, к) === true) { с.таймеры[ключ] = 'снят'; continue; } } catch {} }
    if (тм.pause_while) { try { if (вычислить(тм.pause_while, к) === true) continue; } catch {} }
    с.таймеры[ключ] = 'сработал';
    с.журнал.push({ t: чч(due), step: тм.step || '—', desk: null, actor: 'система', итог: 'сигнал', правило: тм.id, кому: адресаты(тм.to, к).join(', '), текст: тм.text || тм.id });
  }
}

/** Одно событие: действие стола { step, desk, actor, at, values, decision, signoffs },
 *  проверка часов { tick: true, at } или внешнее событие { external: 'ID', at }. */
export function действие(модель, И, с, e) {
  const t = вМинуты(e.at, И.кал);
  проверитьТаймеры(модель, И, с, t);
  if (e.tick) return null;
  if (e.external) {
    с.внешние[e.external] = t;
    const з = { t: чч(t), step: '—', desk: null, actor: e.actor ?? null, итог: 'уведомление', правило: `внешнее:${e.external}`, текст: `внешнее событие ${e.external}` };
    с.журнал.push(з);
    переоткрыть(И, с, t);
    return з;
  }
  const запись = (итог) => { const з = { t: чч(t), step: e.step, desk: e.desk ?? null, actor: e.actor ?? null, ...итог }; с.журнал.push(з); return з; };
  const ш = И.шаги.get(e.step);
  if (!ш) return запись({ итог: 'отказ', правило: 'нет шага', текст: `шага ${e.step} нет в модели` });
  const сш = с.шаги[ш.key];
  if (сш.статус === 'сделан') return запись({ итог: 'отказ', правило: 'повтор', текст: 'шаг уже сделан' });
  if (сш.статус !== 'открыт') {
    const ждём = И.предки.get(ш.key).filter((к) => с.шаги[к].статус !== 'сделан');
    return запись({ итог: 'отказ', правило: 'порядок', текст: `шаг ещё не открыт${ждём.length ? ': не сделаны ' + ждём.join(', ') : ''}` });
  }
  if (ш.requires_external) {
    const нет = [].concat(ш.requires_external).filter((x) => с.внешние[x] === undefined);
    if (нет.length) return запись({ итог: 'отказ', правило: 'внешнее', текст: `нет внешнего события: ${нет.join(', ')}` });
  }
  if (ш.max_passes && сш.проходов >= ш.max_passes) return запись({ итог: 'отказ', правило: `повторов:${ш.key}`, текст: `шаг пройден уже ${сш.проходов} раз — больше нельзя` });
  const столы = [ш.desk, ...(ш.desks || [])].filter(Boolean);
  if (столы.length && !столы.includes(e.desk)) return запись({ итог: 'отказ', правило: 'не тот стол', текст: `шаг делает ${столы.join(' или ')}, а не ${e.desk}` });
  if (ш.decision) {
    if (пусто(e.decision)) return запись({ итог: 'отказ', правило: 'решение', текст: 'не выбрано решение' });
    if (!ш.decision.options.includes(e.decision)) return запись({ итог: 'отказ', правило: 'решение', текст: `решения «${e.decision}» нет в списке` });
  }
  const ввод = e.values || {};
  const к = контекст(модель, И, с, e, t);
  try {
    for (const пш of ш.fields || []) {
      if (пш.role !== 'пишет') continue;
      const поле = И.поля.get(пш.field);
      const з = к.значения[пш.field];
      if (нужно(пш, к) && пусто(з)) return запись({ итог: 'отказ', правило: `обязательно:${пш.field}`, текст: `не заполнено «${поле?.label || пш.field}»` });
      if (!пусто(ввод[пш.field]) && поле?.values?.length && [].concat(ввод[пш.field]).some((x) => !поле.values.includes(x))) {
        return запись({ итог: 'отказ', правило: `список:${пш.field}`, текст: `«${поле.label || пш.field}»: значения нет в списке` });
      }
      if (пш.by_desk && !пусто(ввод[пш.field])) {
        const виза = (e.signoffs || {})[пш.field];
        const можно = [].concat(пш.by_desk);
        if (!виза || !виза.desk) return запись({ итог: 'отказ', правило: `виза:${пш.field}`, текст: `«${поле?.label || пш.field}» вносит ${можно.join(' или ')} — нет визы` });
        if (!можно.includes(виза.desk)) return запись({ итог: 'отказ', правило: `виза:${пш.field}`, текст: `«${поле?.label || пш.field}» вносит ${можно.join(' или ')}, а не ${виза.desk}` });
      }
    }
  } catch (ош) {
    return запись({ итог: 'сбой модели', правило: 'обязательность', текст: ош.message });
  }

  const сигналы = [];
  for (const п of И.правила.get(ш.key)) {
    if (!п.test) continue;
    try {
      if (п.when) {
        const w = вычислить(п.when, к);
        if (w === null) return запись({ итог: 'не определено', правило: п.id, ключ: п.id, вопрос: `условие правила не определено: ${п.on_fail?.text || п.id}` });
        if (w === false) continue;
      }
      const r = вычислить(п.test, к);
      if (r === null) return запись({ итог: 'не определено', правило: п.id, ключ: п.id, вопрос: `правило молчит: ${п.on_fail?.text || п.id}` });
      if (r === false) {
        const о = п.on_fail || {};
        if ((о.outcome || 'отказ') === 'отказ') return запись({ итог: 'отказ', правило: п.id, текст: о.text || п.id });
        сигналы.push({ правило: п.id, кому: адресаты(о.to, к).join(', '), текст: о.text || п.id });
      }
    } catch (ош) {
      return запись({ итог: 'сбой модели', правило: п.id, текст: ош.message });
    }
  }
  try {
    const срок = срокШага(модель, И, с, ш, к);
    if (срок && t > срок.due) сигналы.push({ правило: `срок:${ш.key}`, кому: срок.to.join(', '), текст: `шаг просрочен на ${t - срок.due} мин` });
  } catch (ош) {
    return запись({ итог: 'сбой модели', правило: `срок:${ш.key}`, текст: ош.message });
  }

  с.значения = к.значения;
  for (const пш of ш.fields || []) if (пш.by_desk && e.signoffs?.[пш.field]) с.визы[пш.field] = { ...e.signoffs[пш.field], t };
  с.решения[ш.key] = e.decision ?? null;
  Object.assign(сш, { статус: 'сделан', кто: e.actor ?? null, стол: e.desk ?? null, сделан_в: t, проходов: сш.проходов + 1 });
  for (const р of И.следом(ш)) {
    if (!подходит(р, e.decision)) continue;
    if (р.step === 'END') { с.конец = true; continue; }
    if (И.назад(ш, р.step)) { вернуть(И, с, р.step, t); continue; }
    const цель = с.шаги[р.step];
    if (цель && цель.статус === 'закрыт') цель.активирован = true;
  }
  переоткрыть(И, с, t);
  const итог = запись(сигналы.length
    ? { итог: 'сигнал', правило: сигналы.map((x) => x.правило).join(' · '), кому: сигналы.map((x) => x.кому).filter(Boolean).join(', '), текст: сигналы.map((x) => x.текст).join('; ') }
    : { итог: 'принято' });
  for (const н of ш.notify || []) {
    if (н.when_decision !== undefined && ![].concat(н.when_decision).includes(e.decision)) continue;
    try { if (н.when && вычислить(н.when, к) !== true) continue; } catch { continue; }
    с.журнал.push({ t: чч(t), step: ш.key, desk: e.desk ?? null, actor: e.actor ?? null, итог: 'уведомление', правило: `уведомление:${ш.key}`, кому: адресаты(н.to, к).join(', '), текст: н.text || '' });
  }
  return итог;
}

/** Исполнить сценарий целиком и проверить конец. */
export function прогнать(модель, события, И = индекс(модель)) {
  const с = новоеСостояние(модель, И);
  for (const e of события) действие(модель, И, с, e);
  const концы = модель.steps.filter((ш) => !И.следом(ш).some((р) => р.step !== 'END' && !И.назад(ш, р.step)));
  const дошёл = с.конец || концы.some((ш) => с.шаги[ш.key].статус === 'сделан');
  const открытые = модель.steps.filter((ш) => с.шаги[ш.key].статус === 'открыт' && !ш.optional);
  if (!дошёл) с.журнал.push({ t: 'конец', step: '—', итог: 'отказ', правило: 'конец', текст: 'процесс не дошёл до конца' });
  else if (открытые.length) с.журнал.push({ t: 'конец', step: '—', итог: 'отказ', правило: 'конец', текст: `остались открытые шаги: ${открытые.map((ш) => ш.key).join(', ')}` });
  return { журнал: с.журнал, состояние: с };
}

/** Чем кончился сценарий: по первой проблеме; сигнал и уведомление причиной не считаются. */
export function оценить(сц, журнал) {
  const не = журнал.filter((з) => з.итог !== 'принято' && з.итог !== 'уведомление');
  const сигналы = не.filter((з) => з.итог === 'сигнал');
  const первое = не.find((з) => з.итог !== 'сигнал') || null;
  const отказ = первое?.итог === 'отказ';
  const открыто = первое?.итог === 'не определено';
  const сбой = первое?.итог === 'сбой модели';
  let вердикт;
  if (сц.ждём === 'чисто') вердикт = не.length ? 'сбой' : 'чисто';
  else if (сц.ждём === 'сигнал') вердикт = первое ? 'сбой' : сигналы.length ? 'сигнал' : 'сбой';
  else if (сц.ждём === 'сработает') {
    const есть = журнал.some((з) => String(з.правило || '').split(' · ').includes(сц.про));
    вердикт = сбой ? 'сбой' : есть ? 'поймано' : открыто ? 'не определено' : 'дыра';
  }
  else if (сц.ждём === 'поймать') вердикт = отказ ? 'поймано' : открыто ? 'не определено' : сбой ? 'сбой' : сигналы.length ? 'сигнал' : 'дыра';
  else вердикт = отказ ? 'поймано' : открыто ? 'не определено' : сбой ? 'сбой' : сигналы.length ? 'сигнал' : 'чисто';
  return { вердикт, первое, сигналы };
}
