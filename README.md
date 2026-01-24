# JournaLens

A web app that analyzes your journal entries and provides thoughtful insights using Claude AI.

**Try it at [journalens.vercel.app](https://journalens.vercel.app)**

## Features

- **Journal Analysis** - Upload your journal export and receive AI-generated insights about patterns, themes, and reflections
- **Multiple Formats** - Supports Day One exports (.zip) as well as plain text files (.json, .xml, .md, .txt)
- **Private by Design** - Your journal content is processed directly with the Claude API using your own API key
- **Cloud Sync** - Sign in with Google to save your API key and reports privately in your Google Drive

## How It Works

1. Enter your [Claude API key](https://console.anthropic.com/settings/keys)
2. Upload a journal file
3. Wait for Claude to analyze your entries
4. Review your personalized insights report

## Privacy

- Journal content is sent directly to the Claude API and is not stored on any server
- Your API key is stored only in your browser (or your Google Drive if signed in)
- Reports are saved to your personal Google Drive, accessible only by you

## Development

```bash
npm install
npm run dev
```

Requires environment variables for NextAuth and Google OAuth configuration.
