# MIT CPD Manager

A single-user, self-hosted CPD logbook and MRTB audit-pack builder. It keeps the original evidence files on your own server and exports the separate items expected by the MRTB audit portal.

## What it does

- Records substantive and general CPD activities by biennium.
- Stores multiple original evidence files against each activity.
- Builds reflective statements from the MRTB prompts.
- Selects exactly six evidence files and four category-specific reflections for audit.
- Checks year coverage, substantive evidence, visible name/date confirmations, hours and peer declaration.
- Generates a current-style Word logbook, individual reflection documents and an optional convenience ZIP.
- Creates a portable JSON-and-original-files backup without copying a live SQLite file.

The ZIP is for safekeeping. Extract it and upload its contents to the MRTB portal as separate files.

## Run with Docker Compose

```text
docker compose up -d --build
```

Open `http://localhost:8787`.

All persistent information is under `./data`:

- `cpd-manager.sqlite` contains structured records.
- `files/` contains uploaded originals.

Back up the entire `data` directory together. Stop the container while taking a simple file-copy backup so the SQLite database and evidence files represent the same point in time.

## Private access

The app has no user accounts because it is intended for one person on a trusted network. Do not expose port 8787 directly to the public internet. For remote phone access, put it behind a private VPN or an authenticated reverse proxy.

## Local development

Node.js 24 or later is required.

```text
npm start
npm test
```

Set `DATA_DIR` to use a different persistent-data directory and `MAX_UPLOAD_BYTES` to change the default 25 MB per-file limit.

## Requirements snapshot

The readiness checks are based on the MRTB CPD policy dated November 2025 and the 2025 portal submission guide. The source and version are shown inside the app. Requirements are kept in one file (`src/requirements.mjs`) so a future policy update does not require hunting through the interface.
