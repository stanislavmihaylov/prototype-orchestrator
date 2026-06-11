#!/usr/bin/env sh
# Run from the consuming project root: sh orchestrator/setup.sh
ORCH_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$ORCH_DIR")"

# Symlink .claude to the project root
if [ -e "$PROJECT_ROOT/.claude" ]; then
  echo ".claude already exists at $PROJECT_ROOT — skipping"
else
  ln -sf "$ORCH_DIR/.claude" "$PROJECT_ROOT/.claude"
  echo "Linked .claude → $ORCH_DIR/.claude"
fi

# Install orchestrator dependencies
cd "$ORCH_DIR" && npm install
echo "Orchestrator ready."
