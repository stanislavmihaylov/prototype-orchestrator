#!/usr/bin/env sh
# Run from the consuming project root: sh prototype-orchestrator/setup.sh web|mobile
ORCH_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$ORCH_DIR")"
STACK="$1"

if [ -z "$STACK" ]; then
  echo "Usage: sh prototype-orchestrator/setup.sh web|mobile"
  exit 1
fi

if [ "$STACK" != "web" ] && [ "$STACK" != "mobile" ]; then
  echo "Invalid stack: $STACK"
  echo "Valid values are: web, mobile"
  exit 1
fi

TARGET_DIR="$PROJECT_ROOT/.claude"

if [ -e "$TARGET_DIR" ]; then
  echo "Removing existing .claude at $TARGET_DIR"
  rm -rf "$TARGET_DIR"
fi

mkdir -p "$TARGET_DIR/agents"
mkdir -p "$TARGET_DIR/skills"

cp "$ORCH_DIR/.claude/settings.json" "$TARGET_DIR/"
cp -R "$ORCH_DIR/claude-setup/common/agents/." "$TARGET_DIR/agents/"
cp -R "$ORCH_DIR/claude-setup/common/skills/." "$TARGET_DIR/skills/"
cp -R "$ORCH_DIR/claude-setup/$STACK/agents/." "$TARGET_DIR/agents/"
cp -R "$ORCH_DIR/claude-setup/$STACK/skills/." "$TARGET_DIR/skills/"

echo ".claude created at $TARGET_DIR with stack: $STACK"

# Install prototype-orchestrator dependencies
cd "$ORCH_DIR" && npm install
echo "Prototype Orchestrator ready."
