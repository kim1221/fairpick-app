# Fairpick Admin Web

Modern admin panel for Fairpick event management.

## 🚀 Features

- ✅ Dashboard with real-time statistics
- ✅ Event management (view, edit, feature)
- ✅ **Popup creation with AI-powered auto-fill**
- ✅ Instagram URL → Auto data extraction
- ✅ Beautiful, intuitive UI/UX

## 🛠️ Tech Stack

- React 18 + TypeScript
- Vite
- TailwindCSS
- React Router v6
- TanStack Query (React Query)
- Axios

## 📦 Installation

```bash
npm install
```

## 🏃 Development

```bash
npm run dev
```

Open http://localhost:5173

## 🔐 Login

Use your Admin Key to access the admin panel.

## 🎨 Pages

1. **Dashboard** (`/`) - Real-time stats and recent logs
2. **Events** (`/events`) - Manage all events
3. **Create Popup** (`/popup/create`) - Add new popup events with AI auto-fill

## 🌐 Environment

Create `.env` file:

```
VITE_API_URL=http://localhost:4000
```

## 📝 Notes

- This is a separate web app (not a MiniApp)
- No MiniApp restrictions apply
- Full access to DOM, localStorage, etc.
