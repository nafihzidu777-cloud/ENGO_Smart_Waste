const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

async function seedUsers() {
  const users = await prisma.user.count();
  if (users === 0) {
    const mockUsers = [
      { systemId: 'USER-001', name: 'User 1', containerId: 'CTR-4471' },
      { systemId: 'USER-002', name: 'User 2', containerId: 'CTR-4472' },
      { systemId: 'USER-003', name: 'User 3', containerId: 'CTR-4473' },
      { systemId: 'USER-004', name: 'User 4', containerId: 'CTR-4474' },
      { systemId: 'USER-005', name: 'User 5', containerId: 'CTR-4475' },
      { systemId: 'USER-006', name: 'User 6', containerId: 'CTR-4476' },
    ];
    for (const u of mockUsers) {
      await prisma.user.create({ data: u });
    }
    console.log('Database seeded with mock users.');
  }
}
seedUsers();

// Sync endpoint from Simulation
app.post('/api/sync', async (req, res) => {
  const { eventType, users, lastTransaction } = req.body;
  if (eventType === 'SIMULATION_UPDATE') {
    if (lastTransaction) {
      const user = await prisma.user.findUnique({ where: { systemId: lastTransaction.userId } });
      if (user) {
        await prisma.transaction.create({
          data: {
            userId: user.id,
            stationId: lastTransaction.stationId,
            scenario: lastTransaction.scenario,
            weight: lastTransaction.weight,
            credits: lastTransaction.credits,
            fines: lastTransaction.fines,
            timestamp: new Date(lastTransaction.timestamp)
          }
        });
        await prisma.user.update({
          where: { id: user.id },
          data: {
            credits: { increment: lastTransaction.credits },
            fines: { increment: lastTransaction.fines },
            verifiedMass: { increment: lastTransaction.weight }
          }
        });
      }
    }
    
    // Broadcast via socket.io
    const allUsers = await prisma.user.findMany({ include: { transactions: { orderBy: { timestamp: 'desc' } } } });
    const payload = {
       eventType: "SIMULATION_UPDATE",
       users: allUsers.map(u => ({
          id: u.systemId,
          name: u.name,
          containerId: u.containerId,
          signal: 'IDLE',
          credits: u.credits,
          fines: u.fines,
          currentWeightKg: u.verifiedMass,
          history: u.transactions,
          cleanDrops: u.transactions.filter(t => t.scenario === 'organic').length,
          contamDrops: u.transactions.filter(t => t.scenario !== 'organic').length
       })),
       lastTransaction
    };
    io.emit('state_update', payload);

    if (lastTransaction) {
      emitSSE('deposit', {
        outcome: lastTransaction.scenario === 'organic' ? 'ACCEPTED' : 'FLAGGED',
        purity: lastTransaction.scenario === 'organic' ? 1.0 : 0.8,
        credits: lastTransaction.credits,
        verifiedKg: lastTransaction.weight,
        scoreAfter: 850,
        scoreDelta: 5,
        xpGained: 10,
        flags: []
      });
    }

    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Unknown event' });
  }
});

// Admin endpoints
app.get('/api/admin/state', async (req, res) => {
    const allUsers = await prisma.user.findMany({ include: { transactions: { orderBy: { timestamp: 'desc' } } } });
    res.json({
       eventType: "SIMULATION_UPDATE",
       users: allUsers.map(u => ({
          id: u.systemId,
          name: u.name,
          containerId: u.containerId,
          signal: 'IDLE',
          credits: u.credits,
          fines: u.fines,
          currentWeightKg: u.verifiedMass,
          history: u.transactions,
          cleanDrops: u.transactions.filter(t => t.scenario === 'organic').length,
          contamDrops: u.transactions.filter(t => t.scenario !== 'organic').length
       })),
       lastTransaction: null
    });
});

