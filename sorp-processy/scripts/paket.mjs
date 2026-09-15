// Пакет процесса для агента модели: всё из карты, что касается одного процесса, в одном файле.
//
//   node paket.mjs              все процессы книги
//   node paket.mjs PROC-014     один
//
// Пишет vyhod/processy/pakety/PROC-xxx.json рабочей папки. Прежние редакции ключей
// (…_was…) выбрасываются: агенту нужна действующая карта, история — в самой карте.

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { загрузитьСтраницы } from './stranicy.mjs';
import { ВЫХОД as ВЫХОД_ПРОГОНА, карта, напрямую } from './mesto.mjs';

const чисто = (x) => {
  if (Array.isArray(x)) return x.map(чисто);
  if (!x || typeof x !== 'object') return x;
  return Object.fromEntries(Object.entries(x).filter(([k, v]) => !/_was/.test(k) && v !== null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k, v]) => [k, чисто(v)]));
};
const упоминает = (x, ключи) => { const s = JSON.stringify(x); return ключи.some((к) => s.includes(к)); };

export function пакет(м, id, страницы) {
  const книга = new Map(м.sootv_procs.rows.map((r) => [r['Ключ карты'], r]));
  const столы = new Map(м.desks.map((d) => [d.id, d]));
  const объекты = new Map(м.objs.map((o) => [o.id, o]));
  const поля = new Map(м.flds.map((f) => [f.id, f]));
  const п = м.procs.find((x) => x.id === id);
  if (!п) throw new Error(`процесса ${id} нет в карте`);
  const шаги = м.steps.filter((s) => s.p === id).sort((a, b) => a.i - b.i);
  const ключиШагов = шаги.map((s) => s.id);
  const сф = м.step_flds.filter((x) => ключиШагов.includes(x.step));
  for (const s of шаги) for (const пол of s.polya || []) if (!сф.some((x) => x.step === s.id && x.fld === пол.fld)) сф.push({ step: s.id, fld: пол.fld, role: пол.rol, art: пол.art, src: 'steps.polya' });
  const ключиПолей = [...new Set(сф.map((x) => x.fld))];
  const полейКарты = ключиПолей.map((k) => поля.get(k)).filter(Boolean);
  const lpd = м.lpd.filter((x) => x.p === id);
  const ключиСтолов = [...new Set([...шаги.map((s) => s.x), ...lpd.map((x) => x.d)].filter((k) => k && столы.has(k)))];
  const ключиОбъектов = [...new Set([...полейКарты.map((f) => f.o), ...м.objs.filter((o) => упоминает(o, [id])).map((o) => o.id)].filter(Boolean))];
  const признаки = [id, ...ключиШагов];
  const признакиЗохо = [id, ...ключиШагов, ...ключиОбъектов];
  const zoho = Object.fromEntries((м.zoho?.listy || []).map((л) => [л.name, { kolonki: л.kolonki, rows: (л.rows || []).filter((r) => упоминает(r, признакиЗохо)) }]).filter(([, v]) => v.rows.length));
  const стр = страницы ? страницы.дляПроцесса(п) : null;
  return чисто({
    ред_карты: typeof м.version === 'string' ? м.version : null,
    процесс: п,
    книга: книга.get(id) || null,
    шаги,
    поля_шагов: сф,
    поля: полейКарты,
    объекты: ключиОбъектов.map((k) => объекты.get(k)).filter(Boolean).map((o) => ({ id: o.id, tn: o.tn, n: o.n, dom: o.dom, mod: o.mod, mod_status: o.mod_status, src: o.src })),
    столы: ключиСтолов.map((k) => { const d = столы.get(k); return { id: d.id, name: d.name, hname: d.hname, unit: d.un, type: d.type, fields: d.fields }; }),
    роли_столов: lpd,
    входы_выходы: м.lpp.filter((x) => x.p === id),
    артефакты: м.art.filter((a) => (a.proc || []).includes(id)).map((a) => ({ key: a.key, name: a.name, kind: a.kind, steps: a.steps, in: a.in, out: a.out, desk_d: a.desk_d })),
    решения: м.decisions.filter((d) => упоминает(d, признаки)),
    требования_ук: (м.uk || []).filter((u) => u.proc === id || упоминает(u.steps || [], ключиШагов)).map((u) => ({ kod: u.kod, text: u.text, status: u.status, dec: u.dec, steps: u.steps, desk: u.desk, obj: u.obj, flds: u.flds, rec: u.rec, gate: u.gate, gate_code: u.gate_code })),
    гейты_ук: (м.uk_gates || []).filter((g) => ключиШагов.includes(g.step)),
    справочники: (м.spravochniki || []).filter((s) => упоминает(s, [...ключиПолей, ...ключиОбъектов, id])),
    назначения: (м.naznacheniya || []).filter((n) => ключиСтолов.includes(n.desk)),
    вопросы_владельцу: (м.voprosy_vladelcu?.temy || []).filter((t) => упоминает(t, признаки)),
    zoho,
    страницы: стр,
  });
}

export function главная(argv = process.argv.slice(2)) {
  const [один] = argv;
  const м = карта();
  let страницы = null;
  try { страницы = загрузитьСтраницы(); } catch (e) { console.error('презентации не загрузились:', e.message); }
  const КУДА = path.join(ВЫХОД_ПРОГОНА, 'pakety');
  mkdirSync(КУДА, { recursive: true });
  const иды = один ? [один] : [...new Set(м.sootv_procs.rows.map((r) => r['Ключ карты']).concat(м.procs.map((p) => p.id)))];
  for (const id of иды) {
    if (!м.steps.some((s) => s.p === id)) { console.log(`${id}: шагов нет — пропущен`); continue; }
    const п = пакет(м, id, страницы);
    const s = JSON.stringify(п, null, 1);
    writeFileSync(path.join(КУДА, `${id}.json`), s);
    console.log(`${id}: шагов ${п.шаги.length} · полей ${(п.поля || []).length} · решений ${(п.решения || []).length} · zoho ${Object.values(п.zoho || {}).reduce((a, v) => a + v.rows.length, 0)} · ${Math.round(s.length / 1024)} КБ`);
  }
}

if (напрямую(import.meta.url)) главная();
