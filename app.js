"use strict";

// config.js sets this when the UI is hosted separately (GitHub Pages).
// Empty means "same origin", which is how FastAPI serves the app by default.
const API_BASE = (window.MINIAPP_API_BASE || "").trim().replace(/\/+$/, "");

const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

const BOOKING_LABELS = {
  
  new: "အသစ်",
  in_progress: "လုပ်ဆောင်နေသည်",
  completed: "ပြီးစီး",
  cancelled: "ပယ်ဖျက်",
};

const SEGMENT_LABELS = {
  pending: "စောင့်ဆိုင်းနေသည်",
  assigned: "သတ်မှတ်ပြီး",
  accepted: "လက်ခံပြီး",
  arrived: "ရောက်ရှိပြီး",
  completed: "ပြီးစီး",
  cancelled: "ပယ်ဖျက်",
  failed: "မအောင်မြင်",
};

const VEHICLE_LABELS = {
  available: "ရနိုင်သည်",
  on_trip: "ခရီးပေါ်ရှိ",
  charging: "အားသွင်းနေသည်",
  off_duty: "အနားယူ",
};

const DRIVER_LABELS = {
  off_duty: "အနားယူ",
  available: "ရနိုင်သည်",
  on_trip: "ခရီးပေါ်ရှိ",
  reserved: "သိမ်းထားသည်",
};

const ROLE_LABELS = {
  owner: "ပိုင်ရှင်",
  dispatcher: "ဒစ်စပက်ချာ",
  accountant: "စာရင်းကိုင်",
  driver: "ယာဉ်မောင်း",
};

const state = {
  initData: "",
  me: null,
  tab: "bookings",
  locations: [],
  routes: [],
  bookings: [],
  vehicles: [],
  pairs: [],
};

const $ = (selector) => document.querySelector(selector);

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

function button(label, className, handler) {
  const element = node("button", className, label);
  element.type = "button";
  element.addEventListener("click", handler);
  return element;
}

function money(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  })} MMK`;
}

function percent(value) {
  return `${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}%`;
}

function dateTime(value) {
  if (!value) return "—";
  const options = {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  };
  if (state.me && state.me.timezone) options.timeZone = state.me.timezone;
  return new Intl.DateTimeFormat("en-GB", options).format(new Date(value));
}

function duration(minutes) {
  const total = Math.max(0, Number(minutes) || 0);
  if (total < 60) return `${total} မိနစ်`;
  const hours = Math.floor(total / 60);
  return `${hours} နာရီ ${String(total % 60).padStart(2, "0")} မိနစ်`;
}

function statusBadge(status, labels) {
  const badge = node("span", `status status-${status}`, labels[status] || status);
  return badge;
}

function empty(message) {
  return node("div", "empty", message);
}

let toastTimer = null;
function toast(message, isError = false) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.toggle("error", isError);
  box.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => box.classList.remove("show"), 3200);
}

function showGate(message) {
  $("#app").hidden = true;
  $("#gate").hidden = false;
  $("#gate-message").textContent = message;
  $("#gate-retry").hidden = false;
}

function showApp() {
  $("#gate").hidden = true;
  $("#app").hidden = false;
}

function authError(message) {
  const error = new Error(message);
  error.auth = true;
  return error;
}

async function errorDetail(response) {
  try {
    const body = await response.json();
    if (Array.isArray(body.detail)) {
      return body.detail.map((entry) => entry.msg || "မမှန်ကန်သော တန်ဖိုး").join("; ");
    }
    if (typeof body.detail === "string") return body.detail;
  } catch (_) {
    /* not JSON */
  }
  return `တောင်းဆိုမှု မအောင်မြင်ပါ (${response.status})`;
}

async function api(path, options = {}) {
  const headers = { "X-Telegram-Init-Data": state.initData };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (_) {
    throw new Error("အက်ဒမင် ဝန်ဆောင်မှုသို့ မချိတ်ဆက်နိုင်ပါ။ သင့်အင်တာနက် ချိတ်ဆက်မှုကို စစ်ပါ။");
  }

  if (response.status === 401 || response.status === 403) {
    const detail = await errorDetail(response);
    showGate(detail);
    throw authError(detail);
  }
  if (!response.ok) throw new Error(await errorDetail(response));
  if (response.status === 204) return null;
  return response.json();
}

/* -------------------------------------------------------------------------- */
/* bookings                                                                    */
/* -------------------------------------------------------------------------- */
function bookingCard(booking) {
  const card = node("article", "card");
  const head = node("div", "row between wrap");
  head.append(
    node("div", "card-title", `#${booking.id} · ${booking.customer_name}`),
    statusBadge(booking.status, BOOKING_LABELS)
  );
  card.append(head);
  card.append(
    node(
      "div",
      "muted",
      `${booking.route} · ${booking.passengers} ဦး ခရီးသည် · ကြိုယူချိန် ${dateTime(
        booking.pickup_time
      )}`
    )
  );

  const contact = node("div", "row wrap muted");
  if (booking.customer_phone) {
    const phone = node("a", "phone", booking.customer_phone);
    phone.href = `tel:${booking.customer_phone}`;
    contact.append(phone);
  }
  if (booking.created_by) {
    contact.append(node("span", "", `· ဘွတ်ကင်လုပ်သူ ${booking.created_by}`));
  }
  if (contact.childNodes.length) card.append(contact);

  const legs = node("div", "legs");
  booking.segments.forEach((segment) => {
    const leg = node("div", "leg");
    const line = node("div", "leg-line");
    line.append(
      node(
        "span",
        "leg-route",
        `${segment.sequence}. ${segment.from_location} → ${segment.to_location}`
      ),
      statusBadge(segment.status, SEGMENT_LABELS)
    );
    const meta = node("div", "leg-meta");
    const assigned = segment.driver
      ? `${segment.driver}${segment.vehicle ? ` · ${segment.vehicle}` : ""}`
      : "မသတ်မှတ်ရသေး";
    meta.append(node("span", "", assigned), node("span", "", money(segment.fare)));
    leg.append(line, meta);
    // Assignment is possible while the leg waits, and can still be overridden
    // while the offered driver has not accepted yet.
    if (segment.status === "pending" || segment.status === "assigned") {
      leg.append(
        button("🚗 ကားသတ်မှတ်", "btn ghost small", () =>
          openAssignDialog(booking, segment)
        )
      );
    }
    legs.append(leg);
  });
  card.append(legs);

  const footer = node("div", "card-footer");
  footer.append(node("span", "muted", "စုစုပေါင်း ခရီးခ"), node("strong", "", money(booking.total_fare)));
  card.append(footer);
  // Editing stops as soon as dispatch starts, but deleting stays available for
  // every booking: an in-progress one is removed after the confirm prompt.
  const editable =
    booking.status === "new" &&
    booking.segments.every(
      (segment) =>
        segment.status === "pending" && !segment.driver && !segment.vehicle
    );
  const actions = node("div", "booking-actions");
  if (editable) {
    actions.append(button("✎ ဘွတ်ကင်ပြင်", "btn ghost small", () => editBooking(booking)));
  }
  actions.append(button("ဖျက်မည်", "btn danger small", () => deleteBooking(booking)));
  card.append(actions);
  return card;
}

