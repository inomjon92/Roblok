#!/bin/sh
set -e
cd "$(dirname "$0")"
mkdir -p dist
npx esbuild src/main.js --bundle --minify --format=iife --target=es2019 --outfile=dist/game.js
cp src/index.html dist/index.html
