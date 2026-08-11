#!/usr/bin/env bash

set -euo pipefail

forbidden_directories='^(\.nexora|docs|engine|sdk|planning|roadmap)(/|$)'
forbidden_documents='(^|/)[^/]*(roadmap|task[-_]?plan|development[-_]?plan|implementation[-_]?status|architecture[-_]?gap|detailed[-_]?design|migration[-_]?record|completion[-_]?audit|release[-_]?checklist|runbook|decision[-_]?record|backlog|milestones?)[^/]*\.(md|txt|adoc|rst)$'
forbidden_root_files='^((notes|todo)\.(md|txt|adoc|rst)|buf(\.gen)?\.ya?ml)$'

find_violations() {
  local files="$1"

  {
    printf '%s\n' "$files" | grep -E -i "$forbidden_directories" || true
    printf '%s\n' "$files" | grep -E -i "$forbidden_documents" || true
    printf '%s\n' "$files" | grep -E -i "$forbidden_root_files" || true
  } | sort -u
}

run_self_test() {
  local blocked=(
    '.nexora/private-docs/task_plan.md'
    'docs/architecture.md'
    'engine/Cargo.toml'
    'sdk/typescript/src/index.ts'
    'planning/release-plan.md'
    'ROADMAP.md'
    'buf.yaml'
  )
  local allowed=(
    'README.md'
    'packages/automation-colony/game.package.json'
    'packages/automation-colony/src/lib.rs'
    'client/src/App.tsx'
    'server/game/world.ts'
  )
  local path

  for path in "${blocked[@]}"; do
    if [[ -z "$(find_violations "$path")" ]]; then
      printf 'Boundary self-test did not reject: %s\n' "$path" >&2
      exit 1
    fi
  done

  for path in "${allowed[@]}"; do
    if [[ -n "$(find_violations "$path")" ]]; then
      printf 'Boundary self-test rejected public artifact: %s\n' "$path" >&2
      exit 1
    fi
  done
}

if [[ "${1:-}" == '--self-test' ]]; then
  run_self_test
  exit 0
fi

violations="$(find_violations "$(git ls-files)")"

if [[ -n "$violations" ]]; then
  printf '%s\n' 'Engine source or private planning records are tracked:' >&2
  while IFS= read -r violation; do
    printf '  %s\n' "$violation" >&2
  done <<< "$violations"
  exit 1
fi
