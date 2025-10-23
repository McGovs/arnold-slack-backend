import express from 'express';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// OAuth2 client
const oauth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'arnold-slack-backend' });
});

// ==========================================
// SLACK SLASH COMMANDS
// ==========================================

// /arnold-connect command
app.post('/slack/commands/connect', async (req, res) => {
  const { user_id, user_name } = req.body;
  
  console.log(`User ${user_name} (${user_id}) requested to connect Google Analytics`);
  
  // Generate Google OAuth URL with user's Slack ID as state
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent',
    state: user_id // Pass Slack user ID
  });
  
  // Send ephemeral message to user with connect button
  res.json({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '👋 *Connect your Google Analytics account to get started with Arnold!*\n\nArnold will be able to:\n• Read your Google Analytics data\n• Show you insights and reports\n• Answer questions about your website traffic'
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔗 Connect Google Analytics',
              emoji: true
            },
            url: authUrl,
            style: 'primary'
          }
        ]
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🔒 Your credentials are encrypted and secure'
          }
        ]
      }
    ]
  });
});

// /arnold-status command
app.post('/slack/commands/status', async (req, res) => {
  const { user_id } = req.body;
  
  try {
    // Check if user has tokens in MCP server
    const response = await axios.get(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/tokens`,
      {
        headers: {
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    if (response.data.success) {
      const isExpired = response.data.isExpired;
      const propertyId = response.data.propertyId;
      
      res.json({
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Google Analytics Connected*\n\n• Status: ${isExpired ? '⚠️ Token expired - please reconnect' : '✅ Active'}\n• Property: ${propertyId || '⚠️ Not set - use /arnold-property'}`
            }
          }
        ]
      });
    }
  } catch (error) {
    res.json({
      response_type: 'ephemeral',
      text: '❌ Google Analytics not connected. Use `/arnold-connect` to get started.'
    });
  }
});

