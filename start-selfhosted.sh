#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Starting FlexVault Self-Hosted Server..."
echo

if [ ! -f .env ]; then
    cp .env.selfhosted.example .env
    echo "Created .env from .env.selfhosted.example."
    echo "Edit .env (at minimum JWT_SECRET) and run this script again."
    exit 1
fi

if [ ! -x ./node_modules/.bin/tsx ]; then
    echo "Dependencies are not installed. Run: npm install"
    exit 1
fi

# The server loads .env itself via dotenv; no shell export needed.
exec ./node_modules/.bin/tsx \
    --loader ./src/selfhosted/cloudflare-workers-loader.mjs \
    ./src/selfhosted/index.ts
