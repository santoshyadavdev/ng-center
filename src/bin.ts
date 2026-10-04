#!/usr/bin/env node
import { main } from './cli/main.js';

process.exitCode = main(process.argv.slice(2));
