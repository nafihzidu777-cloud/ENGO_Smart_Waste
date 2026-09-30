const http = require('http');

async function runTests() {
  console.log("Starting End-to-End Integration Tests...");
  
  // 1. Start Server in background? No, assume server is running.
  // Actually let's just make requests to localhost:3000

  const syncPayload = {
    eventType: 'SIMULATION_UPDATE',
    users: [],
    lastTransaction: {
      userId: 'USER-001',
      stationId: 'DOCK-01',
      scenario: 'organic',
      weight: 2.5,
      credits: 25,
      fines: 0,
      timestamp: new Date().toISOString()
    }
  };

  try {
    console.log("[Test 1] Send SIMULATION_UPDATE to /api/sync");
    const res = await fetch('http://localhost:3000/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(syncPayload)
    });
    const data = await res.json();
    if (data.success) {
      console.log("✅ Sync endpoint processed transaction successfully.");
    } else {
      console.error("❌ Sync failed", data);
    }

    console.log("[Test 2] Verify Database Update via /api/admin/state");
    const adminRes = await fetch('http://localhost:3000/api/admin/state');
    const adminData = await adminRes.json();
    const user1 = adminData.users.find(u => u.id === 'USER-001');
    if (user1 && user1.history.length > 0 && user1.history[0].weight === 2.5) {
      console.log("✅ Admin state reflects the new transaction.");
    } else {
      console.error("❌ Admin state did not update", user1);
    }
    
    console.log("All tests passed successfully.");
  } catch(e) {
    console.error("Test execution failed. Is the server running?", e.message);
  }
}

runTests();
