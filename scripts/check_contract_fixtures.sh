#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

cargo run -p ss_cli --bin generate_contract_fixtures -- --check
