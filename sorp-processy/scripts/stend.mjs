// Вопросы и ответы на стенде SORP — из Claude Code, для людей из любой организации.
//
//   node stend.mjs vhod <ключ>                 запомнить ключ (проверяется у стенда)
//   node stend.mjs vhod                        кто вошёл
//   node stend.mjs registraciya "Имя" [код]    получить ключ, если стенд пускает
//   node stend.mjs voprosy [PROC-xxx] [--vse]  открытые вопросы (JSON)
//   node stend.mjs otvet <ключ вопроса> <номер варианта|-1> ["комментарий"]
//   node stend.mjs vylozhit PROC-xxx …         вопросы моделей → стенд (из vyhod/processy/voprosy)
//   node stend.mjs otvety [PROC-xxx]           новые ответы, ждущие внесения (JSON)
//   node stend.mjs vnesen <id ответа> "что изменилось в модели"
//   node stend.mjs otklonen <id ответа> "почему не внесён"
//   node stend.mjs k-obrabotke                 процессы с новыми ответами, над которыми никто не работает (JSON)
//   node stend.mjs zanyat PROC-xxx [кто]       отметить: над моделью работают (агент или внесение ответов)
//   node stend.mjs osvobodit PROC-xxx          снять отметку
//
// Отметка «занято» — файл vyhod/processy/zanyato/PROC-xxx.json в рабочей папке. Два правщика
// одной модели затирают друг друга, поэтому внесение ответов обходит занятые процессы.
// Отметка старше ЗАНЯТО_ЧАСОВ считается брошенной: агент мог упасть, не сняв её.
//
// Ключ — в ~/.sorp-processy/klyuch.json; если его нет, берётся ключ билдера или разбора
// на этой машине: один человек — один участник стенда.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ВЫХОД, МОДЕЛИ, напрямую } from './mesto.mjs';

export const СТЕНД = (process.env.SORP_API_URL || 'https://workflow-builder-934054964.development.catalystserverless.com/server/builder_api').replace(/\/$/, '');
const ГНЕЗДО = path.join(homedir(), '.sorp-processy', 'klyuch.json');
const ЧУЖИЕ = [path.join(homedir(), '.sorp-builder', 'klyuch.json'), path.join(homedir(), '.sorp-svod', 'nastroyki.json')];

export function ключ() {
  if (process.env.SORP_KEY) return process.env.SORP_KEY;
  for (const ф of [ГНЕЗДО, ...ЧУЖИЕ]) {
    if (!existsSync(ф)) continue;
    try { const с = JSON.parse(readFileSync(ф, 'utf8')); const k = с.ключ || с.key; if (k) return k; } catch {}
  }
  return null;
}

async function api(путь, { метод = 'GET', тело, безКлюча = false } = {}) {
  const k = безКлюча ? null : ключ();
  if (!безКлюча && !k) throw new Error('ключа нет: войдите — node stend.mjs vhod <ключ> или registraciya "Имя"');
  const сторож = new AbortController();
  const будильник = setTimeout(() => сторож.abort(), 30000);
  try {
    const о = await fetch(СТЕНД + путь, { method: метод, signal: сторож.signal, headers: { 'Content-Type': 'application/json', ...(k ? { 'X-Builder-Key': k } : {}) }, body: тело ? JSON.stringify(тело) : undefined });
    let т = null; try { т = await о.json(); } catch {}
    if (!о.ok) throw new Error(`${т?.ошибка || `стенд ответил ${о.status}`}${т?.как_быть ? ` — ${т.как_быть}` : ''}`);
    return т;
  } finally { clearTimeout(будильник); }
}
const печать = (x) => console.log(JSON.stringify(x, null, 1));

const ЗАНЯТО = path.join(ВЫХОД, 'zanyato');
const ЗАНЯТО_ЧАСОВ = 3;
/** Отметка «над моделью работают» — или null, если её нет или она брошена. */
export function занят(proc) {
  const ф = path.join(ЗАНЯТО, `${proc}.json`);
  if (!existsSync(ф)) return null;
  try {
    const з = JSON.parse(readFileSync(ф, 'utf8'));
    return Date.now() - new Date(з.с).getTime() > ЗАНЯТО_ЧАСОВ * 3600_000 ? null : з;
  } catch { return null; }
}

