const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cron = require('node-cron');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const multer = require('multer');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Data Directory
const DATA_DIR = '/app/data';
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR)
    },
    filename: function (req, file, cb) {
        cb(null, 'broadcast_image' + path.extname(file.originalname))
    }
});
const upload = multer({ storage: storage });

// State
let qrCodeData = null;
let clientStatus = 'Disconnected'; // Disconnected, Initializing, Ready
let clientReady = false;

// Default Config
const defaultConfig = {
    schedules: {
        sun_thu: "08:00",
        fri: "08:00",
        sat: "20:00"
    },
    message: "Hello! This is a broadcast message.",
    imagePath: null,
    targetGroups: [] // List of Group IDs
};

// Load Config
function loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
    return defaultConfig;
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // <- this one doesn't works in Windows
            '--disable-gpu'
        ],
    }
});

client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    qrcode.toDataURL(qr, (err, url) => {
        qrCodeData = url;
        clientStatus = 'Scan QR Code';
    });
});

client.on('ready', () => {
    console.log('Client is ready!');
    clientStatus = 'Connected';
    clientReady = true;
    qrCodeData = null;
});

client.on('authenticated', () => {
    console.log('AUTHENTICATED');
    clientStatus = 'Authenticated';
});

client.on('auth_failure', msg => {
    console.error('AUTHENTICATION FAILURE', msg);
    clientStatus = 'Auth Failure';
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out', reason);
    clientStatus = 'Disconnected';
    clientReady = false;
    // Client usually tries to reinitialize, but we can force it if needed
    client.initialize();
});

// Confirmation Logic
const CONFIRMATION_NUMBER = '972508838662@c.us'; // 0508838662
let lastConfirmationMsgId = null;

async function sendConfirmationRequest() {
    if (!clientReady) {
        console.log('Client not ready, cannot send confirmation request.');
        return;
    }
    try {
        const msg = await client.sendMessage(CONFIRMATION_NUMBER, 'Should I run the automation? React with 👍 to confirm.');
        lastConfirmationMsgId = msg.id._serialized;
        console.log('Confirmation request sent. Msg ID:', lastConfirmationMsgId);
    } catch (error) {
        console.error('Error sending confirmation request:', error);
    }
}

// Reaction Listener
client.on('message_reaction', async (reaction) => {
    console.log('Reaction received:', reaction);

    // Check if it's the confirmation message
    if (reaction.msgId._serialized === lastConfirmationMsgId) {
        // Check if reaction is '👍' (thumbs up)
        // Note: reaction.reaction might be the emoji itself
        if (reaction.reaction === '👍') {
            console.log('Confirmation received! Starting broadcast...');
            await runBroadcast();
            lastConfirmationMsgId = null; // Reset to avoid double trigger
        }
    }
});

async function runBroadcast() {
    const config = loadConfig();
    const groups = config.targetGroups;
    const text = config.message;
    const imagePath = config.imagePath;

    let media = null;
    if (imagePath && fs.existsSync(imagePath)) {
        media = MessageMedia.fromFilePath(imagePath);
    }

    console.log(`Starting broadcast to ${groups.length} groups...`);

    // 1. Send to Groups
    for (const groupId of groups) {
        try {
            if (media) {
                await client.sendMessage(groupId, media, { caption: text });
            } else {
                await client.sendMessage(groupId, text);
            }
            console.log(`Sent to group ${groupId}`);
            // Small delay to avoid spam detection
            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            console.error(`Failed to send to group ${groupId}:`, error);
        }
    }

    // 2. Upload to Status (Story)
    // Note: whatsapp-web.js might not fully support status upload in all versions, 
    // but sendMessage to 'status@broadcast' is the standard way.
    try {
        if (media) {
            await client.sendMessage('status@broadcast', media, { caption: text });
            console.log('Uploaded to Status');
        } else {
            await client.sendMessage('status@broadcast', text, { backgroundColor: '#FF0000' }); // Text status needs options
            console.log('Uploaded Text to Status');
        }
    } catch (error) {
        console.error('Failed to upload to status:', error);
    }
}

// Scheduler
// Check every minute
cron.schedule('* * * * *', () => {
    const config = loadConfig();
    const now = moment().tz("Asia/Jerusalem");
    const currentDay = now.day(); // 0 (Sun) - 6 (Sat)
    const currentTime = now.format("HH:mm");

    console.log(`Scheduler Tick: ${now.format("dddd HH:mm")}`);

    let targetTime = null;

    if (currentDay === 6) { // Saturday
        targetTime = config.schedules.sat;
    } else if (currentDay === 5) { // Friday
        targetTime = config.schedules.fri;
    } else { // Sun - Thu
        targetTime = config.schedules.sun_thu;
    }

    if (currentTime === targetTime) {
        console.log('Time match! Sending confirmation request.');
        sendConfirmationRequest();
    }
});


// API Endpoints

app.get('/status', (req, res) => {
    res.json({ status: clientStatus, ready: clientReady });
});

app.get('/qr', (req, res) => {
    res.json({ qr: qrCodeData });
});

app.get('/groups', async (req, res) => {
    console.log('GET /groups called');
    if (!clientReady) {
        console.log('Client not ready, returning empty list');
        return res.json([]);
    }
    try {
        console.log('Fetching chats...');
        const chats = await client.getChats();
        console.log(`Fetched ${chats.length} chats`);
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(chat => ({ id: chat.id._serialized, name: chat.name }));
        console.log(`Filtered ${groups.length} groups`);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

app.get('/config', (req, res) => {
    res.json(loadConfig());
});

app.post('/config', upload.single('image'), (req, res) => {
    const currentConfig = loadConfig();
    const newConfig = {
        ...currentConfig,
        ...JSON.parse(req.body.data)
    };

    if (req.file) {
        newConfig.imagePath = req.file.path;
    }

    saveConfig(newConfig);
    res.json({ success: true, config: newConfig });
});

app.post('/broadcast', async (req, res) => {
    if (!clientReady) {
        return res.status(400).json({ error: 'Client not ready' });
    }
    runBroadcast(); // Async, don't wait
    res.json({ success: true, message: 'Broadcast started' });
});

// Start Server
app.listen(port, () => {
    console.log(`Backend API listening at http://localhost:${port}`);
    client.initialize();
});
