#!/bin/bash
set -e

# PRODUCTION
cd "$(dirname "$0")"

BRANCH=main

git reset --hard
git checkout "$BRANCH"
git pull origin "$BRANCH"

# The containers install and build when they start, so recreate them to pick up the new code
docker compose up -d --force-recreate
