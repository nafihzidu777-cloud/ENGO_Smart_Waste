let simState = null;
let currentUser = null;
let isAdmin = false;
let qualityChart = null;

// DOM Elements
const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const loginBtn = document.getElementById('login-btn');
const loginAdminBtn = document.getElementById('login-admin-btn');
const logoutBtn = document.getElementById('logout-btn');
const userSelect = document.getElementById('login-user-select');
const connStatus = document.getElementById('conn-status');

// Helper to format date
const formatDate = (isoString) => {
  const d = new Date(isoString);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'});
};

// Initialize Chart
function initChart() {
  const ctx = document.getElementById('qualityChart').getContext('2d');
  qualityChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Clean Waste', 'Contaminated'],
      datasets: [{
        data: [0, 0],
        backgroundColor: ['#10b981', '#ef4444'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

// Navigation Logic
document.querySelectorAll('.sidebar-link').forEach(link => {
  link.addEventListener('click', (e) => {
    document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
    e.target.classList.add('active');
    
    document.querySelectorAll('.page-view').forEach(v => v.classList.add('hide'));
    const target = e.target.getAttribute('data-target');
    document.getElementById(`view-${target}`).classList.remove('hide');
    document.getElementById('page-title').innerText = e.target.innerText;
    
    // Auto close sidebar on mobile
    document.getElementById('sidebar').classList.add('-translate-x-full');
  });
});

function navTo(target) {
  document.querySelector(`[data-target='${target}']`).click();
}

// Data ingestion
function handleSimulationUpdate(data) {
  if (data.eventType !== "SIMULATION_UPDATE") return;
  simState = data;
  
  if (loginView.classList.contains('hide') === false) {
    connStatus.innerHTML = `<div class="w-2 h-2 rounded-full bg-green-500"></div> SYNCHRONIZED WITH SIMULATION`;
    connStatus.className = "mt-6 text-xs font-bold text-green-600 flex items-center justify-center gap-2";
  }

  updateUI();
}

// Setup real-time listener
function setupRealtime() { fetch('/api/admin/state').then(r=>r.json()).then(d=>handleSimulationUpdate(d)); const s=document.createElement('script'); s.src='/socket.io/socket.io.js'; s.onload=()=>{ io().on('state_update', d=>handleSimulationUpdate(d)) }; document.head.appendChild(s); }

// Login
loginBtn.addEventListener('click', () => {
  if (!simState) {
    alert("Please wait for simulation data to synchronize before logging in.");
    return;
  }
  const userId = userSelect.value;
  currentUser = simState.users.find(u => u.id === userId);
  if (currentUser) {
    isAdmin = false;
    document.getElementById('nav-admin-section').classList.add('hide');
    document.getElementById('nav-user-label').innerText = "USER PORTAL";
    finishLogin();
  }
});

loginAdminBtn.addEventListener('click', () => {
  if (!simState) {
    alert("Please wait for simulation data to synchronize before logging in.");
    return;
  }
  isAdmin = true;
  currentUser = null;
  document.getElementById('nav-admin-section').classList.remove('hide');
  document.getElementById('nav-user-label').innerText = "GENERAL PORTAL";
  finishLogin();
  navTo('admin');
});

function finishLogin() {
  loginView.classList.add('hide');
  appView.classList.remove('hide');
  if (qualityChart == null) initChart();
  updateUI();
}

logoutBtn.addEventListener('click', () => {
  appView.classList.add('hide');
  loginView.classList.remove('hide');
  currentUser = null;
  isAdmin = false;
  navTo('dashboard'); // reset view for next login
});

// Update entire UI
function updateUI() {
  if (!simState) return;

  // Render Sidebar profile
  if (isAdmin) {
    document.getElementById('user-avatar').innerText = "AD";
    document.getElementById('user-name').innerText = "System Admin";
    document.getElementById('user-bin').innerText = "ALL ACCESS";
  } else if (currentUser) {
    // refresh currentUser ref
    currentUser = simState.users.find(u => u.id === currentUser.id) || currentUser;
    document.getElementById('user-avatar').innerText = currentUser.name.charAt(0);
    document.getElementById('user-name').innerText = currentUser.name;
    document.getElementById('user-bin').innerText = currentUser.containerId || 'NO-BIN';
  }

  // Admin View
  if (isAdmin || true) {
    document.getElementById('adm-users').innerText = simState.users.length;
    let totalWaste = 0; let totalClean = 0; let totalContam = 0;
    const adminTbody = document.getElementById('admin-user-table');
    if(adminTbody) adminTbody.innerHTML = "";
    
    simState.users.forEach(u => {
      totalWaste += u.currentWeightKg;
      totalClean += u.cleanDrops || 0;
      totalContam += u.contamDrops || 0;
      
      if(adminTbody) {
        adminTbody.innerHTML += `
          <tr class="hover:bg-gray-50 border-b border-gray-100">
            <td class="p-3 font-mono font-bold text-gray-700">${u.id}</td>
            <td class="p-3 font-mono">${u.containerId || '--'}</td>
            <td class="p-3 text-right font-bold text-green-600">${u.credits}</td>
            <td class="p-3 text-right font-bold text-red-500">${u.fines}</td>
            <td class="p-3 text-right">${u.currentWeightKg.toFixed(2)}</td>
            <td class="p-3 text-center"><span class="bg-${u.signal === 'PAIRED' ? 'green' : 'gray'}-100 text-${u.signal === 'PAIRED' ? 'green' : 'gray'}-800 px-2 py-1 rounded text-xs font-bold">${u.signal || 'IDLE'}</span></td>
          </tr>
        `;
      }
    });
    
    document.getElementById('adm-waste').innerText = totalWaste.toFixed(2);
    document.getElementById('adm-clean').innerText = totalClean;
    document.getElementById('adm-contam').innerText = totalContam;
  }

  // Dashboard / User Views
  if (currentUser) {
    document.getElementById('dash-credits').innerText = currentUser.credits;
    document.getElementById('dash-fines').innerText = currentUser.fines;
    
    // Penalty Payment UI
    const payBtn = document.getElementById('pay-penalty-btn');
    if (payBtn) {
      if (currentUser.fines > 0 && currentUser.credits >= 500) {
        payBtn.classList.remove('hidden');
        payBtn.onclick = async () => {
          if (!confirm('Pay 500 credits to clear this penalty?')) return;
          try {
            // Find the most recent penalty transaction ID (or use a placeholder API if not present)
            const penTrans = currentUser.history.find(t => t.scenario !== 'organic');
            if(penTrans) {
              await fetch(`/api/me/penalties/${penTrans.id}/pay`, { method: 'POST' });
              // The server will emit state_update which refreshes UI automatically!
            } else {
              alert('Could not locate penalty record.');
            }
          } catch(e) {
            alert('Failed to pay penalty.');
          }
        };
      } else {
        payBtn.classList.add('hidden');
      }
    }

    document.getElementById('dash-waste').innerText = currentUser.currentWeightKg.toFixed(2);
    document.getElementById('dash-clean').innerText = currentUser.cleanDrops || 0;
    document.getElementById('dash-contam').innerText = currentUser.contamDrops || 0;
    
    // Bin visualization logic (assuming 10kg max capacity for visual)
    const capacity = 10; 
    let fillPct = Math.min(100, Math.max(0, (currentUser.currentWeightKg / capacity) * 100));
    // If it's over 10kg, it just stays at 100% full
    document.querySelectorAll('[id$="bin-pct"]').forEach(el => el.innerText = Math.round(fillPct) + "%");
    document.querySelectorAll('[id$="bin-fill"]').forEach(el => {
      el.style.height = fillPct + "%";
      el.className = "bin-fill " + (fillPct < 30 ? "low" : fillPct < 60 ? "moderate" : fillPct < 90 ? "high" : "full");
    });

    document.getElementById('dash-bin-id').innerText = currentUser.containerId || 'NO-BIN';

    // Chart
    if (qualityChart) {
      qualityChart.data.datasets[0].data = [currentUser.cleanDrops || 0, currentUser.contamDrops || 0];
      qualityChart.update();
    }

    // Activity Tables
    const actTbody = document.getElementById('dash-recent-activity');
    const fullActTbody = document.getElementById('activity-table');
    const credTbody = document.getElementById('credits-table');
    const fineTbody = document.getElementById('fines-table');
    
    if(actTbody) actTbody.innerHTML = "";
    if(fullActTbody) fullActTbody.innerHTML = "";
    if(credTbody) credTbody.innerHTML = "";
    if(fineTbody) fineTbody.innerHTML = "";
    
    let hasAct = false; let hasCred = false; let hasFine = false;
    
    // Process history backward
    const history = [...(currentUser.history || [])].reverse();
    
    history.forEach((tx, idx) => {
      hasAct = true;
      const isClean = tx.scenario !== 'contamination';
      const typeHtml = isClean ? `<span class="text-green-600 font-bold uppercase text-xs tracking-wider">Clean</span>` : `<span class="text-red-500 font-bold uppercase text-xs tracking-wider">Contaminated</span>`;
      
      const tr = `
        <tr class="hover:bg-gray-50">
          <td class="p-3 text-gray-500">${formatDate(tx.timestamp)}</td>
          <td class="p-3">${typeHtml}</td>
          <td class="p-3 text-right">${tx.weight.toFixed(2)} kg</td>
          <td class="p-3 text-right font-bold ${tx.credits > 0 ? 'text-green-600' : tx.fines > 0 ? 'text-red-500' : 'text-gray-400'}">${tx.credits > 0 ? '+'+tx.credits : (tx.fines > 0 ? '-Flag' : '0')}</td>
          <td class="p-3 font-mono text-gray-600">${tx.stationId}</td>
        </tr>
      `;
      if (idx < 5 && actTbody) actTbody.innerHTML += tr;
      if (fullActTbody) fullActTbody.innerHTML += tr;

      if (tx.credits > 0) {
        hasCred = true;
        if(credTbody) credTbody.innerHTML += `
          <tr class="hover:bg-gray-50">
            <td class="p-3 text-gray-500">${formatDate(tx.timestamp)}</td>
            <td class="p-3 font-medium">Clean Deposit verified at ${tx.stationId}</td>
            <td class="p-3 text-right font-bold text-green-600">+${tx.credits} CR</td>
          </tr>
        `;
      }
      if (tx.fines > 0) {
        hasFine = true;
        if(fineTbody) fineTbody.innerHTML += `
          <tr class="hover:bg-gray-50">
            <td class="p-3 text-gray-500">${formatDate(tx.timestamp)}</td>
            <td class="p-3 font-medium">Inorganic material detected at ${tx.stationId}</td>
            <td class="p-3 text-center font-bold text-red-500">1 Flag</td>
          </tr>
        `;
      }
    });
    
    document.getElementById('activity-empty').classList.toggle('hide', hasAct);
    document.getElementById('credits-empty').classList.toggle('hide', hasCred);
    document.getElementById('fines-empty').classList.toggle('hide', hasFine);

    // Profile & Bin detailed views
    document.getElementById('mybin-id').innerText = currentUser.containerId || '--';
    document.getElementById('mybin-user').innerText = currentUser.id;
    document.getElementById('mybin-tag').innerText = currentUser.tagUid || '--';
    document.getElementById('mybin-signal').innerText = currentUser.signal || 'IDLE';
    document.getElementById('mybin-sync').innerText = currentUser.lastSync || '--';
    
    document.getElementById('credits-total').innerText = currentUser.credits;
    document.getElementById('fines-total').innerText = currentUser.fines;
    
    document.getElementById('prof-avatar').innerText = currentUser.name.charAt(0);
    document.getElementById('prof-name').innerText = currentUser.name;
    document.getElementById('prof-id').innerText = currentUser.id;
    document.getElementById('prof-bin').innerText = currentUser.containerId || '--';
    document.getElementById('prof-cred').innerText = currentUser.credits;
    document.getElementById('prof-pen').innerText = currentUser.fines;
    const totalDrops = (currentUser.cleanDrops||0) + (currentUser.contamDrops||0);
    document.getElementById('prof-rate').innerText = totalDrops > 0 ? Math.round(((currentUser.cleanDrops||0) / totalDrops)*100) + "% Purity" : "0%";
  }

  // Leaderboard
  renderLeaderboard();

  // Docking & Twin View (global)
  if (simState.systemState) {
    const sys = simState.systemState;
    const dock = sys.dockState;
    if (dock) {
      document.getElementById('dock-id').innerText = dock.dockId || 'DOCK-01';
      document.getElementById('dock-state').innerText = dock.state || 'IDLE';
      document.getElementById('dock-state-badge').innerText = dock.state || 'IDLE';
      document.getElementById('dock-container').innerText = dock.container || '--';
      document.getElementById('dock-user').innerText = dock.user || '--';
      
      document.getElementById('dock-ble').innerText = dock.ble || '--';
      document.getElementById('dock-nfc').innerText = dock.nfc || '--';
      document.getElementById('dock-auth').innerText = dock.auth || '--';
      document.getElementById('dock-session').innerText = dock.session || '--';
      document.getElementById('dock-batch').innerText = dock.batch || '--';
      document.getElementById('dock-result').innerText = dock.result || '--';
    }
    
    // Twin View
    document.getElementById('twin-time').innerText = new Date().toLocaleTimeString();
    document.getElementById('twin-total-waste').innerText = ((sys.organicAccepted||0)*2.4 + (sys.inorganicRejected||0)*2.1).toFixed(1) + " kg";
    document.getElementById('twin-sump').innerText = Math.round(sys.sumpLevel || 0) + "%";
    document.getElementById('twin-sump-bg').style.height = Math.round(sys.sumpLevel || 0) + "%";
    document.getElementById('twin-mac').innerText = sys.macerator || 'OFF';
    document.getElementById('twin-mac').className = `text-2xl font-bold mt-1 ${sys.macerator === 'ON' ? 'text-green-400' : sys.macerator === 'STALLED' ? 'text-red-500' : sys.macerator === 'REVERSING' ? 'text-yellow-400' : 'text-gray-500'}`;
    
    document.getElementById('twin-div').innerText = sys.diverter || 'NEUTRAL';
    document.getElementById('twin-div').className = `text-xl font-bold mt-2 ${sys.diverter === 'ORGANIC' ? 'text-green-400' : sys.diverter === 'REJECTION' ? 'text-red-500' : 'text-gray-500'}`;

    document.getElementById('twin-hatch').innerText = sys.hatch || 'LOCKED';
    document.getElementById('twin-hatch').className = `font-mono font-bold text-lg ${sys.hatch === 'OPEN' ? 'text-green-400' : sys.hatch === 'READY' ? 'text-blue-400' : 'text-gray-500'}`;
    
    document.getElementById('twin-transferred').innerText = (sys.slurryTransferred || 0).toFixed(2) + " kg";
    
    // append mock logs based on lastTransaction if new
    if (simState.lastTransaction && (!window._lastTxId || window._lastTxId !== simState.lastTransaction.timestamp)) {
      window._lastTxId = simState.lastTransaction.timestamp;
      const txl = simState.lastTransaction;
      const isClean = txl.scenario !== 'contamination';
      appendTwinLog(`[${formatDate(txl.timestamp)}] EVENT: User ${txl.userId} deposited ${txl.weight.toFixed(2)}kg at ${txl.stationId}.`);
      if (isClean) {
        appendTwinLog(`[SYS] Scrutiny OK. Diverter: ORGANIC. Macerator ON.`);
        appendTwinLog(`[SYS] Slurry transfer +${txl.weight.toFixed(2)}kg.`);
        appendTwinLog(`[SYS] User credited +${txl.credits} CR.`);
      } else {
        appendTwinLog(`[WARN] Scrutiny FAILED. Contaminant detected.`);
        appendTwinLog(`[SYS] Diverter: REJECTION. Macerator protected.`);
        appendTwinLog(`[SYS] Penalty flag issued to ${txl.userId}.`);
      }
      
      // pop notification
      document.getElementById('notif-badge').classList.remove('hide');
    }
  }
}

function appendTwinLog(msg) {
  const box = document.getElementById('twin-logs');
  if(!box) return;
  const div = document.createElement('div');
  div.innerText = msg;
  if(msg.includes('[WARN]')) div.className = "text-red-400 mt-1";
  else if(msg.includes('[SYS]')) div.className = "text-green-400 mt-1";
  else div.className = "text-gray-300 mt-1";
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// Leaderboard Sort
document.getElementById('leaderboard-metric').addEventListener('change', renderLeaderboard);

function renderLeaderboard() {
  if (!simState || !simState.users) return;
  const metric = document.getElementById('leaderboard-metric').value;
  
  let sorted = [...simState.users].sort((a, b) => {
    if (metric === 'credits') return b.credits - a.credits;
    if (metric === 'waste') return b.currentWeightKg - a.currentWeightKg;
    if (metric === 'clean') return (b.cleanDrops||0) - (a.cleanDrops||0);
    if (metric === 'contam') {
      const aR = (a.cleanDrops||0)+(a.contamDrops||0) === 0 ? 0 : (a.contamDrops||0)/((a.cleanDrops||0)+(a.contamDrops||0));
      const bR = (b.cleanDrops||0)+(b.contamDrops||0) === 0 ? 0 : (b.contamDrops||0)/((b.cleanDrops||0)+(b.contamDrops||0));
      return aR - bR;
    }
    return 0;
  });

  const tbody = document.getElementById('leaderboard-table');
  if(tbody) {
    tbody.innerHTML = "";
    sorted.forEach((u, idx) => {
      const rankHtml = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1);
      const isMe = currentUser && currentUser.id === u.id;
      const totalDrops = (u.cleanDrops||0) + (u.contamDrops||0);
      const contamPct = totalDrops === 0 ? 0 : Math.round(((u.contamDrops||0)/totalDrops)*100);
      
      tbody.innerHTML += `
        <tr class="hover:bg-gray-50 border-b border-gray-100 cursor-pointer ${isMe ? 'bg-green-50/50 font-bold' : ''}" onclick="showLbProfile('${u.id}')">
          <td class="p-3 text-center text-lg">${rankHtml}</td>
          <td class="p-3 text-gray-800">${u.name} ${isMe ? '<span class="text-xs text-green-600 ml-1">(You)</span>' : ''}</td>
          <td class="p-3 text-right font-bold text-green-600">${u.credits}</td>
          <td class="p-3 text-right text-gray-700">${u.currentWeightKg.toFixed(2)}</td>
          <td class="p-3 text-right text-blue-600 font-bold">${u.cleanDrops||0}</td>
          <td class="p-3 text-right ${contamPct > 0 ? 'text-red-500' : 'text-gray-500'}">${contamPct}%</td>
        </tr>
      `;
    });
  }
}

window.showLbProfile = function(userId) {
  if (!simState) return;
  const u = simState.users.find(x => x.id === userId);
  if(!u) return;
  
  document.getElementById('lb-p-name').innerText = u.name;
  document.getElementById('lb-p-bin').innerText = u.containerId || '--';
  document.getElementById('lb-p-cred').innerText = u.credits;
  document.getElementById('lb-p-waste').innerText = u.currentWeightKg.toFixed(2) + " kg";
  document.getElementById('lb-p-clean').innerText = u.cleanDrops || 0;
  document.getElementById('lb-p-contam').innerText = u.contamDrops || 0;
  
  const totalDrops = (u.cleanDrops||0) + (u.contamDrops||0);
  document.getElementById('lb-p-pct').innerText = totalDrops === 0 ? "0%" : Math.round(((u.cleanDrops||0)/totalDrops)*100) + "%";
  
  // find rank by credits
  const sorted = [...simState.users].sort((a, b) => b.credits - a.credits);
  const rank = sorted.findIndex(x => x.id === userId) + 1;
  document.getElementById('lb-p-rank').innerText = "#" + rank;

  document.getElementById('lb-profile').classList.remove('hide');
};

// Start
setupRealtime();
