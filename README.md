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

## Endpoints

### Slash Commands
- POST `/slack/commands/connect` - /arnold-connect
- POST `/slack/commands/status` - /arnold-status
- POST `/slack/commands/disconnect` - /arnold-disconnect
- POST `/slack/commands/property` - /arnold-property

### OAuth
- GET `/oauth/google/callback` - Google OAuth callback

### Interactivity
- POST `/slack/interactions` - Handle button/menu clicks

### Events
- POST `/slack/events` - Handle @mentions and messages

### Health
- GET `/health` - Health check endpoint
