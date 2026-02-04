import express from 'express';
import axios from 'axios';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
import { saveInstallation, getBotToken } from './db.js';

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

// Helper function to send Slack message with workspace-specific token
async function sendSlackMessage(channel, blocks, teamId = null) {
  try {
    // If teamId is provided, get the bot token for that team
    // If not, fall back to the default token (for backward compatibility)
    let botToken = process.env.SLACK_BOT_TOKEN;
    
    if (teamId) {
      const teamToken = await getBotToken(teamId);
      if (teamToken) {
        botToken = teamToken;
      }
    }
    
    const response = await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channel,
        blocks: blocks
      },
      {
        headers: {
          'Authorization': `Bearer ${botToken}`,
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


// Home tab helper function
async function publishHomeView(teamId, userId) {
  try {
    const botToken = await getBotToken(teamId);
    if (!botToken) {
      console.error(`No bot token found for team ${teamId}`);
      return;
    }

    await axios.post(
      'https://slack.com/api/views.publish',
      {
        user_id: userId,
        view: {
          type: 'home',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `👋 *Welcome to Arnold*\n\nHit the *Messages* tab at the top to query your *GA4 data* directly in Slack.`
              }
            },
            {
              type: 'context',
              elements: [
                {
                  type: 'mrkdwn',
                  text: 'Tip: You can ask questions in DMs or mention @Arnold in a channel.'
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`🏠 Home view published for user ${userId}`);
  } catch (error) {
    console.error(
      'Error publishing Home view:',
      error.response?.data || error.message
    );
  }
}


// Send onboarding DM to installing user
async function sendOnboardingDM(botToken, userId) {
  try {
    const dmRes = await axios.post(
      'https://slack.com/api/conversations.open',
      { users: userId },
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!dmRes.data.ok) {
      console.error('Failed to open DM:', dmRes.data.error);
      return;
    }

    const channelId = dmRes.data.channel.id;

    await axios.post(
      'https://slack.com/api/chat.postMessage',
      {
        channel: channelId,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text:
`👋 *Welcome to Arnold The Analyst*

Arnold lets you ask questions about your *Google Analytics (GA4)* data directly in Slack.

*Step 1: Connect To Your GA4 Data*
Execute the \`/arnold-connect\` command to sign in using Google OAuth and connect your GA4 properties.

*Step 2: Select a GA4 property*
Execute the \`/arnold-property\` command. You will then be able to select any GA4 property you have access to here using a dropdown.

*Step 3: Ask a question using @Arnold*
You can ask Arnold questions in this DM thread, or in any channel after inviting the app to the channel by using the \`/invite\` command. For example:
"@Arnold how many visits did we have last month?"

*Step 4: Create a dedicated channel and invite your colleagues!*
Arnold works best when your team explores insights together.
Create a shared channel, (e.g. #arnold-the-analyst), invite Arnold via the \`/invite\` command along with your teammates to start getting fast, shared answers from your GA4 data.

⛔ Arnold won't work until you've signed in via Google OAuth. Remember to execute /arnold-connect.

Enjoy talking to your GA4 data 🤗`
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Onboarding DM sent to user ${userId}`);
  } catch (err) {
    console.error('Error sending onboarding DM:', err.response?.data || err.message);
  }
}


// Helper function to get team ID from user context
// This will be passed from Slack webhook payloads
async function getTeamIdFromRequest(req) {
  // Slack sends team_id in most webhook payloads
  return req.body.team_id || req.body.team?.id || null;
}

// ==========================================
// SLACK SLASH COMMANDS
// ==========================================

// /arnold-connect command
app.post('/slack/commands/connect', async (req, res) => {
  const { user_id, user_name, team_id } = req.body;
  
  console.log(`User ${user_name} (${user_id}) from team ${team_id} requested to connect Google Analytics`);
  
  // Generate Google OAuth URL with user's Slack ID as state
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/analytics.readonly',
      'https://www.googleapis.com/auth/analytics.manage.users.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent',
    state: `${user_id}:${team_id}` // Pass both user ID and team ID
  });
  
  // Send ephemeral message to user with connect button
  res.json({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '👋 *Connect your Google Analytics account to get started with Arnold!*'
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

// /arnold-property command (with dropdown support)
app.post('/slack/commands/property', async (req, res) => {
  const { user_id, text, team_id } = req.body;
  const propertyId = text.trim();
  
  // If user provided a property ID, set it directly (manual mode)
  if (propertyId) {
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
      
      return res.json({
        response_type: 'ephemeral',
        text: `✅ Property set to: \`${formattedPropertyId}\`\n\nYou're all set! Ask Arnold a question like:\n"@Arnold show me sessions by country last week"`
      });
      
    } catch (error) {
      return res.json({
        response_type: 'ephemeral',
        text: `❌ Error: ${error.message}`
      });
    }
  }
  
  // No property ID provided - fetch properties and show dropdown
  console.log(`User ${user_id} from team ${team_id} requested property dropdown`);
  
  // Acknowledge immediately
  res.json({
    response_type: 'ephemeral',
    text: '🔍 Fetching your GA4 properties...'
  });
  
  // Fetch properties and send dropdown asynchronously
  try {
    const propertiesResponse = await axios.get(
      `${process.env.MCP_SERVER_URL}/users/${user_id}/properties`,
      {
        headers: {
          'X-API-Key': process.env.MCP_API_KEY
        }
      }
    );
    
    if (propertiesResponse.data.success && propertiesResponse.data.properties.length > 0) {
      const properties = propertiesResponse.data.properties;
      
      console.log(`Found ${properties.length} properties for user ${user_id}`);
      
      // Build dropdown options
      const options = properties.map(prop => ({
        text: {
          type: 'plain_text',
          text: `${prop.name} (${prop.account})`,
          emoji: true
        },
        value: prop.id
      }));
      
      // Send interactive message with team-specific token
      await sendSlackMessage(user_id, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🎯 *Select Your GA4 Property*\n\nChoose which property you\'d like Arnold to analyze:'
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
              text: `Found ${properties.length} ${properties.length === 1 ? 'property' : 'properties'} • You can also set manually with \`/arnold-property properties/123456789\``
            }
          ]
        }
      ], team_id);
      
    } else {
      // No properties found
      console.log('No properties found for user');
      await sendSlackMessage(user_id, [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '⚠️ *No GA4 Properties Found*\n\nMake sure you\'ve connected your Google Analytics account first.\n\nUse `/arnold-connect` to link your account, or set your property manually:\n`/arnold-property properties/123456789`'
          }
        }
      ], team_id);
    }
  } catch (error) {
    console.error('Error fetching properties for dropdown:', error.response?.data || error.message);
    
    await sendSlackMessage(user_id, [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '❌ *Error Fetching Properties*\n\nCouldn\'t retrieve your GA4 properties. Please try again or set manually:\n`/arnold-property properties/123456789`\n\nIf you haven\'t connected yet, use `/arnold-connect` first.'
        }
      }
    ], team_id);
  }
});

