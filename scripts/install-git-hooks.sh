#!/bin/sh
set -eu
cd "$(git rev-parse --show-toplevel)"
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
echo "Git hooks path set to .githooks"
echo "Every commit runs the public-boundary check and the secret scan."
echo "Every push runs those checks again."
