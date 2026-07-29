# FlavorThresholdDB

FlavorThresholdDB is a bilingual local search interface for odor thresholds and flavor descriptors. It supports exact and fuzzy searches by CAS number, Chinese name, or English name, as well as batch list matching and CSV export.

## Features

- Chinese and English interface
- Single-compound and batch searches
- Medium filters for air, water, and other matrices
- Detection and recognition threshold filters
- FEMA Flavor Ingredient Library lookups through a local proxy
- Book excerpt search when a local index is supplied
- Reorderable result sections and CSV export

## Data sources

The interface integrates records compiled from Van Gemert (2011), Fan and Xu (2020), and the FEMA Flavor Ingredient Library. Original source, measurement medium, threshold type, value, and unit are retained where available.

This repository is intended for personal study and academic exchange. Verify the redistribution rights of any locally generated data or book index before publishing or sharing it.

## Local development

Requirements:

- Node.js 20 or later
- Python 3.10 or later for the optional FEMA proxy

Install and start the frontend:

```bash
cd frontend
npm install
npm run dev
```

Start the optional FEMA proxy from the repository root:

```bash
python fema_proxy_server.py
```

The frontend runs at `http://127.0.0.1:5173/FlavorThresholdDB/` by default. The FEMA proxy listens on `http://127.0.0.1:8787`.

## Build

```bash
cd frontend
npm run build
```

## References

- Van Gemert, L. J. (2011). *Flavour Thresholds* (2nd ed.).
- Fan, W. L., & Xu, Y. (2020). *Wine Flavor Chemistry*. China Light Industry Press.
- FEMA Flavor Ingredient Library: https://www.femaflavor.org/flavor-library
