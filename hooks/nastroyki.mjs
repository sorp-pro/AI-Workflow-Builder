// Где плагин держит своё: ключ участника и данное им согласие.
//
// ── Почему в домашней папке, а не в плагине ──────────────────────────────────
// Плагин обновляется и переустанавливается; ключ, лежащий внутри него, при этом
// теряется, и человек заводит второй — в журнале появляется два участника с
// одним именем. Домашняя папка переживает обновление.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname } from 'node:path';

/** Адрес стенда. Один на всех, менять его участнику незачем. */
export const ШЛЮЗ =
  process.env.SORP_API_URL ||
  'https://workflow-builder-934054964.development.catalystserverless.com/server/builder_api';

const ГНЕЗДО = resolve(homedir(), '.sorp-svod', 'nastroyki.json');
export const где = () => ГНЕЗДО;

export function прочитать() {
  if (!existsSync(ГНЕЗДО)) return {};
  try {
    return JSON.parse(readFileSync(ГНЕЗДО, 'utf8'));
  } catch {
    // Битый файл — то же, что его нет: человека попросят войти заново.
    return {};
  }
}

export function записать(что) {
  const было = прочитать();
  mkdirSync(dirname(ГНЕЗДО), { recursive: true });
  writeFileSync(ГНЕЗДО, JSON.stringify({ ...было, ...что }, null, 2), { mode: 0o600 });
}

/**
 * Согласие на запись обращений.
 *
 * Плагин отправляет вопросы человека на чужой стенд. Это должно быть его
 * решением, принятым осознанно, а не побочным следствием установки: молчаливая
 * отправка чужой переписки — то, за что плагины справедливо снимают.
 */
export const согласился = () => прочитать().согласие === true;
