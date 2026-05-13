# OMX Wiki

OMX Wiki is a compiled markdown knowledge layer for agents.

## What it is

- commit-friendly project knowledge stored under repository `omx_wiki/`
- markdown-first and search-first
- designed for agentic retrieval workflows, not vector-first RAG

## Core user surfaces

- `owx wiki add`
- `owx wiki query`
- `owx wiki lint`
- `owx wiki refresh`
- `owx wiki list`
- `owx wiki read`
- `owx wiki delete`

## Retrieval model

- Wiki pages are queried first when useful
- `owx explore` can inject wiki-first context before broader repository search
- repository search remains the fallback when wiki evidence is weak or missing

## Lifecycle model

- SessionStart can inject compact wiki context through the native hook path
- SessionEnd can capture session-log pages through the runtime cleanup path

## Constraints

- no vector embeddings required
- wiki is source-visible project knowledge intended for review/commit when useful
