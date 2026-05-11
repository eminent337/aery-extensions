# Aery Extensions

Extension packs for [Aery](https://github.com/eminent337/aery) — AI coding agent for the terminal.

## Browse & Install

```bash
aery
/marketplace
```

## Install directly

```bash
aery install eminent337/aery-extensions/packs/full
```

## Packs

| Pack | Description | Status |
|------|-------------|--------|
| `core` | Essential extensions (auto-installed) | ✅ |
| `full` | All 27 extensions | ✅ |
| `stitch` | Google Stitch design tools for Aery | ✅ |
| `geospatial` | GDAL, GIS tools | 🔜 Coming soon |
| `data-science` | Jupyter, pandas helpers | 🔜 Coming soon |

## Google Stitch

Install:

```bash
aery
/marketplace install stitch
```

Then restart Aery and run:

```text
/stitch auth
/stitch doctor
```

The extension wraps `@_davideast/stitch-mcp`. It supports API-key setup with `STITCH_API_KEY`, system gcloud setup with `STITCH_USE_SYSTEM_GCLOUD=1`, and the guided Stitch MCP setup flow. Once configured, Aery gets tools for listing projects and screens, fetching screen code or images, extracting design context, generating screens, and building route-level site design guidance from Stitch screens.
