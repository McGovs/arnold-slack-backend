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

// Helper function to send Slack message
async function sendSlackMessage(channel, blocks) {
  try {
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channel,
        blocks: blocks
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (!response.data.ok) {
      console.error('Slack API error:', response.data.error);
    } else {
      console.log(`Slack message sent to ${channel}`);
    }
  } catch (error) {
    console.error('Error sending Slack message:', error.response?.data || error.message);
  }
}

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
      'https://www.googleapis.com/auth/analytics.manage.users.readonly',
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
      const bigqueryDataset = response.data.bigqueryDataset;
      
      res.json({
        response_type: 'ephemeral',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Google Analytics Connected*\n\n• Status: ${isExpired ? '⚠️ Token expired - please reconnect' : '✅ Active'}\n• GA4 Property: ${propertyId || '⚠️ Not set'}\n• BigQuery Dataset: ${bigqueryDataset || '⚠️ Not set'}`
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

// /arnold-property command (manual fallback)
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

// /arnold-bigquery-connect command
app.post('/slack/commands/bigquery-connect', async (req, res) => {
  const { user_id, user_name } = req.body;
  
  console.log(`User ${user_name} (${user_id}) requested to connect BigQuery`);
  
  // Acknowledge immediately
  res.json({
    response_type: 'ephemeral',
    text: '🔍 Fetching your BigQuery datasets...'
  });
  
  // Fetch datasets and send dropdown asynchronously
  try {
    const datasetsResponse = await axios.get(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/datasets`,
      {
        headers: {
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    if (datasetsResponse.data.success && datasetsResponse.data.datasets.length > 0) {
      const datasets = datasetsResponse.data.datasets;
      
      // Build dropdown options
      const options = datasets.map(ds => ({
        text: {
          type: 'plain_text',
          text: `${ds.name} (${ds.projectId})`,
          emoji: true
        },
        value: ds.fullPath
      }));
      
      // Send interactive message
      await sendSlackMessage(user_id, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '📊 *Select Your BigQuery Dataset*\n\nChoose which dataset Arnold should use for SQL queries:'
          }
        },
        {
          type: 'actions',
          block_id: 'bigquery_dataset_selection',
          elements: [
            {
              type: 'static_select',
              action_id: 'select_bigquery_dataset',
              placeholder: {
                type: 'plain_text',
                text: 'Select a dataset...',
                emoji: true
              },
              options: options.slice(0, 100)
            }
          ]
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Found ${datasets.length} ${datasets.length === 1 ? 'dataset' : 'datasets'} accessible by Arnold's service account`
            }
          ]
        }
      ]);
    } else {
      // No datasets found
      await sendSlackMessage(user_id, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '⚠️ *No BigQuery Datasets Found*\n\nMake sure you\'ve granted Arnold\'s service account access to your BigQuery datasets.\n\nService Account:\n`' + (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || 'Check Railway for service account email') + '`\n\nOr set manually:\n`/arnold-bigquery-dataset project-id.dataset_id`'
          }
        }
      ]);
    }
  } catch (error) {
    console.error('Error fetching datasets:', error);
    await sendSlackMessage(user_id, [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '❌ *Error Fetching Datasets*\n\nCouldn\'t retrieve BigQuery datasets. Please try again or set manually:\n`/arnold-bigquery-dataset project-id.dataset_id`'
        }
      }
    ]);
  }
});

