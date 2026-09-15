// План заведения записей и полей по системам — из моделей процессов.
//
//   node plan-zoho.mjs
//
// Ничего не пишет в Zoho. Собирает, что где заводить: запись живёт в системе, названной
// картой (objs[].dom → records[].home), поле — в модуле своей записи. Одна запись нужна
// нескольким процессам — в плане она одна, с перечнем процессов и объединением полей.
// Расхождения между моделями (тип поля, список значений, система записи) — отдельным
// перечнем: заводить поле, пока модели спорят, нельзя.
//
// Выход: vyhod/processy/plan-zoho.json и краткая сводка в консоль.

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { МОДЕЛИ, ВЫХОД, напрямую } from './mesto.mjs';

// Тип поля модели → тип поля в Zoho (имена типов API CRM; Creator и Books берут ближайший свой).
const ТИП = { text: 'text', number: 'integer', money: 'currency', percent: 'percent', date: 'date', datetime: 'datetime', bool: 'boolean', enum: 'picklist', multienum: 'multiselectpicklist', ref: 'lookup', file: 'fileupload', user: 'userlookup', table: 'subform' };

export function главная() {
  const записи = new Map();
  const споры = [];
  const спор = (что, где, a, b) => споры.push({ что, где, было: a, стало: b });

  for (const ф of readdirSync(МОДЕЛИ).filter((f) => /^PROC-\d{3}\.json$/.test(f)).sort()) {
    const м = JSON.parse(readFileSync(path.join(МОДЕЛИ, ф), 'utf8'));
    const proc = м.process.id;
    const пишутНаШаге = new Map();
    for (const ш of м.steps) for (const п of ш.fields || []) if (п.role === 'пишет') (пишутНаШаге.get(п.field) || пишутНаШаге.set(п.field, []).get(п.field)).push(ш.key);
    for (const r of м.records || []) {
      const ключ = r.object || `${proc}:${r.key}`;
      const з = записи.get(ключ) || { object: r.object || null, title: r.title, home: r.home, module: r.module || null, процессы: [], поля: new Map() };
      if (з.home !== r.home) спор('система записи', ключ, `${з.home} (${з.процессы.join(', ')})`, `${r.home} (${proc})`);
      if (r.module && з.module && з.module !== r.module) спор('модуль записи', ключ, з.module, r.module);
      з.module ||= r.module || null;
      з.процессы.push(proc);
      for (const f of м.fields.filter((x) => x.record === r.key)) {
        const фк = f.id || f.label;
        const было = з.поля.get(фк);
        const тип = ТИП[f.type] || 'text';
        if (было) {
          if (было.тип !== тип) спор('тип поля', `${ключ} · ${f.label}`, `${было.тип} (${было.процессы.join(', ')})`, `${тип} (${proc})`);
          const а = JSON.stringify([...(было.значения || [])].sort()), б = JSON.stringify([...(f.values || [])].sort());
          if (f.values?.length && было.значения?.length && а !== б) спор('список значений', `${ключ} · ${f.label}`, было.значения.join(' | '), f.values.join(' | '));
          было.процессы.push(proc);
          было.шаги.push(...(пишутНаШаге.get(f.key) || []));
          if (!было.значения?.length && f.values?.length) было.значения = f.values;
        } else {
          з.поля.set(фк, { id: f.id || null, подпись: f.label, тип, значения: f.values || null, процессы: [proc], шаги: [...(пишутНаШаге.get(f.key) || [])], основание: f.source || null });
        }
      }
      записи.set(ключ, з);
    }
  }

  const поСистемам = {};
  for (const з of записи.values()) (поСистемам[з.home || 'не указана'] ||= []).push({ ...з, поля: [...з.поля.values()] });
  mkdirSync(ВЫХОД, { recursive: true });
  writeFileSync(path.join(ВЫХОД, 'plan-zoho.json'), JSON.stringify({ системы: поСистемам, споры }, null, 1));
  for (const [система, список] of Object.entries(поСистемам)) {
    console.log(`${система}: записей ${список.length}, полей ${список.reduce((a, з) => a + з.поля.length, 0)}, без модуля ${список.filter((з) => !з.module).length}`);
  }
  console.log(`споров между моделями: ${споры.length}`);
}

if (напрямую(import.meta.url)) главная();
