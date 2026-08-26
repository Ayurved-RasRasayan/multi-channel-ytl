# 🎬 YouTube Channel Downloader

A full-featured YouTube channel downloading and management application built with Node.js, Express, and yt-dlp.

---

## ✨ Features

- **📺 Multi-Channel Management**: Load and track multiple YouTube channels easily.
- **🚫 Duplicate Channel Protection**: Prevents adding channels that are already in your channel list with an immediate alert and abort option.
- **⚡ Fast & Efficient Video Loading**: Instant loading with in-memory caching and fast background sync.
- **⬇️ Concurrent Download Queue**: Concurrently download videos (default max 2 concurrent downloads) with a visible queue.
- **📊 Real-time Sync & Stats**: Track downloaded vs. remaining videos for every channel.
- **🔐 Built-in Authentication**: Session-based login protection and rate limiting.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18 or higher
- **npm**
- **yt-dlp** installed on system PATH
- **FFmpeg** (optional, recommended for audio/video merging)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd youtube-downloader

# Install server dependencies
cd server
npm install

# Start the application server
node server.js
```

The application will run on **http://localhost:3000**.

### Default Login Credentials

- **Username**: `admin`
- **Password**: `password123`

---

## 📂 Project Structure

```
youtube-downloader/
├── server/
│   ├── server.js              # Express application server
│   ├── db_channels.json       # Channel & video persistence DB
│   ├── middleware/            # Security & validation middleware
│   ├── routes/                # API routes
│   └── tests/                 # Integration and unit tests
├── public/
│   ├── index.html             # Main frontend interface
│   └── login.html             # Login screen
├── Dockerfile                 # Container setup
├── docker-compose.yml         # Compose configuration
├── sanitize.py                # Filename sanitization script
├── seed_db_channels.py        # Database seeding script
└── README.md                  # Project documentation
```

---

## 📡 API Overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/login` | Authenticate user session |
| `GET`  | `/api/channels` | Retrieve all tracked channels |
| `POST` | `/api/channels` | Add a new YouTube channel |
| `DELETE`| `/api/channels/:id` | Remove a channel by ID |
| `POST` | `/api/download` | Queue a video for download |
| `GET`  | `/api/download-queue` | View active and queued downloads |

---

## 🧪 Testing

Run test suites using Jest:

```bash
cd server
npm test
```

---

## 📄 License

This project is open-source and licensed under the MIT License.
