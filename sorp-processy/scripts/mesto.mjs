// Где лежат данные: рабочая папка, а не папка плагина.
//
// Плагин — только код. Карта, презентации, модели и итоги прогона — данные команды,
// они живут в рабочей папке человека и в репозиторий плагина не попадают:
//
//   dannye/megamozg.json                  карта процессов (выгрузка «Мегамозга»)
//   dannye/istochniki/<дата>/Презентации  презентации с общего диска
//   modeli/processy/PROC-xxx.json         модели процессов
//   vyhod/processy/                       пакеты, итоги прогона, вопросы, план записей
//
// Рабочая папка — текущая (откуда запущен Claude), или SORP_PROCESSY_DIR.
// Папка презентаций — самая свежая dannye/istochniki/*/Презентации, или SORP_PREZENTACII.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const РАБОЧАЯ = path.resolve(process.env.SORP_PROCESSY_DIR || process.cwd());
export const ПЛАГИН = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const путь = (p) => (path.isAbsolute(p) ? p : path.join(РАБОЧАЯ, p));
export const читать = (p) => readFileSync(путь(p), 'utf8');

export const МОДЕЛИ = путь('modeli/processy');
export const ВЫХОД = путь('vyhod/processy');
export const КАРТА = путь(process.env.SORP_KARTA || 'dannye/megamozg.json');

function найтиПрезентации() {
  if (process.env.SORP_PREZENTACII) return путь(process.env.SORP_PREZENTACII);
  const корень = путь('dannye/istochniki');
  if (!existsSync(корень)) return путь('dannye/istochniki/Презентации');
  const кандидаты = readdirSync(корень).sort().reverse().map((d) => path.join(корень, d, 'Презентации')).filter(existsSync);
  return кандидаты[0] || path.join(корень, 'Презентации');
}
export const ПРЕЗЕНТАЦИИ = найтиПрезентации();

export function карта() {
  if (!existsSync(КАРТА)) {
    console.error(`Нет карты: ${КАРТА}\nПоложите выгрузку карты «Мегамозг» в dannye/megamozg.json рабочей папки или укажите путь в SORP_KARTA.`);
    process.exit(2);
  }
  return JSON.parse(readFileSync(КАРТА, 'utf8'));
}

/** Запущен ли файл напрямую (а не импортирован обёрткой). */
export const напрямую = (url) => !!process.argv[1] && url === pathToFileURL(path.resolve(process.argv[1])).href;
