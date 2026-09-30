#!/bin/sh
set -eu

node --experimental-strip-types scripts/validate-runtime-config.mjs
node scripts/migrate.mjs
exec node server.js