// /arnold-bigquery-connect command
app.post('/slack/commands/bigquery-connect', async (req, res) => {
  const { user_id, user_name, team_id } = req.body;
  
  console.log(`User ${user_name} (${user_id}) from team ${team_id} requested to connect BigQuery`);
  
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
      
      // Send interactive message with team-specific token
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
      ], team_id);
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
      ], team_id);
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
    ], team_id);
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
  
  // Extract user ID and team ID from state
  const [slackUserId, teamId] = state ? state.split(':') : [null, null];
  
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
  
  if (!slackUserId || !teamId) {
    return res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Invalid Request</h1>
          <p>Missing user or team information.</p>
        </body>
      </html>
    `);
  }
  
  try {
    console.log(`Processing OAuth callback for user ${slackUserId} in team ${teamId}`);
    
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
      
      // Send property selector to Slack with correct team token
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
        console.log(`Sending property dropdown to user ${slackUserId} in team ${teamId}`);
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
        ], teamId);
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
        ], teamId);
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
// SLACK OAUTH CALLBACK (App Installation)
// ==========================================

app.get('/oauth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    console.error('Slack OAuth error:', error);
    return res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Installation Failed</h1>
          <p>There was an error installing Arnold The Analyst.</p>
          <p>Error: ${error}</p>
        </body>
      </html>
    `);
  }

  try {
    console.log('Processing Slack OAuth callback...');
    
    // Exchange the code for an access token
    const response = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      null,
      {
        params: {
          client_id: process.env.SLACK_CLIENT_ID,
          client_secret: process.env.SLACK_CLIENT_SECRET,
          code: code,
          redirect_uri: `${process.env.BASE_URL}/oauth/callback`
        }
      }
    );

    const data = response.data;

    if (!data.ok) {
      console.error('Slack OAuth API error:', data.error);
      return res.send(`
        <html>
          <body style="font-family: Arial; text-align: center; padding: 50px;">
            <h1>❌ Installation Failed</h1>
            <p>Could not complete installation.</p>
            <p>Error: ${data.error}</p>
          </body>
        </html>
      `);
    }

    // Store the installation data
    const installation = {
      teamId: data.team.id,
      teamName: data.team.name,
      botUserId: data.bot_user_id,
      accessToken: data.access_token,
      scope: data.scope,
      installedBy: data.authed_user.id,
      installedAt: new Date().toISOString()
    };

    console.log('App installed successfully:', {
      team: installation.teamName,
      teamId: installation.teamId,
      installedBy: installation.installedBy
    });

    // Save installation to database
    try {
      await saveInstallation(installation);
      console.log('✅ Installation saved to database');
    } catch (dbError) {
      console.error('❌ Error saving installation to database:', dbError);
      // Continue anyway - the installation still worked
    }

    // Send onboarding DM to installing user
    await sendOnboardingDM(data.access_token, installation.installedBy);

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
        p { line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎉 Arnold The Analyst Installed!</h1>
        <p><strong>${installation.teamName}</strong> workspace is now connected to Arnold.</p>

        <div style="margin: 30px 0;">
          <p style="font-size: 16px;">
            We’ve sent you a <strong>direct message in Slack</strong> with exact next steps (bottom left :)
          </p>
        </div>

        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          You can close this window and return to Slack.
        </p>
      </div>
    </body>
  </html>
`);


  } catch (error) {
    console.error('Slack OAuth callback error:', error);
    res.send(`
      <html>
        <body style="font-family: Arial; text-align: center; padding: 50px;">
          <h1>❌ Installation Error</h1>
          <p>An unexpected error occurred during installation.</p>
          <p style="color: #666; font-size: 12px;">Error: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

// ==========================================
// INTERACTIVE COMPONENTS
// ==========================================

app.post('/slack/interactions', async (req, res) => {
  const payload = JSON.parse(req.body.payload);
  
  res.sendStatus(200);
  
  if (payload.type === 'block_actions') {
    const action = payload.actions[0];
    const teamId = payload.team?.id;
    
    if (action.action_id === 'select_property') {
      const selectedPropertyId = action.selected_option.value;
      const selectedPropertyName = action.selected_option.text.text;
      const userId = payload.user.id;
      
      console.log(`User ${userId} from team ${teamId} selected property: ${selectedPropertyId}`);
      
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
              text: '🚀 *You\'re all set!*"'
            }
          }
        ], teamId);
        
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
        ], teamId);
      }
    }
    
    if (action.action_id === 'select_bigquery_dataset') {
      const selectedDataset = action.selected_option.value;
      const selectedDatasetName = action.selected_option.text.text;
      const userId = payload.user.id;
      
      console.log(`User ${userId} from team ${teamId} selected BigQuery dataset: ${selectedDataset}`);
      
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
        ], teamId);
        
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
        ], teamId);
      }
    }
  }
});

