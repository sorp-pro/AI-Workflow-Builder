// Вопросы из моделей процессов — документы для страницы вопросов.
//
//   node voprosy.mjs [PROC-xxx …]
//
// Пишет vyhod/processy/voprosy/PROC-xxx.json (один документ на процесс, коллекция
// «processy» страницы) и перечень записей batch.json для write_db — только по
// названным процессам, без аргументов по всем. Ответы страница кладёт в коллекцию
// «otvety» под ключом PROC-xxx__<отпечаток id вопроса> — тот же отпечаток считает
// otvetKlyuch здесь и на странице (shablony/voprosy.html).
//
// Когда вопрос появился впервые, помнит vyhod/processy/voprosy/pervye.json: по этой
// дате страница отмечает новые вопросы, пришедшие, пока человек отвечал на старые.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { МОДЕЛИ, ВЫХОД as ВЫХОД_ПРОГОНА, КАРТА, напрямую } from './mesto.mjs';

export const отпечаток = (s) => { let h = 5381; for (const c of String(s)) h = ((h * 33) ^ c.codePointAt(0)) >>> 0; return h.toString(36); };
export const otvetKlyuch = (proc, qid) => `${proc}__${отпечаток(qid)}`;

export function главная(argv = process.argv.slice(2)) {
  const ВЫХОД = path.join(ВЫХОД_ПРОГОНА, 'voprosy');
  const ПЕРВЫЕ = path.join(ВЫХОД, 'pervye.json');
  // Книга процессов карты даёт код команды и категорию; без карты страница обойдётся моделью.
  let книга = new Map();
  try { книга = new Map(JSON.parse(readFileSync(КАРТА, 'utf8')).sootv_procs.rows.map((r) => [r['Ключ карты'], r])); } catch {}
  mkdirSync(ВЫХОД, { recursive: true });
  const первые = existsSync(ПЕРВЫЕ) ? JSON.parse(readFileSync(ПЕРВЫЕ, 'utf8')) : {};
  const сейчас = new Date().toISOString();
  const только = new Set(argv);
  const batch = [];
  let всего = 0, новых = 0;
  for (const ф of readdirSync(МОДЕЛИ).filter((f) => /^PROC-\d{3}\.json$/.test(f)).sort()) {
    if (только.size && !только.has(ф.replace('.json', ''))) continue;
    let м;
    try { м = JSON.parse(readFileSync(path.join(МОДЕЛИ, ф), 'utf8')); } catch { console.log(`${ф}: JSON пока не читается — пропущен`); continue; }
    const id = м.process?.id || ф.replace('.json', '');
    const r = книга.get(id) || {};
    let прогон = null;
    try { прогон = JSON.parse(readFileSync(path.join(ВЫХОД_ПРОГОНА, `${id}.progon.json`), 'utf8')); } catch {}
    const док = {
      id, kod: м.process?.ref || r['Код команды'] || '', title: м.process?.title || r['Имя в карте'] || id, kat: r['Категория команды'] || '',
      edition: м.process?.map_edition || '', gotovo: прогон ? !!прогон.готово : null,
      dyry: прогон ? прогон.дыры.length : null, updated: сейчас,
      questions: (м.questions || []).filter((q) => q && q.id && q.question).map((q) => {
        const key = otvetKlyuch(id, q.id);
        if (!первые[key]) { первые[key] = сейчас; новых++; }
        return {
          id: q.id, key, added: первые[key], question: q.question, ask: q.ask || '', blocks: !!q.blocks,
          searched: q.searched || '', address: q.address ? `${q.address.kind} ${q.address.id}` : '',
          options: (q.options || []).map((o) => ({ text: o.text, why: o.why || '', recommended: !!o.recommended })),
        };
      }),
    };
    всего += док.questions.length;
    const файл = path.join(ВЫХОД, `${id}.json`);
    writeFileSync(файл, JSON.stringify(док, null, 1));
    batch.push({ op: 'set', collection: 'processy', doc_id: id, file_path: файл });
  }
  writeFileSync(ПЕРВЫЕ, JSON.stringify(первые, null, 1));
  writeFileSync(path.join(ВЫХОД, 'batch.json'), JSON.stringify(batch, null, 1));
  console.log(`процессов ${batch.length} · вопросов ${всего} · новых ${новых}`);
  console.log(`перечень записей для страницы: ${path.join(ВЫХОД, 'batch.json')}`);
}

if (напрямую(import.meta.url)) главная();
