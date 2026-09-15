// Сценарии процесса: правильные пути из модели и всё, что из них можно испортить.
//
// Сценарии не пишутся руками — выводятся по видам элементов модели (методика, этап 3):
//   путь            — каждый правильный путь модели, ждём «чисто»;
//   пропуск         — без одного шага, ждём «поймать»;
//   повтор          — шаг дважды;
//   чужой стол      — шаг делает другой стол;
//   раньше срока    — шаг раньше предшественника;
//   без поля        — не заполнено обязательное поле (в том числе обязательное по условию);
//   не из списка    — значение вне списка;
//   неполный набор  — из набора, где нужны все значения, убрано одно;
//   виза            — поле, которое вносит другой стол, без визы или с визой не того стола;
//   граница         — число или время чуть ниже, ровно, чуть выше; ждём любой определённый исход;
//   разделение      — тот же человек, что на шаге, с которым делить нельзя;
//   просрочка       — шаг позже срока; ждём, что сработает сигнал срока;
//   таймер          — после события никто не действует дольше срока; ждём сигнал таймера;
//   ветка           — вариант решения, через который не проходит ни один путь (сама по себе — проблема модели).

import { индекс, вМинуты, чч, прогнать, контекст, нужно, срокШага, плюс, новоеСостояние, действие } from './dvizhok.mjs';

const копия = (x) => JSON.parse(JSON.stringify(x));

function обойти(в, f) {
  if (!в || typeof в !== 'object') return;
  if (в.op) f(в);
  for (const x of [в.a, в.b, ...(в.args || [])]) if (x && typeof x === 'object' && x.op) обойти(x, f);
}
function сравненияСЧислом(в) {
  const out = [];
  обойти(в, (x) => {
    if (!['<', '<=', '>', '>='].includes(x.op)) return;
    const число = [x.a, x.b].find((y) => y && typeof y === 'object' && 'number' in y);
    const другое = [x.a, x.b].find((y) => y !== число);
    if (число && другое && typeof другое === 'object' && !другое.plus && ('field' in другое || ('now' in другое && другое.now !== 'abs'))) out.push({ число: число.number, по: другое });
  });
  return out;
}
const разделения = (в) => { const out = []; обойти(в, (x) => { if (x.op === 'not_same_actor') out.push(x.step); }); return out; };
const наборы = (в) => { const out = []; обойти(в, (x) => { if (x.op === 'contains_all' && x.a && 'field' in x.a && Array.isArray(x.b)) out.push({ поле: x.a.field, нужно: x.b }); }); return out; };

/** Состояние перед событием i пути — чтобы проверить условие так, как его увидит движок. */
function состояниеДо(модель, И, события, i) {
  const с = новоеСостояние(модель, И);
  for (const e of события.slice(0, i)) действие(модель, И, с, e);
  return с;
}
/** Сдвинуть события начиная с i так, чтобы i-е случилось в момент t (порядок сохраняется). */
function сдвинуть(события, i, t) {
  const нов = копия(события);
  const сдвиг = t - вМинуты(нов[i].at);
  if (сдвиг <= 0) return нов;
  for (let j = i; j < нов.length; j++) нов[j].at = чч(вМинуты(нов[j].at) + сдвиг);
  return нов;
}

