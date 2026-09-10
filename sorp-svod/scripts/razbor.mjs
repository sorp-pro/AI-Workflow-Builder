#!/usr/bin/env node
// Вопросы разбора и ответы на них.
//
//   node scripts/razbor.mjs                        сколько чего осталось
//   node scripts/razbor.mjs --вопросы [сколько]    следующие места нехватки
//   node scripts/razbor.mjs --да НОМЕР             предложенное подходит
//   node scripts/razbor.mjs --нет НОМЕР "чем"      не подходит, и вот чем
//   node scripts/razbor.mjs --источник "о чём"     что говорят первоисточники
//   node scripts/razbor.mjs --источники            какие первоисточники есть
//   node scripts/razbor.mjs --обновить-источники   забрать их с Google Drive заново
//
// ── Почему вопросы приходят со стенда, а не из файла ─────────────────────────
// Файл разбора нужно кому-то передать, а потом передать ещё раз, когда реестр
// сдвинулся. Через неделю у пятерых участников пять разных файлов, и ответы на
// вопросы, которых больше нет, приходят вперемешку с ответами на нынешние.
// Стенд знает, что сейчас не заполнено, — и отвечают ему же, сразу.

import { прочитать } from '../hooks/nastroyki.mjs';
import { позвать } from '../hooks/stend.mjs';

const доводы = process.argv.slice(2);
const значение = (и) => {
  const к = доводы.indexOf(и);
  return к === -1 ? null : доводы[к + 1];
};

const н = прочитать();
if (!н.ключ) {
  console.error('Сначала назовитесь: скажите Claude своё имя, ключ выпишется сам.');
  process.exit(1);
}

async function главное() {
  // ---------- ответы ----------

  const да = значение('--да');
  const нет = значение('--нет');

  if (да || нет) {
    const номер = да || нет;
    if (!/^\d+$/.test(номер)) {
      console.error('Номер места нехватки — только цифры, как их напечатал --вопросы.');
      return 1;
    }
    const чем = нет ? доводы[доводы.indexOf('--нет') + 2] : null;
    if (нет && !чем) {
      console.error('Скажите, чем не подходит: node scripts/razbor.mjs --нет НОМЕР "чем именно"');
      console.error('Отказ без причины бесполезен — на следующем прогоне движок предложит то же самое.');
      return 1;
    }
    const о = await позвать(`/registry/gaps/${номер}/decide`, {
      ключ: н.ключ,
      метод: 'POST',
      тело: да ? { decision: 'подтверждено' } : { decision: 'отклонено', note: чем },
    });
    if (!о.вышло) {
      console.error(`Не записалось: ${о.тело.ошибка ?? о.почему ?? о.код}`);
      return 1;
    }
    console.log(да ? `${номер}: подтверждено` : `${номер}: отклонено — ${чем}`);
    return 0;
  }

  // ---------- первоисточники ----------

  const запросИсточника = значение('--источник');
  if (запросИсточника) {
    const о = await позвать(`/sources/search?q=${encodeURIComponent(запросИсточника)}&limit=3`, { ключ: н.ключ });
    if (!о.вышло) {
      console.error(`Не вышло: ${о.тело.ошибка ?? о.почему ?? о.код}`);
      return 1;
    }
    if (!о.тело.частей_всего) {
      console.log('Первоисточников на стенде пока нет — папка с Google Drive не подключена.');
      return 0;
    }
    if (!о.тело.нашлось.length) {
      console.log(`В первоисточниках об этом ничего не нашлось (просмотрено частей: ${о.тело.частей_всего}).`);
      return 0;
    }
    for (const н2 of о.тело.нашлось) {
      console.log(`\n■ ${н2.файл} — ${н2.где}`);
      if (н2.ссылка) console.log(`  ${н2.ссылка}`);
      console.log(`  совпало: ${н2.совпало.join(', ')}`);
      console.log(н2.отрывок.split('\n').map((с) => '  │ ' + с).join('\n'));
    }
    console.log('');
    return 0;
  }

  if (доводы.includes('--источники')) {
    const о = await позвать('/sources', { ключ: н.ключ });
    if (!о.вышло) {
      console.error(`Не вышло: ${о.тело.ошибка ?? о.почему ?? о.код}`);
      return 1;
    }
    console.log(`Папка на Google Drive: ${о.тело.папка ?? 'не задана'}`);
    if (о.тело.служебный_адрес) console.log(`Расшарена должна быть на: ${о.тело.служебный_адрес}`);
    for (const ф of о.тело.файлы) console.log(`  ${ф.вид.padEnd(12)} ${ф.файл} — частей: ${ф.частей}`);
    if (!о.тело.файлы.length) console.log('Первоисточников пока нет.');
    return 0;
  }

  if (доводы.includes('--обновить-источники')) {
    const о = await позвать('/sources/sync', { ключ: н.ключ, метод: 'POST', ждать: 60000 });
    if (!о.вышло) {
      console.error(`Не вышло: ${о.тело.ошибка ?? о.почему ?? о.код}`);
      if (о.тело.служебный_адрес) console.error(`Папку нужно расшарить на: ${о.тело.служебный_адрес}`);
      return 1;
    }
    const т = о.тело;
    console.log(`Файлов в папке: ${т.файлов}`);
    for (const с of т.обновлено) console.log(`  обновлён   ${с}`);
    for (const с of т.без_изменений) console.log(`  без изменений  ${с}`);
    for (const с of т.пропущено) console.log(`  пропущен   ${с}`);
    for (const с of т.ошибки) console.log(`  ОШИБКА     ${с}`);
    if (т.удалено.length) console.log(`  убрано исчезнувших файлов: ${т.удалено.length}`);
    return т.ошибки.length ? 1 : 0;
  }

  // ---------- вопросы ----------

  if (доводы.includes('--вопросы')) {
    const сколько = Number(значение('--вопросы')) || 5;
    const о = await позвать(`/registry/gaps?limit=${сколько}`, { ключ: н.ключ });
    if (!о.вышло) {
      console.error(`Не вышло: ${о.тело.ошибка ?? о.почему ?? о.код}`);
      return 1;
    }
    const места = о.тело.нехватка || [];
    if (!места.length) {
      console.log('Незакрытых мест нет.');
      return 0;
    }
    for (const м of места) {
      console.log(`\n[${м.ROWID}] ${м.ent_key}${м.parent_key ? ` в ${м.parent_key}` : ''} — ${м.what}`);
      if (м.title) console.log(`  что это: ${м.title}`);
      if (м.reason) console.log(`  чего не хватает: ${м.reason}`);
      if (м.rec_text) {
        console.log(`  предлагается: ${м.rec_text}  (${м.rec_ground})`);
        if (м.rec_basis) console.log(`  почему так: ${м.rec_basis}`);
      }
    }
    console.log('');
    return 0;
  }

  // ---------- сколько осталось ----------

  const о = await позвать('/registry/recommendations', { ключ: н.ключ });
  if (!о.вышло) {
    console.error(`Не вышло: ${о.тело.ошибка ?? о.почему ?? о.код}`);
    return 1;
  }
  console.log('Места нехватки по состоянию:');
  for (const с of о.тело.состояния || []) console.log(`  ${с.rec_state}: ${с.сколько}`);
  console.log('\nНа чём стоят предложения:');
  for (const о2 of о.тело.основания || []) console.log(`  ${о2.rec_ground}: ${о2.сколько}`);
  console.log('\nСледующие вопросы: node scripts/razbor.mjs --вопросы 5');
  return 0;
}


process.exitCode = await главное();
