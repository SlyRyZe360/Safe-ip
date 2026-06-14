const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_FILE = path.join(__dirname, 'visitors.json');

// Auth — set ADMIN_PASSWORD env var to change, default is 'admin123'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = require('crypto').randomBytes(32).toString('hex'); // generated fresh each restart

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace('Bearer ', '').trim();
  if (token === ADMIN_TOKEN) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize log file
if (!fs.existsSync(LOG_FILE)) {
  fs.writeFileSync(LOG_FILE, JSON.stringify([], null, 2));
}

function readVisitors() {
  try {
    return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveVisitors(data) {
  fs.writeFileSync(LOG_FILE, JSON.stringify(data, null, 2));
}

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return (
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

// Track visitor endpoint
app.post('/api/track', async (req, res) => {
  const ip = getClientIP(req);
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const referrer = req.headers['referer'] || req.body?.referrer || 'Direct';
  const page = req.body?.page || '/';

  // Fetch geo info from free API
  let geoData = {
    country: 'Unknown',
    regionName: 'Unknown',
    city: 'Unknown',
    isp: 'Unknown',
    lat: null,
    lon: null,
    timezone: 'Unknown',
    org: 'Unknown',
  };

  try {
    const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,isp,lat,lon,timezone,org`);
    const geoJson = await geoRes.json();
    if (geoJson.status === 'success') {
      geoData = geoJson;
    }
  } catch (err) {
    // fallback if geo lookup fails
  }

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    ip,
    timestamp: new Date().toISOString(),
    userAgent,
    referrer,
    page,
    country: geoData.country,
    region: geoData.regionName,
    city: geoData.city,
    isp: geoData.isp,
    lat: geoData.lat,
    lon: geoData.lon,
    timezone: geoData.timezone,
    org: geoData.org,
  };

  const visitors = readVisitors();
  visitors.unshift(record); // newest first
  saveVisitors(visitors);

  console.log(`[${new Date().toLocaleTimeString()}] New visitor: ${ip} from ${geoData.city}, ${geoData.country}`);
  res.json({ success: true, id: record.id });
});

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ success: false, error: 'Invalid password' });
  }
});

// Get all visitors (protected)
app.get('/api/visitors', requireAuth, (req, res) => {
  const visitors = readVisitors();
  res.json(visitors);
});

// Get stats (protected)
app.get('/api/stats', requireAuth, (req, res) => {
  const visitors = readVisitors();
  const uniqueIPs = new Set(visitors.map(v => v.ip)).size;
  const countries = {};
  const cities = {};
  const isps = {};
  const hourly = {};

  visitors.forEach(v => {
    countries[v.country] = (countries[v.country] || 0) + 1;
    cities[v.city] = (cities[v.city] || 0) + 1;
    isps[v.isp] = (isps[v.isp] || 0) + 1;
    const hour = new Date(v.timestamp).getHours();
    hourly[hour] = (hourly[hour] || 0) + 1;
  });

  res.json({
    total: visitors.length,
    uniqueIPs,
    countries: Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 10),
    cities: Object.entries(cities).sort((a, b) => b[1] - a[1]).slice(0, 10),
    isps: Object.entries(isps).sort((a, b) => b[1] - a[1]).slice(0, 5),
    hourly,
    recentVisitors: visitors.slice(0, 5),
  });
});

// Clear logs (protected)
app.delete('/api/visitors', requireAuth, (req, res) => {
  saveVisitors([]);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n🌐 IP Tracker running at http://localhost:${PORT}`);
  console.log(`🔐 Login: http://localhost:${PORT}/login.html`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard.html`);
  console.log(`🔍 Tracking page: http://localhost:${PORT}/index.html`);
  console.log(`🔑 Admin password: ${ADMIN_PASSWORD}\n`);
});
