# Arnold Slack Backend

Handles Slack interactions and Google OAuth for Arnold The Analyst.

## Environment Variables

- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REDIRECT_URI
- MCP_SERVER_URL
- MCP_API_KEY
- N8N_WEBHOOK_URL
- PORT (auto-set by Railway)
```

---

### Step 1.2: Deploy to Railway

1. Push to GitHub
2. Railway → New Project → Deploy from GitHub
3. Select `arnold-slack-backend`
4. Add environment variables:
   - `GOOGLE_CLIENT_ID`: Your Google OAuth Client ID
   - `GOOGLE_CLIENT_SECRET`: Your Google OAuth Secret
   - `GOOGLE_REDIRECT_URI`: `https://YOUR-SLACK-BACKEND-URL.up.railway.app/oauth/google/callback`
   - `MCP_SERVER_URL`: `https://arnold-mcp-server-production.up.railway.app`
   - `MCP_API_KEY`: `cf9b2953-62b8-4e66-846f-eba4f924f0eb`
   - `N8N_WEBHOOK_URL`: Your n8n webhook URL (we'll create this)
5. Generate domain
6. Copy the URL (e.g., `arnold-slack-backend-production.up.railway.app`)

---

## Phase 2: Update Google Cloud OAuth Settings (5 minutes)

1. Go to Google Cloud Console → Credentials
2. Click your OAuth Client ID
3. Under "Authorized redirect URIs", add:
```
   https://arnold-slack-backend-production.up.railway.app/oauth/google/callback
