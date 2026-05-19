const STORAGE_KEY = "p2p-operation-panel-v1";

const defaultState = {
  partners: [
    { id: "p1", name: "Ortak 1", share: 50 },
    { id: "p2", name: "Ortak 2", share: 50 },
  ],
  purchases: [],
  sales: [],
};

let state = structuredClone(defaultState);
let supabaseClient = null;
let currentUser = null;
let isCloudMode = false;

const $ = (selector) => document.querySelector(selector);
const fmtTry = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 6 });
const fmtRate = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 4 });
const fmtMoneyInput = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function hasSupabaseConfig() {
  const config = window.P2P_SUPABASE;
  return Boolean(
    config?.url &&
      config?.anonKey &&
      !config.url.includes("BURAYA") &&
      !config.anonKey.includes("BURAYA")
  );
}

function initSupabase() {
  if (!hasSupabaseConfig() || !window.supabase?.createClient) return;
  supabaseClient = window.supabase.createClient(window.P2P_SUPABASE.url, window.P2P_SUPABASE.anonKey);
  isCloudMode = true;
}

function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(defaultState);
  try {
    return { ...structuredClone(defaultState), ...JSON.parse(saved) };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setDefaultDates() {
  const now = new Date();
  const value = toLocalInputValue(now);
  $("#purchaseForm [name='createdAt']").value = value;
  $("#saleForm [name='soldAt']").value = value;
}

function resetForm(selector) {
  const form = $(selector);
  if (form) form.reset();
}

function parseMoney(value) {
  const normalized = String(value || "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Number(normalized) || 0;
}

function formatMoneyValue(value) {
  return fmtMoneyInput.format(Number(value) || 0);
}

function formatMoneyInput(input) {
  if (!input || input.value === "") return;
  input.value = formatMoneyValue(parseMoney(input.value));
}

function updateSaleCalculations() {
  const form = $("#saleForm");
  if (!form) return;
  const usdt = Number(form.elements.usdtAmount.value || 0);
  const received = parseMoney(form.elements.tryReceived.value);
  const saleRate = Number(String(form.elements.saleRate.value || "0").replace(",", ".")) || 0;
  const expected = usdt * saleRate;
  const fee = Math.max(0, expected - received);
  form.elements.expectedTry.value = formatMoneyValue(expected);
  form.elements.fee.value = formatMoneyValue(fee);
}

function toLocalInputValue(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function unlockDate(item) {
  return new Date(new Date(item.createdAt).getTime() + 48 * 60 * 60 * 1000);
}

function getPurchaseStatus(item) {
  if (item.transferred) return "moved";
  return unlockDate(item) <= new Date() ? "ready" : "locked";
}

function statusText(status, item) {
  if (status === "moved") return "Aktarıldı";
  if (status === "ready") return "Hazır";
  const hours = Math.max(0, Math.ceil((unlockDate(item) - new Date()) / 3600000));
  return `${hours}s kaldı`;
}

function totals() {
  const totalTry = state.purchases.reduce((sum, item) => sum + Number(item.tryAmount), 0);
  const totalUsdt = state.purchases.reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const lockedUsdt = state.purchases
    .filter((item) => getPurchaseStatus(item) === "locked")
    .reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const readyUsdt = state.purchases
    .filter((item) => getPurchaseStatus(item) === "ready")
    .reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const transferredUsdt = state.purchases
    .filter((item) => item.transferred)
    .reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const soldUsdt = state.sales.reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const netRevenue = state.sales.reduce((sum, item) => sum + Number(item.tryReceived), 0);
  const fees = state.sales.reduce((sum, item) => sum + Number(item.fee || 0), 0);
  const grossRevenue = netRevenue + fees;
  const costOfSold = totalUsdt > 0 ? (totalTry / totalUsdt) * soldUsdt : 0;
  const netProfit = netRevenue - costOfSold;
  const availableInventory = Math.max(0, transferredUsdt - soldUsdt);

  return {
    totalTry,
    totalUsdt,
    lockedUsdt,
    readyUsdt,
    transferredUsdt,
    soldUsdt,
    grossRevenue,
    fees,
    netRevenue,
    costOfSold,
    netProfit,
    availableInventory,
    avgBuyRate: totalUsdt > 0 ? totalTry / totalUsdt : 0,
    avgSellRate: soldUsdt > 0 ? netRevenue / soldUsdt : 0,
  };
}

function render() {
  const data = totals();

  $("#totalTry").textContent = fmtTry.format(data.totalTry);
  $("#avgBuyRate").textContent = `Ortalama alış: ${fmtRate.format(data.avgBuyRate)}`;
  $("#lockedUsdt").textContent = `${fmtNum.format(data.lockedUsdt)} USDT`;
  $("#readyUsdt").textContent = `${fmtNum.format(data.readyUsdt)} USDT`;
  $("#transferredUsdt").textContent = `Binance'a aktarılan: ${fmtNum.format(data.transferredUsdt)}`;
  $("#netProfit").textContent = fmtTry.format(data.netProfit);

  const readyCount = state.purchases.filter((item) => getPurchaseStatus(item) === "ready").length;
  $("#readyCount").textContent = `${readyCount} işlem hazır`;
  $("#profitPerPartner").textContent = state.partners
    .map((partner) => `${partner.name}: ${fmtTry.format(data.netProfit * (Number(partner.share) / 100))}`)
    .join(" | ");

  const nextLocked = state.purchases
    .filter((item) => getPurchaseStatus(item) === "locked")
    .sort((a, b) => unlockDate(a) - unlockDate(b))[0];
  $("#nextUnlock").textContent = nextLocked ? `Sıradaki: ${unlockDate(nextLocked).toLocaleString("tr-TR")}` : "Sıradaki çözülme yok";

  $("#flowBought").textContent = fmtNum.format(data.totalUsdt);
  $("#flowLocked").textContent = fmtNum.format(data.lockedUsdt);
  $("#flowReady").textContent = fmtNum.format(data.readyUsdt);
  $("#flowSold").textContent = fmtNum.format(data.soldUsdt);

  renderPartners(data);
  renderPurchases();
  renderSales();
  renderLedger(data);
  syncPartnerForm();
  updateModeView();
}

function updateModeView() {
  $("#syncStatus").textContent = isCloudMode
    ? currentUser
      ? `Bulut: ${currentUser.email}`
      : "Bulut girişi gerekli"
    : "Yerel mod";
  $("#authPanel").hidden = !isCloudMode || Boolean(currentUser);
  $("#logoutBtn").hidden = !isCloudMode || !currentUser;
  document.querySelectorAll("main section:not(.auth-panel), .nav, .side-panel").forEach((element) => {
    element.classList.toggle("is-disabled", isCloudMode && !currentUser);
  });
}

function renderPartners(data) {
  $("#partnerCards").innerHTML = state.partners
    .map((partner) => {
      const partnerPurchases = state.purchases.filter((item) => item.partnerId === partner.id);
      const capital = partnerPurchases.reduce((sum, item) => sum + Number(item.tryAmount), 0);
      const usdt = partnerPurchases.reduce((sum, item) => sum + Number(item.usdtAmount), 0);
      const profitShare = data.netProfit * (Number(partner.share) / 100);
      return `
        <article class="partner-card">
          <header>
            <strong>${escapeHtml(partner.name)}</strong>
            <small>%${partner.share} pay</small>
          </header>
          <div class="mini-grid">
            <div><span>Sermaye</span><b>${fmtTry.format(capital)}</b></div>
            <div><span>USDT alımı</span><b>${fmtNum.format(usdt)}</b></div>
            <div><span>Kâr payı</span><b>${fmtTry.format(profitShare)}</b></div>
            <div><span>Toplam hakediş</span><b>${fmtTry.format(capital + profitShare)}</b></div>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderPurchases() {
  $("#purchaseRows").innerHTML = state.purchases
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => {
      const status = getPurchaseStatus(item);
      const rate = Number(item.tryAmount) / Number(item.usdtAmount || 1);
      const transferButton =
        status === "ready"
          ? `<button class="small-action" title="Binance'a aktarıldı olarak işaretle" data-transfer="${item.id}">✓</button>`
          : "";
      return `
        <tr>
          <td>${escapeHtml(purchaseSourceName(item))}</td>
          <td>${escapeHtml(item.platform)}</td>
          <td>${fmtTry.format(Number(item.tryAmount))}</td>
          <td>${fmtNum.format(Number(item.usdtAmount))}</td>
          <td>${fmtRate.format(rate)}</td>
          <td><span class="pill ${status}">${statusText(status, item)}</span></td>
          <td>
            <span class="row-actions">
              ${transferButton}
              <button class="small-action" title="Sil" data-delete-purchase="${item.id}">×</button>
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

function purchaseSourceName(item) {
  if (item.partnerId === "cash") return "Kasa";
  const partner = state.partners.find((p) => p.id === item.partnerId);
  return partner?.name || item.partner || "Bilinmiyor";
}

function renderSales() {
  $("#saleRows").innerHTML = state.sales
    .slice()
    .sort((a, b) => new Date(b.soldAt) - new Date(a.soldAt))
    .map((item) => {
      const received = Number(item.tryReceived);
      const fee = Number(item.fee || 0);
      const gross = received + fee;
      const saleRate = gross / Number(item.usdtAmount || 1);
      const netRate = received / Number(item.usdtAmount || 1);
      return `
        <tr>
          <td>${new Date(item.soldAt).toLocaleString("tr-TR")}</td>
          <td>${fmtNum.format(Number(item.usdtAmount))}</td>
          <td>${fmtTry.format(received)}</td>
          <td>${fmtTry.format(fee)}</td>
          <td>${fmtRate.format(saleRate)}</td>
          <td>${fmtRate.format(netRate)}</td>
          <td><button class="small-action" title="Sil" data-delete-sale="${item.id}">×</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderLedger(data) {
  const cashPurchases = state.purchases.filter((item) => item.partnerId === "cash");
  const cashTry = cashPurchases.reduce((sum, item) => sum + Number(item.tryAmount), 0);
  const cashUsdt = cashPurchases.reduce((sum, item) => sum + Number(item.usdtAmount), 0);
  const items = [
    ["Toplam USDT", `${fmtNum.format(data.totalUsdt)} USDT`],
    ["Binance stok", `${fmtNum.format(data.availableInventory)} USDT`],
    ["Kasa alımı", fmtTry.format(cashTry)],
    ["Kasa USDT", `${fmtNum.format(cashUsdt)} USDT`],
    ["Net tahsilat", fmtTry.format(data.netRevenue)],
    ["Satış ortalaması", fmtRate.format(data.avgSellRate)],
    ["Satılan maliyeti", fmtTry.format(data.costOfSold)],
    ["Toplam masraf", fmtTry.format(data.fees)],
    ["Brüt tahsilat", fmtTry.format(data.grossRevenue)],
    ["Kalan maliyet", fmtTry.format(Math.max(0, data.totalTry - data.costOfSold))],
  ];

  $("#ledger").innerHTML = items
    .map(([label, value]) => `<div class="ledger-item"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function syncPartnerForm() {
  $("#partnerForm [name='p1Name']").value = state.partners[0].name;
  $("#partnerForm [name='p1Share']").value = state.partners[0].share;
  $("#partnerForm [name='p2Name']").value = state.partners[1].name;
  $("#partnerForm [name='p2Share']").value = state.partners[1].share;

  const purchaseSelect = $("#purchaseForm [name='partner']");
  purchaseSelect.innerHTML = [
    ...state.partners.map((partner) => `<option value="${partner.id}">${escapeHtml(partner.name)}</option>`),
    `<option value="cash">Kasa</option>`,
  ].join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return entities[char];
  });
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDbPurchase(item) {
  return {
    id: item.id,
    user_id: currentUser.id,
    partner_id: item.partnerId,
    platform: item.platform,
    try_amount: item.tryAmount,
    usdt_amount: item.usdtAmount,
    created_at: item.createdAt,
    note: item.note || null,
    transferred: Boolean(item.transferred),
  };
}

function fromDbPurchase(item) {
  return {
    id: item.id,
    partnerId: item.partner_id,
    platform: item.platform,
    tryAmount: Number(item.try_amount),
    usdtAmount: Number(item.usdt_amount),
    createdAt: item.created_at,
    note: item.note || "",
    transferred: Boolean(item.transferred),
  };
}

function toDbSale(item) {
  return {
    id: item.id,
    user_id: currentUser.id,
    usdt_amount: item.usdtAmount,
    try_received: item.tryReceived,
    fee: item.fee || 0,
    sold_at: item.soldAt,
    buyer: item.buyer || null,
  };
}

function fromDbSale(item) {
  return {
    id: item.id,
    usdtAmount: Number(item.usdt_amount),
    tryReceived: Number(item.try_received),
    fee: Number(item.fee || 0),
    soldAt: item.sold_at,
    buyer: item.buyer || "",
  };
}

async function loadCloudState() {
  const [partnersResult, purchasesResult, salesResult] = await Promise.all([
    supabaseClient.from("partners").select("*").order("id"),
    supabaseClient.from("purchases").select("*").order("created_at", { ascending: false }),
    supabaseClient.from("sales").select("*").order("sold_at", { ascending: false }),
  ]);

  const error = partnersResult.error || purchasesResult.error || salesResult.error;
  if (error) throw error;

  let partners = partnersResult.data.map((item) => ({
    id: item.id,
    name: item.name,
    share: Number(item.share),
  }));

  if (partners.length === 0) {
    await supabaseClient.from("partners").upsert(
      defaultState.partners.map((partner) => ({
        id: partner.id,
        user_id: currentUser.id,
        name: partner.name,
        share: partner.share,
      }))
    );
    partners = structuredClone(defaultState.partners);
  }

  state = {
    partners,
    purchases: purchasesResult.data.map(fromDbPurchase),
    sales: salesResult.data.map(fromDbSale),
  };
}

async function persistPurchase(item) {
  if (!isCloudMode) {
    saveLocalState();
    return;
  }
  const { error } = await supabaseClient.from("purchases").upsert(toDbPurchase(item));
  if (error) throw error;
}

async function persistSale(item) {
  if (!isCloudMode) {
    saveLocalState();
    return;
  }
  const { error } = await supabaseClient.from("sales").upsert(toDbSale(item));
  if (error) throw error;
}

async function persistPartners() {
  if (!isCloudMode) {
    saveLocalState();
    return;
  }
  const rows = state.partners.map((partner) => ({
    id: partner.id,
    user_id: currentUser.id,
    name: partner.name,
    share: partner.share,
  }));
  const { error } = await supabaseClient.from("partners").upsert(rows);
  if (error) throw error;
}

async function deleteCloudRow(table, id) {
  if (!isCloudMode) {
    saveLocalState();
    return;
  }
  const { error } = await supabaseClient.from(table).delete().eq("id", id);
  if (error) throw error;
}

async function requireCloudReady() {
  if (isCloudMode && !currentUser) {
    alert("Önce Supabase hesabıyla giriş yapmalısın.");
    throw new Error("Login required");
  }
}

$("#purchaseForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requireCloudReady();
    const form = new FormData($("#purchaseForm"));
    const item = {
      id: uid("buy"),
      partnerId: form.get("partner"),
      platform: form.get("platform"),
      tryAmount: parseMoney(form.get("tryAmount")),
      usdtAmount: Number(form.get("usdtAmount")),
      createdAt: new Date(form.get("createdAt")).toISOString(),
      note: form.get("note"),
      transferred: false,
    };
    state.purchases.push(item);
    await persistPurchase(item);
    resetForm("#purchaseForm");
    setDefaultDates();
    render();
  } catch (error) {
    showError(error);
  }
});

$("#saleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requireCloudReady();
    const form = new FormData($("#saleForm"));
    const usdtAmount = Number(form.get("usdtAmount"));
    const tryReceived = parseMoney(form.get("tryReceived"));
    const saleRate = Number(String(form.get("saleRate") || "0").replace(",", ".")) || 0;
    const expected = usdtAmount * saleRate;
    const item = {
      id: uid("sale"),
      usdtAmount,
      tryReceived,
      fee: Math.max(0, expected - tryReceived),
      soldAt: new Date(form.get("soldAt")).toISOString(),
      buyer: form.get("buyer"),
    };
    state.sales.push(item);
    await persistSale(item);
    resetForm("#saleForm");
    setDefaultDates();
    render();
  } catch (error) {
    showError(error);
  }
});

$("#partnerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await requireCloudReady();
    const form = new FormData(event.currentTarget);
    const p1Share = Number(form.get("p1Share"));
    const p2Share = Number(form.get("p2Share"));
    if (p1Share + p2Share !== 100) {
      alert("Ortak payları toplamı 100 olmalı.");
      return;
    }
    state.partners = [
      { id: "p1", name: form.get("p1Name"), share: p1Share },
      { id: "p2", name: form.get("p2Name"), share: p2Share },
    ];
    await persistPartners();
    render();
  } catch (error) {
    showError(error);
  }
});

document.body.addEventListener("click", async (event) => {
  const transferId = event.target.dataset.transfer;
  const deletePurchaseId = event.target.dataset.deletePurchase;
  const deleteSaleId = event.target.dataset.deleteSale;

  try {
    if (transferId) {
      await requireCloudReady();
      const purchase = state.purchases.find((item) => item.id === transferId);
      if (purchase) {
        purchase.transferred = true;
        await persistPurchase(purchase);
      }
      render();
    }

    if (deletePurchaseId && confirm("Bu alım kaydı silinsin mi?")) {
      await requireCloudReady();
      state.purchases = state.purchases.filter((item) => item.id !== deletePurchaseId);
      await deleteCloudRow("purchases", deletePurchaseId);
      render();
    }

    if (deleteSaleId && confirm("Bu satış kaydı silinsin mi?")) {
      await requireCloudReady();
      state.sales = state.sales.filter((item) => item.id !== deleteSaleId);
      await deleteCloudRow("sales", deleteSaleId);
      render();
    }
  } catch (error) {
    showError(error);
  }
});

$("#exportBtn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aydkripto-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

$("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await requireCloudReady();
    const imported = JSON.parse(await file.text());
    if (!Array.isArray(imported.partners) || !Array.isArray(imported.purchases) || !Array.isArray(imported.sales)) {
      throw new Error("Geçersiz dosya");
    }
    state = imported;
    if (isCloudMode) {
      await persistPartners();
      await Promise.all(state.purchases.map(persistPurchase));
      await Promise.all(state.sales.map(persistSale));
    } else {
      saveLocalState();
    }
    render();
  } catch (error) {
    showError(error, "Dosya okunamadı.");
  } finally {
    event.target.value = "";
  }
});

$("#resetBtn").addEventListener("click", async () => {
  if (!confirm("Tüm panel verileri silinsin mi?")) return;
  try {
    await requireCloudReady();
    if (isCloudMode) {
      await Promise.all([
        supabaseClient.from("purchases").delete().neq("id", ""),
        supabaseClient.from("sales").delete().neq("id", ""),
        supabaseClient.from("partners").delete().neq("id", ""),
      ]);
    }
    state = structuredClone(defaultState);
    if (isCloudMode) await persistPartners();
    saveLocalState();
    setDefaultDates();
    render();
  } catch (error) {
    showError(error);
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  await signIn(form.get("email"), form.get("password"));
});

$("#signupBtn").addEventListener("click", async () => {
  const form = new FormData($("#loginForm"));
  await signUp(form.get("email"), form.get("password"));
});

$("#logoutBtn").addEventListener("click", async () => {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  state = structuredClone(defaultState);
  render();
});

document.querySelectorAll(".money-input").forEach((input) => {
  input.addEventListener("blur", () => {
    formatMoneyInput(input);
    updateSaleCalculations();
  });
});

document.querySelectorAll(".sale-calc").forEach((input) => {
  input.addEventListener("input", updateSaleCalculations);
});

document.querySelectorAll(".nav a").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav a").forEach((item) => item.classList.remove("active"));
    link.classList.add("active");
  });
});

async function signIn(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    $("#authMessage").textContent = "";
    await loadCloudState();
    render();
  } catch (error) {
    showError(error, "Giriş yapılamadı.");
  }
}

async function signUp(email, password) {
  try {
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
      },
    });
    if (error) throw error;
    currentUser = data.user;
    $("#authMessage").textContent = "Hesap oluşturuldu. E-posta onayı açıksa gelen kutunu kontrol et.";
    if (currentUser) {
      await loadCloudState();
      render();
    }
  } catch (error) {
    showError(error, "Hesap oluşturulamadı.");
  }
}

function showError(error, fallback = "İşlem tamamlanamadı.") {
  if (error?.message === "Login required") return;
  console.error(error);
  alert(error?.message || fallback);
}

async function boot() {
  initSupabase();
  setDefaultDates();

  if (!isCloudMode) {
    state = loadLocalState();
    render();
    setInterval(render, 60000);
    return;
  }

  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  if (currentUser) {
    try {
      await loadCloudState();
    } catch (error) {
      showError(error);
    }
  }
  render();
  setInterval(render, 60000);
}

boot();