// /arnold-bigquery-dataset command (manual fallback)
app.post('/slack/commands/bigquery-dataset', async (req, res) => {
  const { user_id, text } = req.body;
  const dataset = text.trim();
  
  if (!dataset) {
    return res.json({
      response_type: 'ephemeral',
      text: 'Usage: `/arnold-bigquery-dataset project-id.dataset_id`\n\nExample: `/arnold-bigquery-dataset bigquery-public-data.ga4_obfuscated_sample_ecommerce`'
    });
  }
  
  try {
    await axios.patch(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/dataset`,
      { dataset: dataset },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    res.json({
      response_type: 'ephemeral',
      text: `✅ BigQuery dataset set to: \`${dataset}\`\n\nArnold will use this dataset for SQL queries.\n\nYou can reference tables like:\n\`${dataset}.events_*\``
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
        propertyId: null // Will be set after user selects from dropdown
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
      
      // Fetch user's GA4 properties
      let properties = [];
      let fetchError = null;
      
      try {
        console.log('Fetching properties from MCP server...');
        const propertiesResponse = await axios.get(
          `${process.env.MCP_SERVER_URL}/users/${slackUserId}/properties`,
          {
            headers: {
              'X-API-Key': process.env.MCP_API_KEY
            }
          }
        );
        
        if (propertiesResponse.data.success) {
          properties = propertiesResponse.data.properties;
          console.log(`Found ${properties.length} properties for user ${slackUserId}`);
        } else {
          fetchError = propertiesResponse.data.error;
          console.error('MCP server returned error:', fetchError);
        }
      } catch (error) {
        fetchError = error.response?.data?.error || error.message;
        console.error('Error fetching properties:', fetchError);
      }
      
      // Send property selector to Slack
      if (properties.length > 0) {
        // Build dropdown options
        const options = properties.map(prop => ({
          text: {
            type: 'plain_text',
            text: `${prop.name} (${prop.account})`,
            emoji: true
          },
          value: prop.id
        }));
        
        // Send interactive message to user's DM
        console.log(`Sending property dropdown to user ${slackUserId}`);
        await sendSlackMessage(slackUserId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🎉 *Google Analytics Connected Successfully!*\n\nPlease select which Google Analytics property you\'d like Arnold to use:'
            }
          },
          {
            type: 'actions',
            block_id: 'property_selection',
            elements: [
              {
                type: 'static_select',
                action_id: 'select_property',
                placeholder: {
                  type: 'plain_text',
                  text: 'Select a property...',
                  emoji: true
                },
                options: options.slice(0, 100) // Slack limit
              }
            ]
          },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: `Found ${properties.length} ${properties.length === 1 ? 'property' : 'properties'}`
              }
            ]
          }
        ]);
      } else {
        // No properties found or error - send manual setup message
        console.log('No properties found, sending manual setup instructions');
        await sendSlackMessage(slackUserId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `⚠️ *Google Analytics Connected*\n\n${fetchError ? `Error: ${fetchError}\n\n` : ''}We couldn\'t automatically find your GA4 properties. Please set your property manually:\n\n\`/arnold-property properties/509119162\`\n\n*(Replace with your actual property ID)*`
            }
          }
        ]);
      }
      
      // Success page
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
              p { line-width: 1.6; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✅ Successfully Connected!</h1>
              <p>Your Google Analytics account is now connected to Arnold.</p>
              <p style="margin-top: 30px;">
                <strong>Return to Slack</strong> ${properties.length > 0 ? 'to select your GA4 property from the dropdown' : 'and use /arnold-property to set your property ID'}.
              </p>
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
// INTERACTIVE COMPONENTS (Property & Dataset Selection)
// ==========================================

// Handle interactive button/menu clicks
app.post('/slack/interactions', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  
  // Acknowledge immediately
  res.sendStatus(200);
  
  if (payload.type === 'block_actions') {
    const action = payload.actions[0];
    
    // GA4 Property Selection
    if (action.action_id === 'select_property') {
      const selectedPropertyId = action.selected_option.value;
      const selectedPropertyName = action.selected_option.text.text;
      const userId = payload.user.id;
      
      console.log(`User ${userId} selected property: ${selectedPropertyId}`);
      
      try {
        await axios.patch(
          `${process.env.MCP_SERVER_URL}/users/${userId}/property`,
          { propertyId: selectedPropertyId },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': process.env.MCP_API_KEY
            }
          }
        );
        
        await sendSlackMessage(userId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *Property Set Successfully!*\n\n${selectedPropertyName}\n\`${selectedPropertyId}\``
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '🚀 *You\'re all set!* Try asking Arnold:\n• "@Arnold show me sessions last month"\n• "@Arnold top 10 pages by views"\n• "@Arnold users by country this week"'
            }
          }
        ]);
        
      } catch (error) {
        console.error('Error setting property:', error);
        await sendSlackMessage(userId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ *Error setting property*\n\nPlease try again or use `/arnold-property YOUR_ID` manually.'
            }
          }
        ]);
      }
    }
    
    // BigQuery Dataset Selection
    if (action.action_id === 'select_bigquery_dataset') {
      const selectedDataset = action.selected_option.value;
      const selectedDatasetName = action.selected_option.text.text;
      const userId = payload.user.id;
      
      console.log(`User ${userId} selected BigQuery dataset: ${selectedDataset}`);
      
      try {
        await axios.patch(
          `${process.env.MCP_SERVER_URL}/users/${userId}/dataset`,
          { dataset: selectedDataset },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': process.env.MCP_API_KEY
            }
          }
        );
        
        await sendSlackMessage(userId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ *BigQuery Dataset Set Successfully!*\n\n${selectedDatasetName}\n\`${selectedDataset}\``
            }
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `🚀 *Ready for SQL queries!*\n\nYou can now ask Arnold to query this dataset:\n• "@Arnold #bigquery show me top events"\n• "@Arnold #bigquery count users by country"\n\nArnold will automatically use:\n\`${selectedDataset}.events_*\``
            }
          }
        ]);
        
      } catch (error) {
        console.error('Error setting dataset:', error);
        await sendSlackMessage(userId, [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '❌ *Error setting dataset*\n\nPlease try again or use `/arnold-bigquery-dataset YOUR_DATASET` manually.'
            }
          }
        ]);
      }
    }
  }
});

