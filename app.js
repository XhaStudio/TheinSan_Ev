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
    legs.append(leg);
  });
  card.append(legs);

  const footer = node("div", "card-footer");
  footer.append(node("span", "muted", "စုစုပေါင်း ခရီးခ"), node("strong", "", money(booking.total_fare)));
  card.append(footer);
  return card;
}

function renderBookingRouteOptions() {
  const select = $("#booking-form").elements.route_id;
  const selected = select.value;
  select.replaceChildren(new Option("လမ်းကြောင်းရွေးပါ…", ""));
  state.routes.forEach((route) => {
    const option = new Option(
      `${route.name}${route.segments.length ? ` · ${route.segments.length} အဆင့် · ${money(route.total_fare)}/ဦး` : " · အဆင့်မရှိသေး"}`,
      String(route.id)
    );
    option.disabled = route.segments.length === 0;
    option.selected = String(route.id) === selected;
    select.append(option);
  });
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

async function createBooking(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = $("#booking-submit");
  const payload = {
    customer_name: form.elements.customer_name.value.trim(),
    customer_phone: form.elements.customer_phone.value.trim() || null,
    route_id: Number(form.elements.route_id.value),
    passenger_count: Number(form.elements.passenger_count.value),
    pickup_time: new Date(form.elements.pickup_time.value).toISOString(),
  };
  if (!payload.customer_name || !payload.route_id || !payload.pickup_time) {
    toast("အမည်၊ လမ်းကြောင်းနှင့် ကြိုယူချိန်ကို ဖြည့်ပါ", true);
    return;
  }
  submit.disabled = true;
  try {
    const created = await api("/api/bookings", { method: "POST", body: payload });
    form.elements.customer_name.value = "";
    form.elements.customer_phone.value = "";
    form.elements.passenger_count.value = "1";
    setDefaultPickupTime();
    $("#booking-status").value = "";
    toast(`ဘွတ်ကင် #${created.id} သိမ်းပြီးပါပြီ။ ယာဉ်သတ်မှတ်ရန် အောက်ပါစာရင်းတွင် ကြည့်ပါ။`);
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
    list.append(empty("ယာဉ်မောင်း မှတ်ပုံတင်ရသေးသူ မရှိပါ။"));
    return;
  }
  data.items.forEach((driver) => {
    const card = node("article", "card");
    const head = node("div", "row between wrap");
    const title = node("div", "stack-tight");
    title.append(node("div", "card-title", driver.name));
    if (!driver.active) title.append(node("div", "muted", "ပိတ်ထားသည်"));
    head.append(title, statusBadge(driver.status, DRIVER_LABELS));
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
    list.append(card);
  });
}

async function loadDrivers() {
  renderDrivers(await api("/api/drivers"));
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
  $("#booking-status").addEventListener("change", () => {
    loadBookings().catch((error) => {
      if (!error.auth) toast(error.message, true);
    });
  });
  $("#booking-form").addEventListener("submit", createBooking);
  $("#refresh").addEventListener("click", refreshActive);
  $("#gate-retry").addEventListener("click", () => window.location.reload());
  $("#route-form").addEventListener("submit", addRoute);
  $("#location-form").addEventListener("submit", addLocation);
  $("#segment-form").addEventListener("submit", saveSegment);
  $("#segment-cancel").addEventListener("click", () => $("#segment-dialog").close());
  $("#segment-dialog").addEventListener("click", (event) => {
    // Clicking the backdrop (the dialog element itself) closes the sheet.
    if (event.target === $("#segment-dialog")) $("#segment-dialog").close();
  });
  $("#route-edit-form").addEventListener("submit", saveRouteName);
  $("#route-cancel").addEventListener("click", () => $("#route-dialog").close());
  $("#route-dialog").addEventListener("click", (event) => {
    if (event.target === $("#route-dialog")) $("#route-dialog").close();
  });

  window.setInterval(() => {
    const dialogOpen =
      $("#segment-dialog").open || $("#route-dialog").open;
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
