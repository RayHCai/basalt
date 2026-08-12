#!/usr/bin/env bash
#
# Generate the REAL RULER evaluation datasets by running NVIDIA's own generators
# (github.com/NVIDIA/RULER, Apache-2.0) once, locally, and writing the resulting
# `.jsonl` under `.ruler-data/`. `@basalt/evals` then LOADS these files — it does
# not reimplement RULER's task generation.
#
# WHY THIS IS A SCRIPT AND NOT COMMITTED DATA:
#   The generated `.jsonl` embeds third-party corpora (Paul Graham essays via
#   NIAH, SQuAD + HotpotQA passages) inline. Those are NOT ours to redistribute,
#   so the data is regenerated on demand and git-ignored (see .gitignore:
#   .ruler-data/ and .ruler-src/). RULER itself is Apache-2.0; we clone it, we
#   do not vendor it.
#
# TOKENIZER NOTE:
#   RULER sizes each sample to an EXACT token budget under a specific tokenizer.
#   Basalt is multi-model, so we size with `cl100k_base` (tiktoken) as a fixed,
#   model-agnostic ruler. Consequently these lengths (and therefore scores) are
#   NOT directly comparable to RULER numbers published for a specific model's
#   tokenizer — this suite is "RULER, sized with cl100k_base".
#
# USAGE:
#   scripts/generate-ruler-data.sh [--lengths "8192 32768 131072"]
#                                  [--samples N] [--seed N]
#                                  [--tasks "niah_single_1 vt cwe ..."]
#   Env overrides: RULER_LENGTHS, RULER_SAMPLES, RULER_SEED, RULER_TASKS,
#                  RULER_REF (git ref, default: main), RULER_DATA_DIR.
#
# REQUIREMENTS: git, git-lfs, curl, and a Python 3.10+ on PATH (a venv is
# created under .ruler-src/.venv with only the light deps RULER's tiktoken path
# needs — NOT the full nemo/vllm stack in RULER's requirements.txt).
set -euo pipefail

# --- Resolve repo root (this script lives in <root>/scripts) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Config (env-overridable, then flags) ---
RULER_REF="${RULER_REF:-main}"
SRC_DIR="${RULER_SRC_DIR:-$ROOT/.ruler-src}"
# Default output goes to the config-managed state tree (<STATE_DIR>/evals/data),
# matching what `basalt evaluate load` uses. STATE_DIR honors BASALT_STATE_DIR,
# defaulting to <cwd>/.basalt (same resolution as @basalt/config). RULER_DATA_DIR
# overrides the whole thing (the CLI's `evaluate load` sets it explicitly).
STATE_DIR="${BASALT_STATE_DIR:-$PWD/.basalt}"
DATA_DIR="${RULER_DATA_DIR:-$STATE_DIR/evals/data}"
LENGTHS="${RULER_LENGTHS:-8192 32768 131072}"
SAMPLES="${RULER_SAMPLES:-50}"
SEED="${RULER_SEED:-42}"
# The 13 RULER v1 tasks (scripts/synthetic.yaml). Override to a subset for speed.
TASKS="${RULER_TASKS:-niah_single_1 niah_single_2 niah_single_3 niah_multikey_1 niah_multikey_2 niah_multikey_3 niah_multivalue niah_multiquery vt cwe fwe qa_1 qa_2}"

while [ $# -gt 0 ]; do
  case "$1" in
    --lengths) LENGTHS="$2"; shift 2 ;;
    --samples) SAMPLES="$2"; shift 2 ;;
    --seed) SEED="$2"; shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "==> RULER data generation"
echo "    ref=$RULER_REF  lengths=[$LENGTHS]  samples=$SAMPLES  seed=$SEED"
echo "    src=$SRC_DIR"
echo "    out=$DATA_DIR"

# --- 1. Clone RULER (shallow) + materialize the LFS word list ---
if [ ! -d "$SRC_DIR/.git" ]; then
  echo "==> Cloning NVIDIA/RULER@$RULER_REF"
  git clone --depth 1 --branch "$RULER_REF" https://github.com/NVIDIA/RULER "$SRC_DIR"
