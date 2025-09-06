#!/usr/bin/env node

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generateCmd } from '../src/cmd/generate.js';
import { critiqueCmd } from '../src/cmd/critique.js';
import { iterateCmd } from '../src/cmd/iterate.js';
import { runCmd } from '../src/cmd/run.js';
import { modelsCmd, initCmd } from '../src/cmd/misc.js';

yargs(hideBin(process.argv))
  .scriptName('abe')
  .command(generateCmd)
  .command(critiqueCmd)
  .command(iterateCmd)
  .command(runCmd)
  .command(modelsCmd)
  .command(initCmd)
  .demandCommand(1)
  .strict()
  .help()
  .parse();