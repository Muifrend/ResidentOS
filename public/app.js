const state = {
  dashboard: null,
  tiersById: new Map(),
  subscribersById: new Map(),
};

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  paidCount: document.querySelector("#paidCount"),
  weeklyRevenue: document.querySelector("#weeklyRevenue"),
  flaggedCount: document.querySelector("#flaggedCount"),
  openDeliveries: document.querySelector("#openDeliveries"),
  eventList: document.querySelector("#eventList"),
  subscriberRows: document.querySelector("#subscriberRows"),
  paymentList: document.querySelector("#paymentList"),
  manifestList: document.querySelector("#manifestList"),
  sourceNotice: document.querySelector("#sourceNotice"),
  toast: document.querySelector("#toast"),
  refreshButton: document.querySelector("#refreshButton"),
  generateManifest: document.querySelector("#generateManifest"),
};

function money(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((Number(cents) || 0) / 100);
}

function timeAgo(value) {
  if (!value) return "";

  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.round(delta / 60000));

  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  return hours === 1 ? "1 hr ago" : `${hours} hrs ago`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  setTimeout(() => els.toast.classList.remove("visible"), 3000);
}

function statusBadge(status) {
  const normalized = String(status || "pending").toLowerCase();
  return `<span class="badge ${escapeHtml(normalized)}">${escapeHtml(normalized)}</span>`;
}

function getSubscriber(id) {
  return state.subscribersById.get(id) || {};
}

function getTier(id) {
  return state.tiersById.get(id) || {};
}

function newestFirst(items) {
  return [...(items || [])].sort((a, b) => {
    const left = new Date(a.created_at || a.updated_at || 0).getTime();
    const right = new Date(b.created_at || b.updated_at || 0).getTime();
    return right - left;
  });
}

function deriveMetrics(data) {
  const paidSubscribers = data.subscribers.filter((subscriber) => {
    const status = subscriber.payment_status || subscriber.status;
    return ["paid", "active", "verified"].includes(String(status).toLowerCase());
  });
  const flaggedPayments = data.payments.filter(
    (payment) => String(payment.status).toLowerCase() === "flagged",
  );
  const openOrders = data.orders.filter(
    (order) => !["delivered", "cancelled"].includes(String(order.status).toLowerCase()),
  );

  const revenueCents = paidSubscribers.reduce((sum, subscriber) => {
    const tier = getTier(subscriber.tier_id);
    return sum + (Number(tier.amount_cents || subscriber.amount_cents) || 0);
  }, 0);

  els.paidCount.textContent = paidSubscribers.length;
  els.weeklyRevenue.textContent = money(revenueCents);
  els.flaggedCount.textContent = flaggedPayments.length;
  els.openDeliveries.textContent = openOrders.length;
}

function renderSourceNotice(data) {
  const meta = data.meta || {};

  if (meta.source === "insforge") {
    els.sourceNotice.classList.remove("visible");
    els.sourceNotice.textContent = "";
    return;
  }

  els.sourceNotice.textContent =
    meta.errors?.[0] ||
    "Live backend is not fully available yet; showing demo-shaped state.";
  els.sourceNotice.classList.add("visible");
}

function renderEvents(data) {
  const events = newestFirst(data.agent_events);

  els.eventList.innerHTML = events.length
    ? events
        .map(
          (event) => `
            <li class="event-item">
              <div class="event-type">${escapeHtml(event.event_type || event.type || "event")}</div>
              <p class="event-message">${escapeHtml(event.message || event.description || "ResidentOS event received.")}</p>
              <div class="event-time">${escapeHtml(timeAgo(event.created_at))}</div>
            </li>
          `,
        )
        .join("")
    : `<li class="empty">No agent events yet.</li>`;
}

function renderSubscribers(data) {
  els.subscriberRows.innerHTML = data.subscribers.length
    ? data.subscribers
        .map((subscriber) => {
          const tier = getTier(subscriber.tier_id);
          const status = subscriber.payment_status || subscriber.status;

          return `
            <tr>
              <td>${escapeHtml(subscriber.name || "Unknown")}</td>
              <td>${escapeHtml(subscriber.unit || subscriber.room || "")}<span class="card-meta">Floor ${escapeHtml(subscriber.floor || "")}</span></td>
              <td>${escapeHtml(tier.name || subscriber.tier_name || subscriber.tier_id || "")}</td>
              <td>${escapeHtml(subscriber.telegram_handle || subscriber.telegram_chat_id || "")}</td>
              <td>${statusBadge(status)}</td>
            </tr>
          `;
        })
        .join("")
    : `<tr><td colspan="5" class="empty">No subscribers yet.</td></tr>`;
}

function paymentFields(payment) {
  const extracted = payment.extracted_fields || payment.extraction || {};
  return [
    ["Recipient", extracted.recipient_name || payment.recipient_name],
    ["Email", extracted.recipient_email || payment.recipient_email],
    ["Amount", extracted.amount || money(payment.amount_cents)],
    ["Confirmation", payment.confirmation_number || extracted.confirmation_number],
  ]
    .map(
      ([label, value]) => `
        <div class="field">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value || "Not found")}</strong>
        </div>
      `,
    )
    .join("");
}