fi
cd "$SRC_DIR"
# common_words_extraction reads json/english_words.json, an 8.5MB Git-LFS file
# that a plain clone leaves as a pointer. Materialize just that file.
git lfs install --local >/dev/null 2>&1 || true
git lfs pull --include="scripts/data/synthetic/json/english_words.json" >/dev/null 2>&1 || true

# --- 2. Python venv with the LIGHT deps of RULER's tiktoken path only ---
VENV="$SRC_DIR/.venv"
if [ ! -d "$VENV" ]; then
  echo "==> Creating venv + installing light deps"
  python3 -m venv "$VENV"
  # tiktoken: cl100k_base sizing; nltk(+punkt): sentence splitting; numpy/scipy:
  # needle placement + fwe Zipfian; wonderwords/pyyaml/bs4/html2text/tqdm/requests/
  # tenacity: word banks, config, essay download, tokenizer wrapper imports.
  "$VENV/bin/pip" install -q --disable-pip-version-check \
    tiktoken nltk numpy scipy wonderwords pyyaml \
    beautifulsoup4 html2text tqdm requests tenacity
  "$VENV/bin/python" -c "import nltk; nltk.download('punkt', quiet=True); nltk.download('punkt_tab', quiet=True)"
fi

# --- 3. Download the corpora (idempotent) ---
JSON_DIR="$SRC_DIR/scripts/data/synthetic/json"
cd "$JSON_DIR"
if [ ! -s PaulGrahamEssays.json ]; then
  echo "==> Downloading Paul Graham essays (NIAH haystack)"
  "$VENV/bin/python" download_paulgraham_essay.py
fi
# RULER's download_qa_dataset.sh uses wget; macOS ships only curl. Fetch directly.
if [ ! -s squad.json ]; then
  echo "==> Downloading SQuAD (qa_1)"
  curl -sSL --retry 3 https://rajpurkar.github.io/SQuAD-explorer/dataset/dev-v2.0.json -o squad.json
fi
if [ ! -s hotpotqa.json ]; then
  echo "==> Downloading HotpotQA (qa_2)"
  curl -sSL --retry 3 http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json -o hotpotqa.json \
    || curl -sSL --retry 3 https://huggingface.co/datasets/namlh2004/hotpotqa/resolve/7e54db4656209750ff487f6fdf8e39a66dba136b/hotpot_dev_distractor_v1.json -o hotpotqa.json
fi

# --- 4. Generate each task at each length ---
# prepare.py re-invokes the per-task generator via `subprocess.run("python ...")`
# with a BARE `python`, and swallows that inner process's failure (printing to
# its own stdout, returncode 0). So we must (a) put the venv on PATH so the bare
# `python` resolves to the venv interpreter, and (b) grep the captured stdout for
# the inner "Error output:" / traceback and for a produced file, since a missing
# module would otherwise look like a silent success.
mkdir -p "$DATA_DIR"
cd "$SRC_DIR/scripts/data"
export PATH="$VENV/bin:$PATH"
for len in $LENGTHS; do
  for task in $TASKS; do
    out="$DATA_DIR/$len/$task/validation.jsonl"
    if [ -s "$out" ]; then
      echo "    skip  $len/$task (exists)"
      continue
    fi
    echo "==> generate $len/$task ($SAMPLES samples)"
    log="$DATA_DIR/.gen-$len-$task.log"
    "$VENV/bin/python" prepare.py \
      --save_dir "$DATA_DIR/$len" \
      --benchmark synthetic \
      --task "$task" \
      --tokenizer_path cl100k_base \
      --tokenizer_type openai \
      --max_seq_length "$len" \
      --num_samples "$SAMPLES" \
      --model_template_type base \
      --random_seed "$SEED" \
      >"$log" 2>&1 || true
    if [ ! -s "$out" ]; then
      echo "    FAIL $len/$task — see $log" >&2
      grep -iE "error|traceback|no module" "$log" | head -3 >&2 || true
    fi
  done
done

echo "==> Done. Datasets under $DATA_DIR/<length>/<task>/validation.jsonl"