function selectedBookingRoads() {
  return Array.from(document.querySelectorAll(".booking-road input:checked"))
    .map((input) => Number(input.value))
    .filter(Number.isFinite);
}

// Any combination of legs is allowed: a passenger may ride only some of the
// route's roads, in any order they tick them. Nothing here blocks a selection.
function showBookingHint(message) {
  const preview = $("#booking-fare-preview");
  preview.textContent = message;
  preview.classList.add("warn");
  preview.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateBookingFarePreview() {
  const route = state.routes.find(
    (item) => String(item.id) === $("#booking-form").elements.route_id.value
  );
  const selectedIds = new Set(selectedBookingRoads());
  const passengers = Number($("#booking-form").elements.passenger_count.value) || 0;
  const selectedSegments = route
    ? route.segments.filter((segment) => selectedIds.has(segment.id))
    : [];
  const total = selectedSegments.reduce(
    (sum, segment) => sum + Number(segment.base_fare || 0) * passengers,
    0
  );
  const preview = $("#booking-fare-preview");
  preview.classList.remove("warn");
  if (!selectedSegments.length) {
    preview.textContent = "လမ်းပိုင်းရွေးပါ။";
    return;
  }
  preview.textContent = `ရွေးထားသော ${selectedSegments.length} လမ်းပိုင်း · စုစုပေါင်း ${money(total)}`;
}

function renderBookingRoadOptions(route, selectedIds = []) {
  const fieldset = $("#booking-roads");
  const options = $("#booking-road-options");
  options.replaceChildren();
  if (!route || !route.segments.length) {
    fieldset.hidden = true;
    return;
  }
  fieldset.hidden = false;
  const selected = new Set(selectedIds.map(Number));
  route.segments.forEach((segment) => {
    const label = node("label", "booking-road");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.name = "segment_ids";
    checkbox.value = String(segment.id);
    checkbox.checked = selected.has(segment.id);
    checkbox.addEventListener("change", updateBookingFarePreview);
    const details = node("span", "booking-road-details");
    details.append(
      node("strong", "", `${segment.from_location} → ${segment.to_location}`),
      node("span", "muted", `${money(segment.base_fare)} / ဦး`)
    );
    label.append(checkbox, details);
    options.append(label);
  });
  updateBookingFarePreview();
}

function renderBookingRouteOptions() {
  const select = $("#booking-form").elements.route_id;
  const selected = select.value;
  select.replaceChildren(new Option("လမ်းကြောင်းအုပ်စု ရွေးပါ…", ""));
  state.routes.forEach((route) => {
    const option = new Option(
      `${route.name}${route.segments.length ? ` · ${route.segments.length} လမ်းပိုင်း` : " · အဆင့်မရှိသေး"}`,
      String(route.id)
    );
    option.disabled = route.segments.length === 0;
    option.selected = String(route.id) === selected;
    select.append(option);
  });
  const route = state.routes.find((item) => String(item.id) === select.value);
  renderBookingRoadOptions(route, selectedBookingRoads());
}

function setDefaultPickupTime() {
  const input = $("#booking-form").elements.pickup_time;
  if (input.value) return;
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  now.setMinutes(now.getMinutes() + 30);
  input.value = now.toISOString().slice(0, 16);
}

function renderBookings(data) {
  const list = $("#bookings-list");
  list.replaceChildren();
  $("#bookings-count").textContent = data.total
    ? `ဘွတ်ကင် ${data.items.length}/${data.total}`
    : "";
  if (!data.items.length) {
    list.append(empty("ဤစစ်ထုတ်မှုနှင့် ကိုက်ညီသော ဘွတ်ကင် မရှိပါ။"));
    return;
  }
  data.items.forEach((booking) => list.append(bookingCard(booking)));
}

let assignTarget = null;

async function openAssignDialog(booking, segment) {
  assignTarget = { booking, segment };
  $("#assign-title").textContent = `ဘွတ်ကင် #${booking.id} · အဆင့် ${segment.sequence} ကားသတ်မှတ်`;
  $("#assign-subtitle").textContent =
    `${segment.from_location} → ${segment.to_location} · ခရီးသည် ${booking.passengers} ဦး`;
  const list = $("#assign-list");
  list.replaceChildren(node("div", "muted", "ရနိုင်သော ကားများ ရှာနေသည်…"));
  $("#assign-dialog").showModal();
  try {
    const data = await api("/api/dispatch/available-vehicles");
    const fit = data.items.filter(
      (car) => Number(car.seats) >= Number(booking.passengers)
    );
    list.replaceChildren();
    if (!fit.length) {
      list.append(
        empty(
          "ထိုင်ခုံလုံလောက်ပြီး ရနိုင်သော ကား မရှိပါ။ ယာဉ်မောင်း အွန်လိုင်းဖြစ်ခြင်း၊ ကား အားလပ်ခြင်းကို စစ်ပါ။"
        )
      );
      return;
    }
    fit.forEach((car) => {
      const option = node("button", "assign-option");
      option.type = "button";
      const main = node("span", "assign-option-main");
      main.append(
        node("strong", "", `${car.plate} · ${car.driver}`),
        node("span", "muted", `${car.model} · ထိုင်ခုံ ${car.seats} ခု လွတ်`)
      );
      option.append(main, node("span", "assign-option-go", "သတ်မှတ် →"));
      option.addEventListener("click", () => assignVehicle(car));
      list.append(option);
    });
  } catch (error) {
    if (error.auth) return;
    list.replaceChildren(node("div", "muted", error.message));
  }
}

async function assignVehicle(car) {
  if (!assignTarget) return;
  const { segment } = assignTarget;
  const options = Array.from($("#assign-list").querySelectorAll("button"));
  options.forEach((option) => {
    option.disabled = true;
  });
  try {
    await api(`/api/booking-segments/${segment.id}/assign`, {
      method: "POST",
      body: { vehicle_id: car.id },
    });
    $("#assign-dialog").close();
    toast(`${car.plate} (${car.driver}) ကို အဆင့် ${segment.sequence} တွင် သတ်မှတ်ပြီးပါပြီ။`);
    await loadBookings();
  } catch (error) {
    options.forEach((option) => {
      option.disabled = false;
    });
    if (!error.auth) toast(error.message, true);
  }
}

let sheetSearchTimer = null;
let sheetSearchSequence = 0;

async function searchSheetGuests() {
  const input = $("#sheet-guest-search");
  const results = $("#sheet-guest-results");
  const query = input.value.trim();
  const requestId = ++sheetSearchSequence;
  window.clearTimeout(sheetSearchTimer);
  if (query.length < 2) {
    results.hidden = true;
    results.replaceChildren();
    return;
  }
  sheetSearchTimer = window.setTimeout(async () => {
    results.hidden = false;
    results.replaceChildren(node("div", "muted", "Google Sheets မှ ရှာနေသည်…"));
    try {
      const data = await api(`/api/google-sheets/guests?q=${encodeURIComponent(query)}`);
      if (requestId !== sheetSearchSequence) return;
      results.replaceChildren();
      if (!data.items.length) {
        results.append(node("div", "muted", "ကိုက်ညီသော ဧည့်သည် မတွေ့ပါ။"));
        return;
      }
      data.items.forEach((guest) => {
        const selectGuest = button(
          guest.phone ? `${guest.name} · ${guest.phone}` : guest.name,
          "sheet-guest-option",
          () => {
            const form = $("#booking-form");
            form.elements.customer_name.value = guest.name;
            form.elements.customer_phone.value = guest.phone;
            input.value = "";
            results.hidden = true;
            results.replaceChildren();
            form.elements.route_id.focus();
          }
        );
        results.append(selectGuest);
      });
    } catch (error) {
      if (requestId !== sheetSearchSequence) return;
      results.replaceChildren(
        node("div", "muted", error.message.includes("မချိတ်ဆက်")
          ? "Google Sheets မချိတ်ထားသေးပါ။ အမည်နှင့်ဖုန်းကို အောက်တွင် ကိုယ်တိုင်ရိုက်ထည့်နိုင်ပါသည်။"
          : error.message)
      );
    }
  }, 300);
}

async function loadBookings() {
  const status = $("#booking-status").value;
  const suffix = status ? `&status=${encodeURIComponent(status)}` : "";
  const [data, routes] = await Promise.all([
    api(`/api/bookings?limit=200${suffix}`),
    api("/api/routes"),
  ]);
  state.bookings = data.items;
  state.routes = routes.items;
  renderBookingRouteOptions();
  setDefaultPickupTime();
  renderBookings(data);
}

function editBooking(booking) {
  const form = $("#booking-form");
  form.elements.booking_id.value = String(booking.id);
  form.elements.customer_name.value = booking.customer_name;
  form.elements.customer_phone.value = booking.customer_phone || "";
  form.elements.route_id.value = String(booking.route_id);
  form.elements.passenger_count.value = String(booking.passengers);
  const pickup = new Date(booking.pickup_time);
  pickup.setMinutes(pickup.getMinutes() - pickup.getTimezoneOffset());
  form.elements.pickup_time.value = pickup.toISOString().slice(0, 16);
  const route = state.routes.find((item) => item.id === booking.route_id);
  renderBookingRoadOptions(
    route,
    booking.segments.map((segment) => segment.route_segment_id)
  );
  $("#booking-form-title").textContent = `ဘွတ်ကင် #${booking.id} ပြင်ဆင်ရန်`;
  $("#booking-submit").textContent = "ပြင်ဆင်ချက် သိမ်းမည်";
  $("#booking-cancel-edit").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetBookingEditor() {
  const form = $("#booking-form");
  form.reset();
  form.elements.booking_id.value = "";
  form.elements.route_id.value = "";
  form.elements.passenger_count.value = "1";
  renderBookingRoadOptions(null);
  $("#booking-form-title").textContent = "➕ ဘွတ်ကင်အသစ်";
  $("#booking-submit").textContent = "ဘွတ်ကင်သိမ်းမည်";
  $("#booking-cancel-edit").hidden = true;
  setDefaultPickupTime();
}

async function deleteBooking(booking) {
  const note = booking.status === "new" ? "" : " (လုပ်ဆောင်နေသည်)";
  const confirmed = await confirmAction(
    `ဘွတ်ကင် #${booking.id} (${booking.customer_name})${note} ကို အပြီးဖျက်မှာ သေချာပါသလား? ` +
      "ကား/ယာဉ်မောင်း သတ်မှတ်ထားရင်လည်း အတူ ဖျက်သွားပါမယ်။ ပြန်ယူ၍ မရပါ။"
  );
  if (!confirmed) return;

  try {
    await api(`/api/bookings/${booking.id}`, { method: "DELETE" });
    toast(`ဘွတ်ကင် #${booking.id} ကို ဖျက်ပြီးပါပြီ။`);
    await loadBookings();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function createBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("#booking-submit");
  const selectedSegmentIds = selectedBookingRoads();
  const bookingId = form.elements.booking_id.value;
  const payload = {
    customer_name: form.elements.customer_name.value.trim(),
    customer_phone: form.elements.customer_phone.value.trim() || null,
    route_id: Number(form.elements.route_id.value),
    segment_ids: selectedSegmentIds,
    passenger_count: Number(form.elements.passenger_count.value),
    pickup_time: new Date(form.elements.pickup_time.value).toISOString(),
  };
  if (!payload.customer_name || !payload.route_id || !payload.pickup_time) {
    toast("အမည်၊ လမ်းကြောင်းအုပ်စုနှင့် ကြိုယူချိန်ကို ဖြည့်ပါ", true);
    return;
  }
  if (!payload.segment_ids.length) {
    showBookingHint("ခရီးသည်သွားမည့် လမ်းပိုင်း တစ်ခု ရွေးပါ။");
    return;
  }
  submit.disabled = true;
  try {
    const saved = await api(
      bookingId ? `/api/bookings/${bookingId}` : "/api/bookings",
      { method: bookingId ? "PATCH" : "POST", body: payload }
    );
    resetBookingEditor();
    $("#booking-status").value = "";
    toast(`ဘွတ်ကင် #${saved.id} ${bookingId ? "ပြင်ဆင်ပြီး" : "သိမ်းပြီး"}ပါပြီ။`);
    await loadBookings();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

/* -------------------------------------------------------------------------- */
/* queue                                                                       */
/* -------------------------------------------------------------------------- */
function queuePoint(point) {
  const wrapper = node("article", "queue-point");
  const head = node("div", "queue-head");
  const title = node("div", "stack-tight");
  title.append(node("h3", "", point.name), node("div", "muted", `စောင့်နေသူ ${point.waiting}`));
  head.append(title, statusBadge(point.waiting ? "available" : "off_duty", {
    available: "လက်ရှိ",
    off_duty: "မရှိ",
  }));
  wrapper.append(head);

  if (!point.entries.length) {
    wrapper.append(node("div", "queue-entry muted", "ဤနေရာတွင် မည်သူမှ မစောင့်ပါ။"));
    return wrapper;
  }

  point.entries.forEach((entry) => {
    const row = node("div", "queue-entry");
    row.append(node("div", "position", String(entry.position)));
    const main = node("div", "segment-main");
    main.append(
      node("div", "card-title", `${entry.driver} · ${entry.vehicle}`),
      node("div", "muted", entry.direction),
      node("div", "muted", `ထိုင်ခုံ ${entry.seats_free} ခု လွတ် · ${entry.model}`)
    );
    const wait = node("div", "right");
    wait.append(
      node("div", "segment-title", duration(entry.wait_minutes)),
      node("div", "muted", "စောင့်ဆိုင်းချိန်")
    );
    row.append(main, wait);
    wrapper.append(row);
  });
  return wrapper;
}

function renderQueue(data) {
  const list = $("#queue-list");
  list.replaceChildren();
  if (!data.points.length) {
    list.append(empty("ကားလဲနေရာ မသတ်မှတ်ရသေးပါ။"));
    return;
  }
  data.points.forEach((point) => list.append(queuePoint(point)));
}

async function loadQueue() {
  renderQueue(await api("/api/queue"));
}

/* -------------------------------------------------------------------------- */
/* vehicles and drivers                                                        */
/* -------------------------------------------------------------------------- */
function renderVehicles(data) {
  const list = $("#vehicles-list");
  list.replaceChildren();
  if (!data.items.length) {
    list.append(empty("ယာဉ်စာရင်းတွင် ကား မရှိသေးပါ။"));
    return;
  }
  data.items.forEach((vehicle) => {
    const card = node("article", "card");
    const head = node("div", "row between wrap");
    head.append(
      node("div", "card-title", vehicle.plate),
      statusBadge(vehicle.status, VEHICLE_LABELS)
    );
    card.append(head);
    card.append(node("div", "muted", `${vehicle.model} · ထိုင်ခုံ ${vehicle.seats} ခု`));
    card.append(
      node(
        "div",
        "segment-meta",
        vehicle.driver ? `ယာဉ်မောင်း: ${vehicle.driver}` : "ယာဉ်မောင်း မသတ်မှတ်ထား"
      )
    );
    list.append(card);
  });
}

async function loadVehicles() {
  renderVehicles(await api("/api/vehicles"));
}

function renderDrivers(data) {
  const list = $("#drivers-list");
  list.replaceChildren();
  if (!data.items.length) {
    list.append(empty("ဝန်ထမ်း မရှိပါ။"));
    return;
  }
  data.items.forEach((driver) => {
    const card = node("article", "card");
    const head = node("div", "row between wrap");
    const title = node("div", "stack-tight");
    title.append(node("div", "card-title", driver.name));
    if (driver.telegram_username) {
      title.append(node("div", "muted", `@${driver.telegram_username}`));
    }
    title.append(node("div", "muted", ROLE_LABELS[driver.role] || driver.role));
    if (!driver.active) title.append(node("div", "muted", "ပိတ်ထားသည်"));
    const badge = driver.status
      ? statusBadge(driver.status, DRIVER_LABELS)
      : statusBadge(driver.active ? "available" : "off_duty", {
          available: "အသုံးပြုနေသည်",
          off_duty: "ပိတ်ထားသည်",
        });
    head.append(title, badge);
    card.append(head);

    const phoneLine = node("div", "muted");
    if (driver.phone) {
      const phone = node("a", "phone", driver.phone);
      phone.href = `tel:${driver.phone}`;
      phoneLine.append(phone);
    } else {
      phoneLine.textContent = "ဖုန်းနံပါတ် မရှိ";
    }
    card.append(phoneLine);
    if (driver.role === "driver") {
      card.append(
        node("div", "segment-meta", driver.vehicle ? `ကား: ${driver.vehicle}` : "ကား မသတ်မှတ်ထား")
      );
      if (driver.queue) {
        card.append(
          node(
            "div",
            "segment-meta",
            `တန်းစီ: ${driver.queue.point || "ကားလဲနေရာ"} · ${
              driver.queue.seats_free
            } ခု လွတ် · ${dateTime(driver.queue.joined_at)} ကတည်းက`
          )
        );
      }
    }
    if (state.me && state.me.user.role === "owner") {
      const actions = node("div", "booking-actions");
      actions.append(
        button("ပြင်ရန်", "btn ghost small", () => editStaff(driver)),
        button("ဖျက်ရန်", "btn danger small", () => deleteStaff(driver))
      );
      card.append(actions);
    }
    list.append(card);
  });
}

async function loadDrivers() {
  renderDrivers(await api("/api/staff"));
}

function editStaff(staff) {
  const form = $("#staff-edit-form");
  form.elements.staff_id.value = String(staff.id);
  form.elements.name.value = staff.name;
  form.elements.phone.value = staff.phone || "";
  $("#staff-dialog").showModal();
  form.elements.name.focus();
  form.elements.name.select();
}

async function saveStaff(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const staffId = form.elements.staff_id.value;
  try {
    await api(`/api/staff/${staffId}`, {
      method: "PATCH",
      body: {
        name: form.elements.name.value.trim(),
        phone: form.elements.phone.value.trim() || null,
      },
    });
    $("#staff-dialog").close();
    toast("ဝန်ထမ်းအချက်အလက် သိမ်းပြီးပါပြီ။");
    await loadDrivers();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function deleteStaff(staff) {
  const confirmed = await confirmAction(
    `${staff.name} ကို ဝန်ထမ်းစာရင်းမှ အပြီးဖျက်မှာ သေချာပါသလား? ခရီးမောင်းမှတ်တမ်းရှိပါက backend က ဖျက်ခွင့်မပြုပါ။`
  );
  if (!confirmed) return;
  try {
    await api(`/api/staff/${staff.id}`, { method: "DELETE" });
    toast(`${staff.name} ကို ဖျက်ပြီးပါပြီ။`);
    await loadDrivers();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

/* -------------------------------------------------------------------------- */
/* bridge pairs: which cars swap passengers with which                        */
/* -------------------------------------------------------------------------- */
function pairCard(pair) {
  const card = node("article", "card");
  const head = node("div", "row between wrap");
  head.append(
    node("div", "card-title", pair.label || `အတွဲ #${pair.id}`),
    statusBadge(pair.is_active ? "completed" : "cancelled", {
      completed: "အသုံးပြုနေသည်",
      cancelled: "ပိတ်ထားသည်",
    })
  );
  card.append(head);
  card.append(node("div", "muted", pair.location || "ကားလဲနေရာ"));

  const lines = node("div", "stack-tight");
  lines.append(
    node("div", "", `🚗 လားရှိုးကား: ${pair.lashio_vehicle || "—"}`),
    node("div", "", `⬇️ အဆင်းစီနီယာကား: ${pair.senior_vehicle || "—"}`),
    node("div", "", `⬆️ ခရီးသည်ပြောင်းမည့် အထက်ကား: ${pair.upper_vehicle || "—"}`)
  );
  if (pair.note) lines.append(node("div", "muted", `📝 ${pair.note}`));
  card.append(lines);

  if (state.me && state.me.user.role === "owner") {
    const actions = node("div", "booking-actions");
    actions.append(
      button("ပြင်", "btn ghost small", () => openPairDialog(pair)),
      button("ဖျက်", "btn danger small", () => deletePair(pair))
    );
    card.append(actions);
  }
  return card;
}

function renderPairs() {
  const list = $("#pairs-list");
  list.replaceChildren();
  if (!state.pairs.length) {
    list.append(
      empty("အတွဲ မသတ်မှတ်ရသေးပါ။ “+ အတွဲအသစ်” နှိပ်ပြီး ကားများ ရွေးပါ။")
    );
    return;
  }
  state.pairs.forEach((pair) => list.append(pairCard(pair)));
}

async function loadPairs() {
  const [pairs, locations, vehicles] = await Promise.all([
    api("/api/transfer-pairs"),
    api("/api/locations"),
    api("/api/vehicles"),
  ]);
  state.pairs = pairs.items;
  state.locations = locations.items;
  state.vehicles = vehicles.items;
  renderPairs();
}

function fillPairVehicles(select, selectedId) {
  select.replaceChildren(new Option("— မရွေး —", ""));
  state.vehicles.forEach((vehicle) => {
    const label = vehicle.driver
      ? `${vehicle.plate} · ${vehicle.driver}`
      : vehicle.plate;
    const option = new Option(label, String(vehicle.id));
    option.selected = vehicle.id === selectedId;
    select.append(option);
  });
}

function openPairDialog(pair) {
  const points = state.locations.filter((location) => location.is_transfer_point);
  const choices = points.length ? points : state.locations.slice();
  // A pair saved before its point was unflagged must stay selectable.
  if (pair && !choices.some((location) => location.id === pair.location_id)) {
    const own = state.locations.find((location) => location.id === pair.location_id);
    if (own) choices.push(own);
  }
  if (!choices.length) {
    toast("အရင်ဆုံး ကားလဲနေရာ (တည်နေရာ) တစ်ခု သတ်မှတ်ပါ", true);
    return;
  }
  const form = $("#pair-form");
  form.reset();
  const locationSelect = form.elements.location_id;
  locationSelect.replaceChildren();
  choices.forEach((location) => {
    const option = new Option(location.name, String(location.id));
    option.selected = pair ? location.id === pair.location_id : choices.length === 1;
    locationSelect.append(option);
  });
  form.elements.pair_id.value = pair ? String(pair.id) : "";
  form.elements.label.value = pair && pair.label ? pair.label : "";
  fillPairVehicles(form.elements.lashio_vehicle_id, pair ? pair.lashio_vehicle_id : null);
  fillPairVehicles(form.elements.senior_vehicle_id, pair ? pair.senior_vehicle_id : null);
  fillPairVehicles(form.elements.upper_vehicle_id, pair ? pair.upper_vehicle_id : null);
  form.elements.note.value = pair && pair.note ? pair.note : "";
  form.elements.is_active.checked = pair ? Boolean(pair.is_active) : true;
  $("#pair-dialog").showModal();
}

async function savePair(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const pairId = form.elements.pair_id.value;
  const edited = state.pairs.find((pair) => String(pair.id) === pairId);
  const cars = [
    "lashio_vehicle_id",
    "senior_vehicle_id",
    "upper_vehicle_id",
  ].map((name) => {
    const value = form.elements[name].value;
    return value ? Number(value) : null;
  });
  if (cars.filter((value) => value !== null).length < 2) {
    toast("အတွဲတစ်ခုတွင် ကား အနည်းဆုံး နှစ်စီး ရွေးပါ", true);
    return;
  }
  const payload = {
    location_id: Number(form.elements.location_id.value),
    label: form.elements.label.value.trim() || null,
    lashio_vehicle_id: cars[0],
    senior_vehicle_id: cars[1],
    upper_vehicle_id: cars[2],
    note: form.elements.note.value.trim() || null,
    is_active: form.elements.is_active.checked,
    sort_order: edited ? Number(edited.sort_order) : state.pairs.length,
  };
  try {
    if (edited) {
      await api(`/api/transfer-pairs/${edited.id}`, { method: "PUT", body: payload });
    } else {
      await api("/api/transfer-pairs", { method: "POST", body: payload });
    }
    $("#pair-dialog").close();
    toast("ကားအတွဲ သိမ်းပြီးပါပြီ။");
    await loadPairs();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function deletePair(pair) {
  const name = pair.label || `အတွဲ #${pair.id}`;
  if (!(await confirmAction(`${name} ကို ဖျက်မလား?`))) return;
  try {
    await api(`/api/transfer-pairs/${pair.id}`, { method: "DELETE" });
    toast("အတွဲ ဖျက်ပြီးပါပြီ။");
    await loadPairs();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function sendPairs() {
  if (!(await confirmAction("လက်ရှိ အတွဲစာရင်းကို Telegram group သို့ ပို့မလား?"))) {
    return;
  }
  try {
    const result = await api("/api/transfer-pairs/send", { method: "POST" });
    toast(`အတွဲ ${result.sent} ခုကို group သို့ ပို့ပြီးပါပြီ။`);
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

/* -------------------------------------------------------------------------- */
/* routes, segments and fares                                                  */
/* -------------------------------------------------------------------------- */
function segmentRow(route, segment) {
  const row = node("div", "segment-row");
  const main = node("div", "segment-main");
  main.append(
    node(
      "div",
      "segment-title",
      `${segment.sequence}. ${segment.from_location} → ${segment.to_location}`
    ),
    node(
      "div",
      "segment-meta",
      `တစ်ဦးလျှင် ${money(segment.base_fare)} · ယာဉ်မောင်း ${
        segment.driver_fixed_amount !== null
          ? `ပုံသေ ${money(segment.driver_fixed_amount)}`
          : percent(segment.driver_percent)
      }`
    )
  );

  const actions = node("div", "segment-actions");
  actions.append(
    button("ပြင်", "btn ghost small", () => openSegmentDialog(route, segment)),
    button("ဖျက်", "btn danger small", () => deleteSegment(route, segment))
  );
  row.append(main, actions);
  return row;
}

function routeCard(route) {
  const card = node("article", "card route-card");
  const head = node("div", "route-head");
  const info = node("div", "stack-tight");
  info.append(
    node("h3", "", route.name),
    node(
      "div",
      "muted",
      `အဆင့် ${route.segments.length} · တစ်ဦးလျှင် ${money(route.total_fare)}`
    )
  );

  const actions = node("div", "route-actions");
  actions.append(
    button("အမည်ပြောင်း", "btn ghost small", () => renameRoute(route)),
    button("ဖျက်", "btn danger small", () => deleteRoute(route))
  );
  head.append(info, actions);
  card.append(head);

  const segments = node("div", "segments");
  if (!route.segments.length) {
    segments.append(
      node(
        "p",
        "muted segment-row",
        "အဆင့် မရှိသေးပါ။ ဘွတ်ကင်မလုပ်မီ လမ်းကြောင်းတွင် အနည်းဆုံး အဆင့်တစ်ခု ရှိရပါမည်။"
      )
    );
  } else {
    route.segments.forEach((segment) => segments.append(segmentRow(route, segment)));
  }
  card.append(segments);

  card.append(
    button("+ အဆင့်ထည့်", "btn ghost small add-segment", () =>
      openSegmentDialog(route, null)
    )
  );
  return card;
}

function renderRoutes() {
  const list = $("#routes-list");
  list.replaceChildren();
  if (!state.routes.length) {
    list.append(empty("လမ်းကြောင်း မရှိသေးပါ။ အပေါ်တွင် တစ်ခု ဖန်တီးပြီး ၎င်း၏ အဆင့်များ ထည့်ပါ။"));
    return;
  }
  state.routes.forEach((route) => list.append(routeCard(route)));
}

async function loadRoutes() {
  const [routes, locations] = await Promise.all([
    api("/api/routes"),
    api("/api/locations"),
  ]);
  state.routes = routes.items;
  state.locations = locations.items;
  renderRoutes();
}

function confirmAction(message) {
  return new Promise((resolve) => {
    if (tg && tg.initData && typeof tg.showConfirm === "function") {
      let settled = false;
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(Boolean(value));
        }
      };
      const maybePromise = tg.showConfirm(message, done);
      if (maybePromise && typeof maybePromise.then === "function") {
        maybePromise.then(done).catch(() => done(false));
      }
      return;
    }
    resolve(window.confirm(message));
  });
}

function renameRoute(route) {
  const form = $("#route-edit-form");
  form.elements.route_id.value = String(route.id);
  form.elements.name.value = route.name;
  $("#route-dialog").showModal();
  form.elements.name.focus();
  form.elements.name.select();
}

async function saveRouteName(event) {
  event.preventDefault();
  const form = $("#route-edit-form");
  const name = form.elements.name.value.trim();
  if (name.length < 2) {
    toast("လမ်းကြောင်းအမည် အတိုလွန်းနေသည်", true);
    return;
  }
  try {
    await api(`/api/routes/${form.elements.route_id.value}`, {
      method: "PATCH",
      body: { name },
    });
    $("#route-dialog").close();
    toast("လမ်းကြောင်းအမည် ပြောင်းပြီးပါပြီ");
    await loadRoutes();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function deleteRoute(route) {
  if (await confirmAction(`လမ်းကြောင်း "${route.name}" ကို ဖျက်မလား? ၎င်း၏ အဆင့်အားလုံးကိုပါ ဖျက်ပစ်ပါမည်။`)) {
    try {
      await api(`/api/routes/${route.id}`, { method: "DELETE" });
      toast("လမ်းကြောင်း ဖျက်ပြီးပါပြီ");
      await loadRoutes();
    } catch (error) {
      if (!error.auth) toast(error.message, true);
    }
  }
}

async function deleteSegment(route, segment) {
  const message = `အဆင့် ${segment.sequence} (${segment.from_location} → ${segment.to_location}) ကို ဖျက်မလား?`;
  if (await confirmAction(message)) {
    try {
      await api(`/api/route-segments/${segment.id}`, { method: "DELETE" });
      toast("အဆင့် ဖျက်ပြီးပါပြီ");
      await loadRoutes();
    } catch (error) {
      if (!error.auth) toast(error.message, true);
    }
  }
}

function fillSelect(select, selectedId) {
  select.replaceChildren();
  state.locations.forEach((location) => {
    const option = node("option", "", location.name);
    option.value = String(location.id);
    option.selected = location.id === selectedId;
    select.append(option);
  });
}

function openSegmentDialog(route, segment) {
  if (state.locations.length < 2) {
    toast("အဆင့်မဖန်တီးမီ အနည်းဆုံး တည်နေရာ နှစ်ခု ထည့်ပါ", true);
    return;
  }
  const form = $("#segment-form");
  form.reset();
  const fallbackFrom =
    segment?.from_location_id ??
    route.segments[route.segments.length - 1]?.to_location_id ??
    state.locations[0].id;
  const fallbackTo =
    segment?.to_location_id ??
    state.locations.find((location) => location.id !== fallbackFrom)?.id ??
    state.locations[0].id;

  form.elements.route_id.value = String(route.id);
  form.elements.segment_id.value = segment ? String(segment.id) : "";
  fillSelect(form.elements.from_location_id, fallbackFrom);
  fillSelect(form.elements.to_location_id, fallbackTo);
  form.elements.base_fare.value = segment
    ? Number(segment.base_fare)
    : route.segments.length
      ? Number(route.segments[route.segments.length - 1].base_fare)
      : 0;
  form.elements.driver_percent.value = segment
    ? Number(segment.driver_percent)
    : route.segments.length
      ? Number(route.segments[route.segments.length - 1].driver_percent)
      : 20;
  form.elements.driver_fixed_amount.value =
    segment && segment.driver_fixed_amount !== null
      ? Number(segment.driver_fixed_amount)
      : "";

  $("#segment-title").textContent = segment
    ? `အဆင့် ${segment.sequence} ပြင်`
    : `${route.name} သို့ အဆင့်ထည့်`;
  $("#segment-dialog").showModal();
}

async function saveSegment(event) {
  event.preventDefault();
  const form = $("#segment-form");
  const routeId = form.elements.route_id.value;
  const segmentId = form.elements.segment_id.value;
  const fromLocationId = Number(form.elements.from_location_id.value);
  const toLocationId = Number(form.elements.to_location_id.value);
  if (fromLocationId === toLocationId) {
    toast("အဆင့်သည် မတူညီသော တည်နေရာနှစ်ခုတွင် စတင်ပြီး အဆုံးသတ်ရပါမည်", true);
    return;
  }

  const fixedRaw = form.elements.driver_fixed_amount.value.trim();
  const payload = {
    from_location_id: fromLocationId,
    to_location_id: toLocationId,
    base_fare: Number(form.elements.base_fare.value),
    driver_percent: Number(form.elements.driver_percent.value),
    driver_fixed_amount: fixedRaw === "" ? null : Number(fixedRaw),
  };
  if (!Number.isFinite(payload.base_fare) || payload.base_fare < 0) {
    toast("မှန်ကန်သော ခရီးခ ထည့်ပါ", true);
    return;
  }

  try {
    if (segmentId) {
      await api(`/api/route-segments/${segmentId}`, {
        method: "PATCH",
        body: payload,
      });
    } else {
      await api(`/api/routes/${routeId}/segments`, {
        method: "POST",
        body: payload,
      });
    }
    $("#segment-dialog").close();
    toast("အဆင့် သိမ်းပြီးပါပြီ");
    await loadRoutes();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

/* -------------------------------------------------------------------------- */
/* page bootstrap                                                              */
/* -------------------------------------------------------------------------- */
async function addRoute(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const input = form.querySelector('input[name="name"]');
  const name = input.value.trim();
  if (name.length < 2) {
    toast("လမ်းကြောင်းအမည် အတိုလွန်းနေသည်", true);
    return;
  }
  try {
    await api("/api/routes", { method: "POST", body: { name } });
    input.value = "";
    toast("လမ်းကြောင်း ဖန်တီးပြီးပါပြီ");
    await loadRoutes();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function addLocation(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const nameInput = form.querySelector('input[name="name"]');
  const pointInput = form.querySelector('input[name="is_transfer_point"]');
  const name = nameInput.value.trim();
  if (name.length < 2) {
    toast("တည်နေရာအမည် အတိုလွန်းနေသည်", true);
    return;
  }
  try {
    await api("/api/locations", {
      method: "POST",
      body: { name, is_transfer_point: pointInput.checked },
    });
    form.reset();
    toast("တည်နေရာ ထည့်ပြီးပါပြီ");
    await loadRoutes();
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

const loaders = {
  bookings: loadBookings,
  queue: loadQueue,
  pairs: loadPairs,
  vehicles: loadVehicles,
  drivers: loadDrivers,
  routes: loadRoutes,
};

async function loadTab(tab) {
  await loaders[tab]();
}

async function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((element) => {
    element.classList.toggle("is-active", element.dataset.tab === tab);
  });
  document.querySelectorAll(".panel").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  try {
    await loadTab(tab);
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

async function refreshActive() {
  try {
    await loadTab(state.tab);
    toast("အသစ်ပြန်လုပ်ပြီးပါပြီ");
  } catch (error) {
    if (!error.auth) toast(error.message, true);
  }
}

function wireEvents() {
  document.querySelectorAll(".tab").forEach((element) => {
    element.addEventListener("click", () => switchTab(element.dataset.tab));
  });
  $("#booking-form").elements.route_id.addEventListener("change", () => {
    const route = state.routes.find(
      (item) => String(item.id) === $("#booking-form").elements.route_id.value
    );
    renderBookingRoadOptions(route);
  });
  $("#booking-form").elements.passenger_count.addEventListener(
    "input",
    updateBookingFarePreview
  );
  $("#booking-status").addEventListener("change", () => {
    loadBookings().catch((error) => {
      if (!error.auth) toast(error.message, true);
    });
  });
  $("#booking-form").addEventListener("submit", createBooking);
  $("#sheet-guest-search").addEventListener("input", searchSheetGuests);
  $("#booking-cancel-edit").addEventListener("click", resetBookingEditor);
  $("#refresh").addEventListener("click", refreshActive);
  $("#gate-retry").addEventListener("click", () => window.location.reload());
  $("#route-form").addEventListener("submit", addRoute);
  $("#location-form").addEventListener("submit", addLocation);
  $("#segment-form").addEventListener("submit", saveSegment);
  $("#segment-cancel").addEventListener("click", () => $("#segment-dialog").close());
  $("#assign-cancel").addEventListener("click", () => $("#assign-dialog").close());
  $("#pair-add").addEventListener("click", () => openPairDialog(null));
  $("#pair-form").addEventListener("submit", savePair);
  $("#pair-send").addEventListener("click", sendPairs);
  $("#pair-cancel").addEventListener("click", () => $("#pair-dialog").close());
  $("#pair-dialog").addEventListener("click", (event) => {
    if (event.target === $("#pair-dialog")) $("#pair-dialog").close();
  });
  $("#segment-dialog").addEventListener("click", (event) => {
    // Clicking the backdrop (the dialog element itself) closes the sheet.
    if (event.target === $("#segment-dialog")) $("#segment-dialog").close();
  });
  $("#route-edit-form").addEventListener("submit", saveRouteName);
  $("#route-cancel").addEventListener("click", () => $("#route-dialog").close());
  $("#staff-edit-form").addEventListener("submit", saveStaff);
  $("#staff-cancel").addEventListener("click", () => $("#staff-dialog").close());
  $("#staff-dialog").addEventListener("click", (event) => {
    if (event.target === $("#staff-dialog")) $("#staff-dialog").close();
  });
  $("#route-dialog").addEventListener("click", (event) => {
    if (event.target === $("#route-dialog")) $("#route-dialog").close();
  });

  window.setInterval(() => {
    const dialogOpen =
      $("#segment-dialog").open ||
      $("#route-dialog").open ||
      $("#staff-dialog").open ||
      $("#pair-dialog").open;
    if (
      document.visibilityState === "visible" &&
      $("#gate").hidden &&
      !dialogOpen
    ) {
      loadTab(state.tab).catch(() => {});
    }
  }, 30000);
}

async function init() {
  wireEvents();
  if (tg) {
    tg.ready();
    tg.expand();
  }
  state.initData = tg && tg.initData ? tg.initData.trim() : "";
  if (!state.initData) {
    showGate(
      "ဤအက်ပ်ကို Telegram ရှိ EV Taxi ဘော့မှ ဖွင့်ပါ။ Telegram မှ အလိုအလျောက် လော့ဂ်အင်ဝင်ပေးပါမည်။"
    );
    return;
  }

  try {
    const me = await api("/api/me");
    state.me = me;
    $("#who").textContent = `${me.user.name} · ${
      ROLE_LABELS[me.user.role] || me.user.role
    }`;
    showApp();
    await switchTab("bookings");
  } catch (error) {
    if (!error.auth) showGate(error.message || "အက်ဒမင် အက်ပ်ကို စတင်၍ မရပါ။");
  }
}

init();