function renderPayments(data) {
  const payments = newestFirst(data.payments);

  els.paymentList.innerHTML = payments.length
    ? payments
        .map((payment) => {
          const subscriber = getSubscriber(payment.subscriber_id);
          const flagged = String(payment.status).toLowerCase() === "flagged";
          const receiptKey = payment.receipt_artifact_key || "";

          return `
            <article class="payment-card">
              <div class="card-head">
                <div>
                  <div class="card-title">${escapeHtml(subscriber.name || payment.subscriber_id || "Payment")}</div>
                  <div class="card-meta">${escapeHtml(payment.reason_code || "Receipt extraction")}</div>
                </div>
                ${statusBadge(payment.status || "pending")}
              </div>
              <div class="field-grid">${paymentFields(payment)}</div>
              <div class="actions">
                ${
                  receiptKey
                    ? `<button class="secondary-button" data-preview="${escapeHtml(receiptKey)}">Preview</button>`
                    : `<button class="secondary-button" disabled>No receipt</button>`
                }
                ${
                  flagged
                    ? `<button class="primary-button" data-review="${escapeHtml(payment.id)}" data-decision="approved">Approve</button>
                       <button class="secondary-button reject" data-review="${escapeHtml(payment.id)}" data-decision="rejected">Reject</button>`
                    : ""
                }
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">No payments received yet.</div>`;
}

async function openArtifactPreview(key) {
  if (!key) {
    showToast("No receipt is attached to this payment.");
    return;
  }

  const previewWindow = window.open("about:blank", "_blank");
  if (!previewWindow) {
    throw new Error("Preview was blocked by the browser. Allow popups and try again.");
  }

  previewWindow.opener = null;
  previewWindow.document.title = "Receipt preview";
  previewWindow.document.body.textContent = "Loading receipt preview...";

  try {
    const params = new URLSearchParams({ key });
    const response = await fetch(`/api/artifacts/presign?${params}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Preview unavailable.");
    previewWindow.location.href = payload.url;
  } catch (error) {
    previewWindow.close();
    throw error;
  }
}

function renderManifest(data) {
  const sortedOrders = [...data.orders].sort((a, b) => {
    const floorDelta = Number(a.floor || 0) - Number(b.floor || 0);
    return floorDelta || String(a.unit || "").localeCompare(String(b.unit || ""));
  });

  els.manifestList.innerHTML = sortedOrders.length
    ? sortedOrders
        .map((order) => {
          const subscriber = getSubscriber(order.subscriber_id);
          return `
            <article class="manifest-card">
              <div class="card-head">
                <div>
                  <div class="card-title">Floor ${escapeHtml(order.floor)} &middot; Unit ${escapeHtml(order.unit)}</div>
                  <div class="card-meta">${escapeHtml(subscriber.name || order.subscriber_id || "")}</div>
                </div>
                ${statusBadge(order.status || "queued")}
              </div>
              <div class="actions">
                <button class="secondary-button" data-delivery="${escapeHtml(order.id)}" data-status="dispatched">Dispatched</button>
                <button class="primary-button" data-delivery="${escapeHtml(order.id)}" data-status="delivered">Delivered</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty">Generate a manifest after paid subscribers arrive.</div>`;
}

function render(data) {
  state.dashboard = data;
  state.tiersById = new Map((data.tiers || []).map((tier) => [tier.id, tier]));
  state.subscribersById = new Map(
    (data.subscribers || []).map((subscriber) => [subscriber.id, subscriber]),
  );

  deriveMetrics(data);
  renderSourceNotice(data);
  renderEvents(data);
  renderSubscribers(data);
  renderPayments(data);
  renderManifest(data);
}

async function fetchDashboard() {
  const response = await fetch("/api/dashboard", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Dashboard state request failed.");
  render(await response.json());
}

async function postAction(action, body = {}) {
  const response = await fetch(`/api/actions/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Action failed.");
  }

  await fetchDashboard();
  return payload;
}

function connectEvents() {
  if (!window.EventSource) {
    fetchDashboard().catch((error) => showToast(error.message));
    return;
  }

  const events = new EventSource("/api/events");

  events.addEventListener("open", () => {
    els.connectionStatus.textContent = "Live";
    els.connectionStatus.className = "status-pill live";
  });

  events.addEventListener("dashboard", (event) => {
    render(JSON.parse(event.data));
  });

  events.addEventListener("error", () => {
    els.connectionStatus.textContent = "Reconnecting";
    els.connectionStatus.className = "status-pill warn";
  });
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  try {
    if (target.id === "refreshButton") {
      await fetchDashboard();
      showToast("Dashboard refreshed.");
    }

    if (target.id === "generateManifest") {
      await postAction("generate-manifest");
      showToast("Manifest generation requested.");
    }

    if (target.dataset.review) {
      await postAction("review-payment", {
        payment_id: target.dataset.review,
        decision: target.dataset.decision,
      });
      showToast(`Payment ${target.dataset.decision}.`);
    }

    if (target.dataset.delivery) {
      await postAction("delivery-status", {
        order_id: target.dataset.delivery,
        status: target.dataset.status,
      });
      showToast(`Delivery marked ${target.dataset.status}.`);
    }

    if ("preview" in target.dataset) {
      await openArtifactPreview(target.dataset.preview);
    }
  } catch (error) {
    showToast(error.message);
  }
});

connectEvents();
