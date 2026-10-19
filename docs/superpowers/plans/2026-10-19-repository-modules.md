# Repository Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. User authorized execution in the current session.

**Goal:** Separate website, manager source, and distribution orchestration while preserving product behavior.

**Architecture:** npm workspaces in one repository, with a dependency-free offline-format package. Pipeline adapters consume public build functions and directory JSON contracts; product runtimes never import the pipeline.

**Tech Stack:** Existing Node 26.9.0, npm, Svelte 5, Vite, esbuild, native GitHub runners.

**Spec:** docs/superpowers/specs/2026-10-19-repository-modules-design.md

## Global Constraints

- Preserve existing website source, design, URLs, categories, and platform behavior.
- Keep macos-arm64, linux-x64, win32-x64 entries and existing release acceptance checks.
- Remain in the isolated codex/offline-plugin-manager checkout; do not touch the outer Workbench Git repository.
- Update draft PR #9 only; do not merge, release, or deploy.

## Review Focus

- A clean workspace install must resolve local packages without existing distribution/node_modules.
- Website-only changes must not trigger native plugin matrix builds.
- workflow_run must never deploy PR output or execute an upstream untrusted ref.
- Built manager artifacts must contain shared metadata code without runtime workspace dependencies.
- Repository export and developer commands must include all new module roots.

### Task 1: Move sources, contracts and tests

**Files:** web/**, plugins/dsh-depot-manager/**, packages/offline-format/**, distribution/lib/{site,package,platform,package-status}.mjs, root/package workspace manifests and lock.

**Interfaces:** Keep buildManager, buildBootstrap, package metadata functions, and generateSite catalog inputs. Distribution owns conversion from state to catalog.

- [x] Add failing module-boundary and standalone website build tests; run RED.
- [x] Extract shared protocol primitives, move product sources and tests, split dependency declarations and generate the root workspace lock.
- [x] Install from the root lock and run all module tests; build the website and lightweight manager archive.
- [x] Commit source split, preserving the original page file bytes.

### Task 2: Separate workflow and deployment boundaries

**Files:** .github/workflows/{web-pages,manager-distribution,plugin-distribution}.yml, distribution/{ci,deploy-site,export}.mjs, workflow tests.

**Interfaces:** Website consumes latest published state/catalogs; native build workflows publish independently and workflow_run refreshes Pages from trusted default-branch code.

- [x] Add failing workflow tests for path filters, isolated permissions, and trusted workflow_run handling; run RED.
- [x] Create independent web workflow, remove Pages jobs from build workflows, update workspace installs and export roots.
- [x] Run workflow/export tests and all tests; inspect native CI after updating the draft branch.
- [x] Commit workflow split.

### Task 3: Documentation, integration evidence and Git

**Files:** README.md, MAINTAINING.md, module READMEs, docs/evidence/repository-modules-2026-10-19/**, current manager evidence.

**Interfaces:** Root npm commands and module commands reflect the final tree; historical evidence remains tied to original artifact bytes.

- [x] Update current guides, commands, source links, and module responsibilities; preserve historical receipts.
- [x] Verify clean exported checkout npm ci/test/build, unchanged page source, and new macOS lightweight archive with real DSH.
- [x] Perform a fresh whole-change review, address material findings, record validation and limitations.
- [x] Commit and synchronize draft PR #9, attach/update it, and report concrete results.
