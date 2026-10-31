# MIT CPD Manager

A small, self-hosted multi-user CPD logbook and MRTB audit-pack builder. Each user has a private record and original evidence files, while an administrator manages accounts and sees only broad usage statistics.

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

Before starting, copy `.env.example` to `.env` and set the initial administrator username, display name and a unique password of at least 12 characters. These values only bootstrap the first administrator in an empty database. The `.env` file is ignored by Git and must not be published.

Open `http://localhost:8787`.

All persistent information is under `./data`:

- `cpd-manager.sqlite` contains structured records.
- `files/` contains uploaded originals.

Back up the entire `data` directory together. Stop the container while taking a simple file-copy backup so the SQLite database and evidence files represent the same point in time.

## Accounts and private access

The initial administrator can create users, issue temporary passwords, reset passwords, and disable or enable accounts. New users must change their temporary password at first login. Passwords are salted and hashed; sessions use HTTP-only, same-site cookies. Every activity, reflection, profile, evidence file, declaration and export is scoped to the authenticated user. The administrator dashboard shows account status, last login, record counts and storage usage, but does not expose users' CPD content.

This multi-user release expects a clean data directory. It deliberately refuses to open a legacy single-user database rather than risk mixing ownership. Do not expose port 8787 directly through your router. For remote access, use a private VPN or an authenticated reverse proxy such as Cloudflare Access as an additional layer of protection.

## Local development

Node.js 24 or later is required.

```text
npm start
npm test
```

Set `DATA_DIR` to use a different persistent-data directory and `MAX_UPLOAD_BYTES` to change the default 25 MB per-file limit.

## Requirements snapshot

The readiness checks are based on the MRTB CPD policy dated November 2025 and the 2025 portal submission guide. The source and version are shown inside the app. Requirements are kept in one file (`src/requirements.mjs`) so a future policy update does not require hunting through the interface.