// ==========================================
// APP MENTIONS & MESSAGES
// ==========================================

app.post('/slack/events', async (req, res) => {
  const { type, challenge, event, team_id } = req.body;
  
  if (type === 'url_verification') {
    return res.json({ challenge });
  }
  
  res.sendStatus(200);

    if (event && event.type === 'app_home_opened') {
    const userId = event.user;
    const teamId = team_id || event.team;

    console.log(`🏠 app_home_opened by user ${userId} in team ${teamId}`);

    // Publish a Home view every time the Home tab is opened
    await publishHomeView(teamId, userId);

    return;
  }
  
  if (event && event.type === 'app_mention') {
    const userId = event.user;
    const text = event.text;
    const channel = event.channel;
    const ts = event.ts;
    
    const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();
    
    console.log(`User ${userId} from team ${team_id} mentioned Arnold: ${text}`);
    
    let botToken;
    try {
      botToken = await getBotToken(team_id);
      if (!botToken) {
        console.error(`No bot token found for team ${team_id}`);
        return;
      }
    } catch (error) {
      console.error('Error fetching bot token:', error);
      return;
    }
    
    try {
      await axios.post(process.env.N8N_WEBHOOK_URL, {
        user_id: userId,
        message: cleanText,
        original_message: text,
        channel: channel,
        ts: ts,
        team_id: team_id,
        bot_token: botToken,
        event_type: 'app_mention'
      });
    } catch (error) {
      console.error('Error triggering n8n:', error);
    }
  }
  
  if (event && event.type === 'message' && event.subtype === undefined) {
    if (event.bot_id) {
      return;
    }
    
    const userId = event.user;
    const text = event.text;
    const channel = event.channel;
    const ts = event.ts;
    
    if (event.channel_type === 'im' || text.match(/arnold/i)) {
      const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();
      
      console.log(`User ${userId} from team ${team_id} messaged: ${text}`);
      
      let botToken;
      try {
        botToken = await getBotToken(team_id);
        if (!botToken) {
          console.error(`No bot token found for team ${team_id}`);
          return;
        }
      } catch (error) {
        console.error('Error fetching bot token:', error);
        return;
      }
      
      try {
        await axios.post(process.env.N8N_WEBHOOK_URL, {
          user_id: userId,
          message: cleanText,
          original_message: text,
          channel: channel,
          ts: ts,
          team_id: team_id,
          bot_token: botToken,
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
  console.log(`🔗 Google OAuth callback: ${process.env.GOOGLE_REDIRECT_URI}`);
  console.log(`🔗 Slack OAuth callback: ${process.env.BASE_URL}/slack/oauth/callback`);
});