// ==========================================
// APP MENTIONS & MESSAGES
// ==========================================

// Handle @Arnold mentions and regular messages
app.post('/slack/events', async (req, res) => {
  const { type, challenge, event } = req.body;
  
  // Respond to Slack's challenge for verification
  if (type === 'url_verification') {
    return res.json({ challenge });
  }
  
  // Acknowledge event immediately
  res.sendStatus(200);
  
  // Process @Arnold mentions
  if (event && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text;
    const channel = event.channel;
    const ts = event.ts;
    
    // Clean the message - remove user mentions
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    console.log(`User ${userId} mentioned Arnold: ${text}`);
    
    // Trigger n8n workflow
    try {
      await axios.post(process.env.N8N_WEBHOOK_URL, {
        user_id: userId,
        message: cleanText,
        original_message: text,
        channel: channel,
        ts: ts,
        event_type: 'app_mention'
      });
    } catch (error) {
      console.error('Error triggering n8n:', error);
    }
  }
  
  // Handle regular messages (not just mentions)
  if (event && event.type === 'message' && event.subtype === undefined) {
    // Ignore messages from bots (including Arnold himself)
    if (event.bot_id) {
      return;
    }
    
    const userId = event.user;
    const text = event.text;
    const channel = event.channel;
    const ts = event.ts;
    
    // Only process if Arnold is mentioned or in DM
    if (text.includes('arnold') || text.includes('Arnold') || event.channel_type === 'im') {
      // Clean the message - remove user mentions
      const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();
      
      console.log(`User ${userId} messaged: ${text}`);
      
      try {
        await axios.post(process.env.N8N_WEBHOOK_URL, {
          user_id: userId,
          message: cleanText,
          original_message: text,
          channel: channel,
          ts: ts,
          event_type: 'message'
        });
      } catch (error) {
        console.error('Error triggering n8n:', error);
      }
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Arnold Slack Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 OAuth callback: ${process.env.GOOGLE_REDIRECT_URI}`);
});