// /arnold-disconnect command
app.post('/slack/commands/disconnect', async (req, res) => {
  const { user_id } = req.body;
  
  try {
    await axios.delete(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/tokens`,
      {
        headers: {
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    res.json({
      response_type: 'ephemeral',
      text: '✅ Google Analytics disconnected successfully.'
    });
  } catch (error) {
    res.json({
      response_type: 'ephemeral',
      text: '❌ Error disconnecting. Please try again.'
    });
  }
});

// /arnold-property command
app.post('/slack/commands/property', async (req, res) => {
  const { user_id, text } = req.body;
  const propertyId = text.trim();
  
  if (!propertyId) {
    return res.json({
      response_type: 'ephemeral',
      text: 'Usage: `/arnold-property properties/123456789` or `/arnold-property 123456789`'
    });
  }
  
  // Format property ID
  const formattedPropertyId = propertyId.startsWith('properties/') 
    ? propertyId 
    : `properties/${propertyId}`;
  
  try {
    await axios.patch(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/property`,
      { propertyId: formattedPropertyId },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    res.json({
      response_type: 'ephemeral',
      text: `✅ Property set to: \`${formattedPropertyId}\`\n\nYou're all set! Ask Arnold a question like:\n"@Arnold show me sessions by country last week"`
    });
    
  } catch (error) {
    res.json({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`
    });
  }
});

// ==========================================
// GOOGLE OAUTH CALLBACK
// ==========================================

app.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const slackUserId = state; // The Slack user ID we passed as state
  
  if (error) {
    console.error('OAuth error:', error);
    return res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Connection Failed</h1>
          <p>There was an error connecting to Google Analytics.</p>
          <p>Error: ${error}</p>
          <p>Please try again in Slack with <code>/arnold-connect</code></p>
        </body>
      </html>
    `);
  }
  
  try {
    console.log(`Processing OAuth callback for user ${slackUserId}`);
    
    // Exchange authorization code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    console.log('Tokens received from Google');
    
    // Store tokens in MCP server database
    const storeResponse = await axios.post(
      `${process.env.MCP_SERVER_URL}/users/tokens`,
      {
        slackUserId: slackUserId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expiry_date ? Math.floor((tokens.expiry_date - Date.now()) / 1000) : 3600,
        propertyId: null // User will set this next
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    if (storeResponse.data.success) {
      console.log(`Tokens stored successfully for user ${slackUserId}`);
      
      // Success page with property selection instructions
      res.send(`
        <html>
          <head>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
                text-align: center;
                padding: 50px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
              }
              .container {
                background: white;
                color: #333;
                padding: 40px;
                border-radius: 10px;
                max-width: 500px;
                margin: 0 auto;
                box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              }
              h1 { color: #4CAF50; margin-bottom: 10px; }
              p { line-height: 1.6; }
              code {
                background: #f4f4f4;
                padding: 4px 8px;
                border-radius: 4px;
                font-family: 'Courier New', monospace;
              }
              .next-steps {
                text-align: left;
                margin-top: 30px;
                padding: 20px;
                background: #f9f9f9;
                border-radius: 5px;
              }
              .next-steps h3 { margin-top: 0; }
              .next-steps ol { padding-left: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Successfully Connected!</h1>
              <p>Your Google Analytics account is now connected to Arnold.</p>
              
              <div class="next-steps">
                <h3>📋 Next Steps:</h3>
                <ol>
                  <li>Return to Slack</li>
                  <li>Use <code>/arnold-property 509119162</code> to set your property</li>
                  <li>Start asking Arnold questions!</li>
                </ol>
              </div>
              
              <p style="margin-top: 30px; color: #666; font-size: 14px;">
                You can close this window now.
              </p>
            </div>
          </body>
        </html>
      `);
      
    } else {
      throw new Error('Failed to store tokens');
    }
    
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Error Storing Credentials</h1>
          <p>We received your authorization but couldn't save it.</p>
          <p>Please try again with <code>/arnold-connect</code> in Slack.</p>
          <p style="color: #666; font-size: 12px;">Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

// ==========================================
// INTERACTIVE COMPONENTS (Property Selection)
// ==========================================

// Handle interactive button/menu clicks
app.post('/slack/interactions', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  
  if (payload.type === 'block_actions') {
    const action = payload.actions[0];
    
    if (action.action_id === 'select_property') {
      const selectedProperty = action.selected_option.value;
      const userId = payload.user.id;
      
      try {
        // Update property in MCP server
        await axios.patch(
          `${process.env.MCP_SERVER_URL}/users/${userId}/property`,
          { propertyId: selectedProperty },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': process.env.MCP_API_KEY
            }
          }
        );
        
        // Acknowledge the action
        res.json({
          response_type: 'ephemeral',
          replace_original: false,
          text: `✅ Property set to: ${selectedProperty}\n\nYou can now ask Arnold questions like:\n• "Show me active users by country this month"\n• "What's my traffic from last week?"\n• "Top 10 pages by views"`
        });
        
      } catch (error) {
        res.json({
          response_type: 'ephemeral',
          text: '❌ Error setting property. Please try again.'
        });
      }
    }
  }
  
  // Acknowledge other interactions
  if (!res.headersSent) {
    res.sendStatus(200);
  }
});

// ==========================================
// APP MENTIONS & MESSAGES
// ==========================================

// Handle @Arnold mentions
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  
  // Respond to Slack's challenge for verification
  if (type === 'url_verification') {
    return res.json({ challenge });
  }
  
  // Acknowledge event immediately
  res.sendStatus(200);
  
  // Process event asynchronously
  if (event && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text;
    const channel = event.channel;
    
    console.log(`User ${userId} mentioned Arnold: ${text}`);
    
    // Trigger n8n workflow
    try {
      await axios.post(process.env.N8N_WEBHOOK_URL, {
        user_id: userId,
        message: text,
        channel: channel,
        event_type: 'app_mention'
      });
    } catch (error) {
      console.error('Error triggering n8n:', error);
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Arnold Slack Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 OAuth callback: ${process.env.GOOGLE_REDIRECT_URI}`);
});