// SSE Endpoints for User Dashboard
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  clients.add(res);
  req.on('close', () => clients.delete(res));
});
function emitSSE(event, data) {
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

// User Dashboard Mock APIs
app.get('/api/me', async (req, res) => {
  const u = await prisma.user.findUnique({ where: { systemId: 'USER-001' }, include: { transactions: true } });
  if (!u) return res.status(404).json({ error: 'User not found' });
  const accepted = u.transactions.filter(t => t.scenario === 'organic').length;
  const flagged = u.transactions.filter(t => t.scenario !== 'organic').length;
  const verifiedMass = u.verifiedMass || 0;
  res.json({
    id: u.systemId,
    displayName: u.name,
    status: 'ACTIVE',
    penalties: u.transactions.filter(t => t.scenario !== 'organic').map((t, i) => ({
      id: t.id,
      strike: i + 1,
      type: 'Contamination',
      reason: 'Hidden inorganic material detected',
      status: 'ACTIVE'
    })),
    bins: [{ binId: u.containerId || 'CTR-4471', status: 'ACTIVE', lastPairedAt: new Date().toISOString(), lastDockId: 'DOCK-01' }],
    impact: { kg: verifiedMass, co2eKg: verifiedMass * 0.4, biogasM3: verifiedMass * 0.1, kwh: verifiedMass * 0.5 },
    totals: { accepted, partial: 0, rejected: 0, flagged, deposits: u.transactions.length },
    badges: [{ id: 'first_drop', earned: accepted > 0, title: 'First Drop' }],
    showOnLeaderboard: true,
    score: 850 + (accepted * 5) - (flagged * 10),
    credits: u.credits
  });
});
app.get('/api/me/deposits', async (req, res) => {
  const u = await prisma.user.findUnique({ where: { systemId: 'USER-001' }, include: { transactions: { orderBy: { timestamp: 'desc' } } } });
  if (!u) return res.json({ items: [] });
  res.json({
    items: u.transactions.map(t => ({
      outcome: t.scenario === 'organic' ? 'ACCEPTED' : 'FLAGGED',
      dockId: t.stationId,
      at: t.timestamp,
      purity: t.scenario === 'organic' ? 1.0 : 0.8,
      verifiedKg: t.weight,
      credits: t.credits,
      scoreDelta: t.scenario === 'organic' ? 5 : -10,
      flags: []
    }))
  });
});
app.get('/api/me/penalties', async (req, res) => {
  const u = await prisma.user.findUnique({ where: { systemId: 'USER-001' }, include: { transactions: { where: { scenario: { not: 'organic' } }, orderBy: { timestamp: 'desc' } } } });
  if (!u) return res.json({ items: [] });
  res.json({
    items: u.transactions.map((t, i) => ({
      id: t.id,
      strike: i + 1,
      type: 'Contamination',
      reason: 'Hidden inorganic material detected',
      status: 'ACTIVE',
      createdAt: t.timestamp,
      creditsDeducted: 0,
      scoreApplied: -10
    }))
  });
});
app.post('/api/me/penalties/:id/pay', async (req, res) => {
  const trans = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!trans) return res.status(404).json({ error: 'Penalty not found' });
  const u = await prisma.user.findUnique({ where: { id: trans.userId } });
  
  if (!u || u.credits < 500) return res.status(400).json({ error: 'Not enough credits' });
  
  // Deduct 500 credits and clear the penalty by deleting it
  await prisma.user.update({
    where: { id: u.id },
    data: { credits: { decrement: 500 }, fines: { decrement: 1 } }
  });
  await prisma.transaction.delete({ where: { id: req.params.id } });
  
  // Broadcast update
  const allUsers = await prisma.user.findMany({ include: { transactions: { orderBy: { timestamp: 'desc' } } } });
  io.emit('state_update', {
    eventType: "SIMULATION_UPDATE",
    users: allUsers.map(user => ({
      id: user.systemId, name: user.name, containerId: user.containerId, signal: 'IDLE',
      credits: user.credits, fines: user.fines, currentWeightKg: user.verifiedMass, history: user.transactions,
      cleanDrops: user.transactions.filter(t => t.scenario === 'organic').length,
      contamDrops: user.transactions.filter(t => t.scenario !== 'organic').length
    })),
    lastTransaction: null
  });
  
  res.json({ success: true });
});
app.get('/api/me/sessions', async (req, res) => {
  res.json({ items: [] });
});
app.get('/api/me/notifications', async (req, res) => {
  res.json({ items: [] });
});
app.get('/api/leaderboard', async (req, res) => {
  const allUsers = await prisma.user.findMany({ orderBy: { verifiedMass: 'desc' } });
  res.json({
    month: "September",
    top: allUsers.map((u, i) => ({
      rank: i + 1,
      name: u.name,
      tier: i === 0 ? 'Gold' : 'Silver',
      kg: u.verifiedMass,
      deposits: 1,
      isMe: u.systemId === 'USER-001'
    })),
    me: allUsers.find(u => u.systemId === 'USER-001') ? {
      rank: allUsers.findIndex(u => u.systemId === 'USER-001') + 1,
      name: 'User 1',
      tier: 'Silver',
      kg: allUsers.find(u => u.systemId === 'USER-001').verifiedMass,
      deposits: 1,
      isMe: true
    } : null
  });
});
app.post('/api/auth/login', async (req, res) => {
  res.json({ success: true });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
});

const PORT = process.env.PORT || 3005;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
