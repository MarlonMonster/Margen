#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { setup } = require('../lib/setup');

const dir = process.env.MARGEN_DATA || path.join(__dirname, '..', 'data');
const t0 = Date.now();
setup({ dir, log: (m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`), keepRaw: process.argv.includes('--keep-raw') })
  .then((r) => console.log('Ready:', r))
  .catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
