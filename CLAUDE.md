# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A browser-based weekly report generator that creates `.pptx` files from user input. There is no build system or package manager — this is plain JavaScript intended to run directly in a browser.

## Architecture

### Key Files

- **`pptx_code.js`** — Core logic: HTML parsing, OOXML slide generation, and PPTX assembly via JSZip
- **`jszip.min.js`** — Bundled JSZip library (no npm)
- **`unpacked_template/`** — A reference PPTX unpacked as XML; the actual binary template is embedded as a Base64 string (`TEMPLATE_B64`) at runtime

### How It Works

`pptx_code.js` is injected into an HTML page that is not present in this directory. The page provides:
- A `slides` array (global) containing objects with `{ month, week, team, leftHtml, rightHtml }`
- `setStatus(msg)` function for status display
- A button with id `btnPptx` that calls `savePptx()`

`savePptx()` decodes `TEMPLATE_B64`, loads it with JSZip, replaces/adds slide XML files built by `buildSlideXml()`, patches `presentation.xml` and `[Content_Types].xml`, then triggers a browser download.

### OOXML Slide Structure

Each slide (`buildSlideXml`) contains:
1. A title text box (`month`월 `week`주차 주간 보고_`team`)
2. A 2-column table: left = 금주 실적, right = 차주계획
3. Table content comes from `htmlParas()` → `parasToOoxml()`: parses HTML class names (`sq-heading`, `bullet-item`) into OOXML paragraph runs

### Template Embedding

`TEMPLATE_B64` is a placeholder string `'__TEMPLATE_B64__'` replaced at build/deploy time with the actual Base64-encoded `.pptx` template binary. The `unpacked_template/` directory is a human-readable reference copy of that template.
