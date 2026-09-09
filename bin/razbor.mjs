#!/usr/bin/env node
// Вопросы разбора и ответы на них.
//
//   node bin/razbor.mjs                        сколько чего осталось
//   node bin/razbor.mjs --вопросы [сколько]    следующие места нехватки
//   node bin/razbor.mjs --да НОМЕР             предложенное подходит
//   node bin/razbor.mjs --нет НОМЕР "чем"      не подходит, и вот чем
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
      console.error('Скажите, чем не подходит: node bin/razbor.mjs --нет НОМЕР "чем именно"');
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
  console.log('\nСледующие вопросы: node bin/razbor.mjs --вопросы 5');
  return 0;
}


process.exitCode = await главное();
