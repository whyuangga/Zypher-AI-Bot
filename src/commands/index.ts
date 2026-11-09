import { bantuanCommand } from './bantuan.js';
import { ingatCommand } from './ingat.js';
import { keywordCommand } from './keyword.js';
import { lupakanCommand } from './lupakan.js';
import { memoriCommand } from './memori.js';
import { panelCommand } from './panel.js';
import { personaCommand } from './persona.js';
import { resetCommand } from './reset.js';
import { tanyaCommand } from './tanya.js';
import type { Command } from './types.js';

export const commands: Command[] = [
  panelCommand,
  tanyaCommand,
  bantuanCommand,
  ingatCommand,
  memoriCommand,
  lupakanCommand,
  resetCommand,
  keywordCommand,
  personaCommand,
];

export const commandMap = new Map<string, Command>(commands.map((command) => [command.data.name, command]));

export type { Command };
