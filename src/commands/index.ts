import { akhiriCommand } from './akhiri.js';
import { bantuanCommand } from './bantuan.js';
import { dokumenCommand } from './dokumen.js';
import { ingatCommand } from './ingat.js';
import { keywordCommand } from './keyword.js';
import { konsolidasiCommand } from './konsolidasi.js';
import { lupakanCommand } from './lupakan.js';
import { memoriCommand } from './memori.js';
import { panelCommand } from './panel.js';
import { personaCommand } from './persona.js';
import { resetCommand } from './reset.js';
import { ucapCommand } from './ucap.js';
import type { Command } from './types.js';

export const commands: Command[] = [
  panelCommand,
  akhiriCommand,
  ucapCommand,
  bantuanCommand,
  ingatCommand,
  memoriCommand,
  lupakanCommand,
  konsolidasiCommand,
  resetCommand,
  keywordCommand,
  personaCommand,
  dokumenCommand,
];

export const commandMap = new Map<string, Command>(commands.map((command) => [command.data.name, command]));

export type { Command };
