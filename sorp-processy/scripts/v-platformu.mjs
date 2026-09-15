// Выкладка моделей процессов и общего движка в платформу — для стенда процессов на имитации.
//
//   node v-platformu.mjs <путь к репозиторию SORP Platform>
//   (или SORP_PLATFORMA=<путь> node v-platformu.mjs)
//
// Движок в платформе — не копия, которую правят руками, а выпуск отсюда: файл
// web/src/lib/proc-sim/dvizhok.ts пересобирается из scripts/dvizhok.mjs плагина, модели —
// из modeli/processy рабочей папки. В платформу уходят только модели без ошибок проверки;
// готовность логики едет вместе с моделью, и стенд её показывает.

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { прогнатьМодель } from './progon.mjs';
import { МОДЕЛИ, ПЛАГИН, напрямую } from './mesto.mjs';

const ШАПКА = '// Выпущено плагином sorp-processy (scripts/v-platformu.mjs). Руками не править —\n// правка теряется при следующем выпуске.\n';

export function главная(argv = process.argv.slice(2)) {
  const платформа = argv[0] || process.env.SORP_PLATFORMA;
  if (!платформа || !existsSync(path.join(платформа, 'web'))) {
    console.error('Нужен путь к репозиторию SORP Platform (в нём папка web): node v-platformu.mjs <путь> или SORP_PLATFORMA=<путь>');
    process.exit(2);
  }
  const КУДА = path.join(платформа, 'web/src/lib/proc-sim');
  mkdirSync(КУДА, { recursive: true });
  const движок = readFileSync(path.join(ПЛАГИН, 'scripts/dvizhok.mjs'), 'utf8');
  writeFileSync(path.join(КУДА, 'dvizhok.ts'), `// @ts-nocheck\n${ШАПКА}\n${движок}`);

  const модели = [];
  const пропущены = [];
  for (const ф of readdirSync(МОДЕЛИ).filter((f) => /^PROC-\d{3}\.json$/.test(f)).sort()) {
    const м = JSON.parse(readFileSync(path.join(МОДЕЛИ, ф), 'utf8'));
    const итог = прогнатьМодель(м);
    if (итог.проверка.ошибки.length) { пропущены.push(`${ф}: ошибок ${итог.проверка.ошибки.length}`); continue; }
    модели.push({ ...м, прогон: { готово: итог.готово, сценариев: итог.сценариев, дыр: итог.дыры.length, неопределено: итог.неопределено.length, сбоев: итог.сбои.length } });
  }
  writeFileSync(path.join(КУДА, 'modeli.ts'), `${ШАПКА}\n// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const МОДЕЛИ: any[] = ${JSON.stringify(модели, null, 1)};\n`);
  console.log(`в платформу: движок и ${модели.length} моделей → ${КУДА}`);
  if (пропущены.length) console.log(`не выложены (ошибки проверки):\n  ${пропущены.join('\n  ')}`);
}

if (напрямую(import.meta.url)) главная();