export async function главная(argv = process.argv.slice(2)) {
  const [команда, ...арг] = argv;
  switch (команда) {
    case 'vhod': {
      if (!арг[0]) { const k = ключ(); if (!k) return console.log('не вошли'); const я = await api('/whoami'); return console.log(`${я.имя} · ${я.роль}`); }
      const k = арг[0].trim();
      if (!/^[\x21-\x7E]+$/.test(k)) throw new Error('в ключе лишние символы — скопируйте его заново');
      process.env.SORP_KEY = k;
      const я = await api('/whoami');
      mkdirSync(path.dirname(ГНЕЗДО), { recursive: true });
      writeFileSync(ГНЕЗДО, JSON.stringify({ ключ: k, имя: я.имя, роль: я.роль, записан: new Date().toISOString() }, null, 2), { mode: 0o600 });
      return console.log(`Вошли: ${я.имя} · ${я.роль}`);
    }
    case 'registraciya': {
      const т = await api('/register', { метод: 'POST', тело: { name: арг[0], invite: арг[1] }, безКлюча: true });
      mkdirSync(path.dirname(ГНЕЗДО), { recursive: true });
      writeFileSync(ГНЕЗДО, JSON.stringify({ ключ: т.ключ, имя: т.имя, роль: т.роль, записан: new Date().toISOString() }, null, 2), { mode: 0o600 });
      return console.log(`Ключ выписан: ${т.ключ}\nИмя: ${т.имя} · ${т.роль}\nСохраните ключ — он показан один раз. Им же входят в форму на стенде.`);
    }
    case 'voprosy': {
      const proc = арг.find((a) => /^PROC-\d{3}$/.test(a));
      const т = await api(`/questions?${new URLSearchParams({ ...(proc ? { proc } : {}), ...(арг.includes('--vse') ? { state: 'all' } : {}) })}`);
      return печать({ кто: т.кто, вопросов: т.вопросы.length, вопросы: т.вопросы.map((q) => ({ key: q.q_key, proc: q.proc_id, процесс: q.proc_title, состояние: q.state, блокирует: q.blocks, вопрос: q.question, варианты: q.options, где_искали: q.searched, заметка: q.note || null, мой_ответ: q.мой_ответ })) });
    }
    case 'otvet': {
      const [k, выбор, ...коммент] = арг;
      const т = await api(`/questions/${encodeURIComponent(k)}/answer`, { метод: 'POST', тело: { choice: Number(выбор), comment: коммент.join(' '), channel: 'плагин' } });
      return console.log(`Записано на стенд: ${т.кто}, вопрос ${т.вопрос} — ${т.состояние_вопроса}`);
    }
    case 'vylozhit': {
      if (!арг.length) throw new Error('назовите процессы: vylozhit PROC-012 PROC-014');
      for (const proc of арг) {
        const файл = path.join(ВЫХОД, 'voprosy', `${proc}.json`);
        if (!existsSync(файл)) { console.log(`${proc}: нет ${файл} — сначала voprosy.mjs ${proc}`); continue; }
        const д = JSON.parse(readFileSync(файл, 'utf8'));
        const т = await api('/questions/sync', { метод: 'POST', тело: { proc, title: д.title, questions: д.questions } });
        console.log(`${proc}: новых ${т.новых} · обновлено ${т.обновлено} · снято ${т.снято}${т.пропущено ? ` · пропущено ${т.пропущено}` : ''}`);
      }
      return;
    }
    case 'otvety': {
      const proc = арг.find((a) => /^PROC-\d{3}$/.test(a));
      const т = await api(`/answers?${new URLSearchParams(proc ? { proc } : {})}`);
      return печать({ ответов: т.ответы.length, ответы: т.ответы });
    }
    case 'vnesen': case 'otklonen': {
      const [id, ...заметка] = арг;
      const т = await api(`/answers/${encodeURIComponent(id)}/${команда === 'vnesen' ? 'applied' : 'rejected'}`, { метод: 'POST', тело: { note: заметка.join(' ') } });
      return console.log(`Ответ ${т.ответ}: ${т.состояние}; вопрос — ${т.состояние_вопроса}`);
    }
    case 'zanyat': {
      const [proc, ...кто] = арг;
      if (!/^PROC-\d{3}$/.test(proc || '')) throw new Error('zanyat PROC-xxx');
      mkdirSync(ЗАНЯТО, { recursive: true });
      writeFileSync(path.join(ЗАНЯТО, `${proc}.json`), JSON.stringify({ proc, кто: кто.join(' ') || 'без имени', с: new Date().toISOString() }, null, 1));
      return console.log(`${proc}: занято`);
    }
    case 'osvobodit': {
      const [proc] = арг;
      const ф = path.join(ЗАНЯТО, `${proc}.json`);
      if (existsSync(ф)) rmSync(ф);
      return console.log(`${proc}: свободно`);
    }
    case 'k-obrabotke': {
      const т = await api('/answers');
      const поПроцессам = new Map();
      for (const о of т.ответы) {
        const п = поПроцессам.get(о.proc_id) || { proc: о.proc_id, ответов: 0, споров: new Set(), вопросов: new Set() };
        п.ответов++;
        п.вопросов.add(о.q_key);
        if (о.вопрос?.state === 'спор') п.споров.add(о.q_key);
        поПроцессам.set(о.proc_id, п);
      }
      const есть = (proc) => existsSync(path.join(МОДЕЛИ, `${proc}.json`));
      const итог = { свободны: [], заняты: [], нет_модели: [] };
      for (const п of [...поПроцессам.values()].sort((a, b) => a.proc.localeCompare(b.proc))) {
        const строка = { proc: п.proc, ответов: п.ответов, вопросов: п.вопросов.size, споров: п.споров.size };
        const з = занят(п.proc);
        if (!есть(п.proc)) итог.нет_модели.push(строка);
        else if (з) итог.заняты.push({ ...строка, кто: з.кто, с: з.с });
        else итог.свободны.push(строка);
      }
      return печать(итог);
    }
    default:
      console.log('Команды: vhod · registraciya · voprosy · otvet · vylozhit · otvety · vnesen · otklonen · k-obrabotke · zanyat · osvobodit');
  }
}

if (напрямую(import.meta.url)) главная().catch((е) => { console.error(е.message); process.exit(1); });
