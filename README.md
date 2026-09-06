# Nexus Stream

Self-hosted local media server for movies, TV, cartoons, and music. It runs in the browser at `http://localhost:3615` and can also run as a macOS menu-bar app that hosts the same server.

## Requirements

- Node.js 22+
- FFmpeg / ffprobe on your PATH for artwork and remux (the Mac app bundles its own)
- A [Supabase](https://supabase.com) project for sign-in (Lumora / existing Nexus auth)

## Setup

```bash
cp .env.example .env
```

Fill in:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `NEXUS_ADMIN_EMAILS` — comma-separated emails that can open `/admin`
- `NEXUS_MEDIA_ROOT` — optional first-run media folder. After that, change folders in **Admin → Folders**.

Do not commit `.env`.

```bash
npm install
npm run dev
```

Open [http://localhost:3615](http://localhost:3615). Production mode:

```bash
npm run build
npm start
```

The host always binds port **3615** on all interfaces (`0.0.0.0`).

## Admin

Signed-in admins open `/admin` or **Open Admin Panel** from the tray.

- **Folders** — default library path and extra folders
- **Library** — browse the real directory tree; open a file to edit title, artwork, visibility, recommendations, and dashboard placement
- **Dashboard** — featured title and custom rails
- **Users / Activity** — local session visibility only. Accounts stay in Supabase.

## macOS app

```bash
npx tauri build --bundles app
```

That packs Node, the server, the web UI, and FFmpeg into `Nexus Stream.app`. Library metadata is stored in `~/Library/Application Support/Nexus Stream`. The app does not need this git checkout at runtime.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API + Vite on port 3615 |
| `npm start` | Production server serving `dist/` |
| `npm run build` | Typecheck and build the web UI |
| `npx tauri build --bundles app` | Build the standalone Mac app |

`src-tauri/runtime/` is generated at package time and is not committed.