export function сценарии(модель) {
  const И = индекс(модель);
  const список = [];
  const add = (группа, имя, события, ждём, про = null) => список.push({ группа, имя, события, ждём, про });
  const пути = модель.paths || [];
  пути.forEach((п) => add('путь', п.name, п.events, п.expect || 'чисто'));
  const столы = (модель.desks || []).map((d) => d.code);

  пути.forEach((путь, пи) => {
    const база = путь.events;
    const метка = пути.length > 1 ? ` · ${путь.name}` : '';
    const писали = new Set();
    const виденыШаги = new Set();
    база.forEach((e, i) => {
      if (!e.step) return;
      const ш = И.шаги.get(e.step);
      const первыйРаз = !виденыШаги.has(e.step);
      виденыШаги.add(e.step);
      if (пи === 0 && первыйРаз) {
        add('пропуск', `без шага ${e.step}${метка}`, база.filter((_, j) => j !== i), 'поймать', e.step);
        add('повтор', `${e.step} дважды${метка}`, [...база.slice(0, i + 1), { ...e, at: чч(вМинуты(e.at) + 1) }, ...база.slice(i + 1)], 'поймать', e.step);
        const чужой = столы.find((код) => код !== e.desk && код !== ш?.desk && !(ш?.desks || []).includes(код));
        if (чужой && ш?.desk) add('чужой стол', `${e.step} делает ${чужой}${метка}`, база.map((x, j) => (j === i ? { ...x, desk: чужой } : x)), 'поймать', e.step);
        const пред = база.slice(0, i).reverse().find((x) => x.step);
        if (пред && (И.предки.get(e.step) || []).includes(пред.step)) {
          const ip = база.indexOf(пред);
          const нов = копия(база);
          нов[ip] = { ...база[i], at: база[ip].at };
          нов[i] = { ...база[ip], at: база[i].at };
          add('раньше срока', `${e.step} раньше ${пред.step}${метка}`, нов, 'поймать', e.step);
        }
      }
      if (!ш) return;
      let с = null;
      const до = () => (с ||= состояниеДо(модель, И, база, i));
      for (const пш of ш.fields || []) {
        if (пш.role !== 'пишет' || !e.values || !(пш.field in e.values)) continue;
        const поле = И.поля.get(пш.field);
        let обяз = false;
        try { обяз = нужно(пш, контекст(модель, И, до(), e, вМинуты(e.at, И.кал))); } catch {}
        if (обяз && !писали.has(пш.field)) {
          const нов = копия(база);
          delete нов[i].values[пш.field];
          add('без поля', `${e.step} без «${поле?.label || пш.field}»${метка}`, нов, 'поймать', пш.field);
        }
        if (поле?.values?.length && пи === 0) {
          const нов = копия(база);
          нов[i].values[пш.field] = поле.type === 'multienum' ? ['__нет_в_списке__'] : '__нет_в_списке__';
          add('не из списка', `${e.step}: «${поле.label || пш.field}» вне списка${метка}`, нов, 'поймать', пш.field);
        }
        if (пш.by_desk && пи === 0) {
          const без = копия(база);
          if (без[i].signoffs) delete без[i].signoffs[пш.field];
          add('виза', `${e.step}: «${поле?.label || пш.field}» без визы${метка}`, без, 'поймать', `виза:${пш.field}`);
          const чужая = столы.find((код) => ![].concat(пш.by_desk).includes(код));
          if (чужая) {
            const нов = копия(база);
            нов[i].signoffs = { ...(нов[i].signoffs || {}), [пш.field]: { desk: чужая, actor: 'Чужой стол' } };
            add('виза', `${e.step}: «${поле?.label || пш.field}» визирует ${чужая}${метка}`, нов, 'поймать', `виза:${пш.field}`);
          }
        }
      }
      for (const п of И.правила.get(e.step) || []) {
        for (const { число, по } of [...сравненияСЧислом(п.test), ...сравненияСЧислом(п.when)]) {
          const ч = И.числа[число];
          if (!ч || !Number.isFinite(ч.value)) continue;
          for (const [подпись, сдвиг] of [['ниже', -1], ['ровно', 0], ['выше', 1]]) {
            const нов = копия(база);
            if ('field' in по) {
              const где = нов.slice(0, i + 1).map((x, j) => [x, j]).reverse().find(([x]) => x.values && по.field in x.values);
              if (!где || typeof где[0].values[по.field] !== 'number') continue;
              где[0].values[по.field] = ч.value + сдвиг;
            } else {
              const t = вМинуты(нов[i].at);
              нов[i].at = чч(Math.floor(t / 1440) * 1440 + ч.value + сдвиг);
            }
            add('граница', `${п.id}: ${'field' in по ? по.field : 'время'} ${подпись} ${число}${метка}`, нов, 'любой', п.id);
          }
        }
        for (const шагДелить of разделения(п.test)) {
          const тот = база.find((x) => x.step === шагДелить);
          if (!тот) continue;
          add('разделение', `${e.step} делает тот же человек, что ${шагДелить}${метка}`, база.map((x, j) => (j === i ? { ...x, actor: тот.actor } : x)), 'поймать', п.id);
        }
        for (const { поле, нужно: набор } of наборы(п.test)) {
          const где = база.slice(0, i + 1).map((x, j) => [x, j]).reverse().find(([x]) => Array.isArray(x.values?.[поле]));
          if (!где || набор.length < 1) continue;
          const нов = копия(база);
          нов[где[1]].values[поле] = нов[где[1]].values[поле].filter((x) => x !== набор[набор.length - 1]);
          add('неполный набор', `${п.id}: без «${набор[набор.length - 1]}»${метка}`, нов, 'поймать', п.id);
        }
      }
      if (i > 0 && пи === 0 && первыйРаз) {
        try {
          const сост = до();
          const срок = срокШага(модель, И, сост, ш, контекст(модель, И, сост, e, вМинуты(e.at, И.кал)));
          if (срок && Number.isFinite(срок.due) && срок.due + 1 > вМинуты(e.at)) add('просрочка', `${e.step} позже срока${метка}`, сдвинуть(база, i, срок.due + 1), 'сработает', `срок:${e.step}`);
        } catch {}
      }
      for (const к of Object.keys(e.values || {})) писали.add(к);
    });
  });

  // Таймеры: после события-начала никто не действует дольше срока.
  const путь0 = пути[0];
  if (путь0) {
    for (const тм of модель.timers || []) {
      let j = -1;
      if (тм.from?.step) j = путь0.events.findIndex((e) => e.step === тм.from.step);
      else if (тм.from?.field) j = путь0.events.findIndex((e) => e.values && тм.from.field in e.values);
      else if (!тм.from?.start && !тм.from?.opened) continue;
      if ((тм.from?.step || тм.from?.field) && j < 0) continue;
      if (тм.from?.opened) {
        j = путь0.events.findIndex((e) => e.step && И.следом(И.шаги.get(e.step) || {}).some?.((р) => р.step === тм.from.opened));
        if (j < 0 && !(И.предки.get(тм.from.opened) || []).length) j = -1; else if (j < 0) continue;
      }
      const с = состояниеДо(модель, И, путь0.events, j + 1);
      let от;
      if (тм.from?.start) от = 0;
      else if (тм.from?.step) от = с.шаги[тм.from.step]?.сделан_в;
      else if (тм.from?.opened) от = с.шаги[тм.from.opened]?.открыт_в;
      else { const v = с.значения[тм.from.field]; try { от = вМинуты(v, И.кал); } catch { от = Number(v); } }
      if (!Number.isFinite(от)) continue;
      const due = плюс(И.кал, от, тм.after);
      const tick = { tick: true, at: чч(due + 1) };
      const хвост = путь0.events.slice(j + 1);
      const события = [...путь0.events.slice(0, j + 1), tick, ...(хвост.length ? сдвинуть(хвост, 0, due + 2) : [])];
      add('таймер', `${тм.id}: никто не действует дольше срока`, события, 'сработает', тм.id);
    }
  }

  for (const ш of модель.steps) {
    if (!ш.decision) continue;
    for (const вариант of ш.decision.options) {
      const есть = пути.some((п) => п.events.some((e) => e.step === ш.key && e.decision === вариант));
      if (есть) continue;
      const путь = пути.find((п) => п.events.some((e) => e.step === ш.key));
      if (!путь) continue;
      const i = путь.events.findIndex((e) => e.step === ш.key);
      const нов = копия(путь.events.slice(0, i + 1));
      нов[i].decision = вариант;
      add('ветка', `${ш.key}: решение «${вариант}» без пути`, нов, 'любой', `ветка:${ш.key}:${вариант}`);
    }
  }
  return список;
}
