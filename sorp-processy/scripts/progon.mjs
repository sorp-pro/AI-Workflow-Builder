// Прогон моделей процессов по всем выведенным сценариям.
//
//   node progon.mjs              все модели modeli/processy/*.json рабочей папки
//   node progon.mjs PROC-014     одна модель, подробно
//   node progon.mjs PROC-014 --json   итог одной модели JSON-ом в stdout
//
// Итог каждой модели — vyhod/processy/<PROC>.progon.json, сводка — vyhod/processy/svodka.json.
// Модель «логика готова», когда: проверка без ошибок, путей не меньше одного, дыр 0,
// сбоев 0, неопределённостей 0 и у каждого варианта решения есть путь.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { индекс, прогнать, оценить } from './dvizhok.mjs';
import { сценарии } from './scenarii.mjs';
import { проверить } from './proverka-modeli.mjs';
import { МОДЕЛИ as ПАПКА, ВЫХОД, напрямую } from './mesto.mjs';

export function прогнатьМодель(модель) {
  const проверка = проверить(модель);
  const итог = { proc: модель.process?.id, title: модель.process?.title, проверка, сценариев: 0, поГруппам: {}, дыры: [], неопределено: [], сбои: [], ветки: [], непокрытые: [], текстом: [], вопросов: (модель.questions || []).length, блокирующих: (модель.questions || []).filter((q) => q.blocks).length, итоги: [] };
  if (проверка.ошибки.length) { итог.готово = false; return итог; }
  const И = индекс(модель);
  const сц = сценарии(модель);
  итог.сценариев = сц.length;
  const сработали = new Set();
  for (const с of сц) {
    const { журнал } = прогнать(модель, с.события, И);
    const о = оценить(с, журнал);
    for (const з of журнал) if (з.итог === 'отказ' || з.итог === 'сигнал' || з.итог === 'не определено') for (const r of String(з.правило || '').split(' · ')) сработали.add(r);
    const г = (итог.поГруппам[с.группа] ||= { всего: 0 });
    г.всего++;
    г[о.вердикт] = (г[о.вердикт] || 0) + 1;
    if (о.вердикт === 'дыра') итог.дыры.push(с.имя);
    if (о.вердикт === 'не определено') итог.неопределено.push({ сценарий: с.имя, правило: о.первое?.правило, вопрос: о.первое?.вопрос });
    if (о.вердикт === 'сбой') итог.сбои.push({ сценарий: с.имя, первое: о.первое });
    if (с.группа === 'ветка') итог.ветки.push(с.про);
    итог.итоги.push({ группа: с.группа, сценарий: с.имя, ждём: с.ждём, вердикт: о.вердикт, первое: о.первое ? { t: о.первое.t, step: о.первое.step, итог: о.первое.итог, правило: о.первое.правило, текст: о.первое.текст || о.первое.вопрос } : null });
  }
  for (const r of модель.rules) {
    if (r.kind === 'текст') итог.текстом.push(r.id);
    else if (!сработали.has(r.id)) итог.непокрытые.push(r.id);
  }
  итог.готово = !итог.дыры.length && !итог.сбои.length && !итог.неопределено.length && !итог.ветки.length && (модель.paths || []).length > 0;
  return итог;
}

export function главная(argv = process.argv.slice(2)) {
  const [один, флаг] = argv;
  if (!existsSync(ПАПКА)) { console.error(`Моделей нет: ${ПАПКА}`); process.exit(1); }
  const файлы = readdirSync(ПАПКА).filter((f) => /^PROC-\d{3}\.json$/.test(f) && (!один || f === `${один}.json`));
  if (один && !файлы.length) { console.error(`Модели ${один} нет.`); process.exit(1); }
  mkdirSync(ВЫХОД, { recursive: true });
  const сводка = [];
  for (const ф of файлы) {
    let модель;
    try { модель = JSON.parse(readFileSync(path.join(ПАПКА, ф), 'utf8')); } catch (e) { сводка.push({ proc: ф.replace('.json', ''), ошибка: `JSON не читается: ${e.message}` }); continue; }
    const итог = прогнатьМодель(модель);
    writeFileSync(path.join(ВЫХОД, ф.replace('.json', '.progon.json')), JSON.stringify(итог, null, 2));
    const { итоги, ...кратко } = итог;
    сводка.push({ ...кратко, проверка: { ошибок: итог.проверка.ошибки.length, предупреждений: итог.проверка.предупреждения.length } });
    if (один && флаг === '--json') { process.stdout.write(JSON.stringify(итог, null, 2)); return; }
    if (один) {
      console.log(`${итог.proc} · ${итог.title}`);
      console.log(`Проверка модели: ошибок ${итог.проверка.ошибки.length}, предупреждений ${итог.проверка.предупреждения.length}`);
      for (const т of итог.проверка.ошибки) console.log(`  ✗ ${т}`);
      for (const т of итог.проверка.предупреждения.slice(0, 30)) console.log(`  · ${т}`);
      console.log(`Сценариев: ${итог.сценариев}`);
      for (const [г, в] of Object.entries(итог.поГруппам)) console.log(`  ${г.padEnd(14)} ${JSON.stringify(в)}`);
      console.log(`Дыр: ${итог.дыры.length}${итог.дыры.length ? '\n  ' + итог.дыры.join('\n  ') : ''}`);
      console.log(`Не определено: ${итог.неопределено.length}${итог.неопределено.length ? '\n  ' + итог.неопределено.map((x) => `${x.правило}: ${x.вопрос} (${x.сценарий})`).join('\n  ') : ''}`);
      console.log(`Сбоев: ${итог.сбои.length}${итог.сбои.length ? '\n  ' + итог.сбои.map((x) => `${x.сценарий}: ${JSON.stringify(x.первое)}`).join('\n  ') : ''}`);
      console.log(`Решения без пути: ${итог.ветки.length ? итог.ветки.join(', ') : 0}`);
      console.log(`Правила, до которых не дошёл ни один сценарий: ${итог.непокрытые.length ? итог.непокрытые.join(', ') : 0}`);
      console.log(`Правила текстом (движок не проверяет): ${итог.текстом.length ? итог.текстом.join(', ') : 0}`);
      console.log(`Вопросов: ${итог.вопросов} (блокирующих ${итог.блокирующих})`);
      console.log(`Логика готова: ${итог.готово ? 'да' : 'нет'}`);
    }
  }
  if (!один) {
    writeFileSync(path.join(ВЫХОД, 'svodka.json'), JSON.stringify({ моделей: сводка.length, сводка }, null, 2));
    for (const с of сводка) console.log(`${String(с.proc).padEnd(9)} ${с.ошибка ? 'ОШИБКА ' + с.ошибка : `ошибок ${с.проверка.ошибок} · сценариев ${с.сценариев} · дыр ${с.дыры.length} · неопр ${с.неопределено.length} · сбоев ${с.сбои.length} · ветки ${с.ветки.length} · непокрыто ${с.непокрытые.length} · текстом ${с.текстом.length} · вопросов ${с.вопросов} · ${с.готово ? 'готово' : 'не готово'}`}`);
  }
}

if (напрямую(import.meta.url)) главная();
