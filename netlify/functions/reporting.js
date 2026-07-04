// Fonction serverless Netlify — proxy sécurisé vers l'API Lodgify.
// La clé API vit UNIQUEMENT ici, côté serveur (variable d'environnement),
// jamais dans le navigateur.
//
// Endpoint appelé par le tableau de bord : /.netlify/functions/reporting
// Renvoie un JSON prêt à afficher : par propriété, par mois → nuits,
// taux de remplissage, prix moyen/nuit, revenu.

const API = "https://api.lodgify.com/v2";

// --- Petit utilitaire d'appel Lodgify ---
async function lodgify(path, key) {
  const res = await fetch(`${API}${path}`, {
    headers: { "X-ApiKey": key, accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lodgify ${res.status} sur ${path} : ${body.slice(0, 200)}`);
  }
  return res.json();
}

// --- Récupère TOUTES les réservations (pagination) ---
async function getAllBookings(key) {
  let page = 1;
  let all = [];
  let count = Infinity;
  while (all.length < count) {
    const data = await lodgify(
      `/reservations/bookings?page=${page}&size=50&includeCount=true&stayFilter=All`,
      key
    );
    const items = data.items || [];
    count = Number.isFinite(data.count) ? data.count : items.length;
    all = all.concat(items);
    if (items.length === 0) break;
    page++;
    if (page > 60) break; // garde-fou anti-boucle
  }
  return all;
}

// --- Table id → nom de propriété ---
async function getPropertyNames(key) {
  try {
    const data = await lodgify(`/properties?includeCount=true&size=50`, key);
    const items = data.items || data || [];
    const map = {};
    for (const p of items) map[p.id] = p.name || `Propriété ${p.id}`;
    return map;
  } catch {
    return {}; // en cas d'échec, on retombera sur l'id
  }
}

// --- Nombre de jours dans un mois "YYYY-MM" ---
function daysInMonth(ym) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

// --- Découpe une réservation en nuits, réparties par mois ---
function spreadNights(arrival, departure) {
  const nights = [];
  const start = new Date(arrival);
  const end = new Date(departure);
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    nights.push(ym);
  }
  return nights;
}

// --- Calcule les statistiques par propriété et par mois ---
function computeStats(bookings, names) {
  // On ne garde que les réservations réellement confirmées.
  const active = bookings.filter((b) => (b.status || "").toLowerCase() === "booked");

  // structure : { propId: { name, months: { "YYYY-MM": {nights, revenue} } } }
  const byProp = {};

  for (const b of active) {
    const propId = b.property_id ?? b.propertyId ?? "?";
    const arrival = b.arrival || b.date_arrival;
    const departure = b.departure || b.date_departure;
    if (!arrival || !departure) continue;

    const nights = spreadNights(arrival, departure);
    if (nights.length === 0) continue;

    const total = Number(b.total ?? b.total_amount ?? 0);
    const perNight = total / nights.length;

    if (!byProp[propId]) {
      byProp[propId] = { name: names[propId] || `Propriété ${propId}`, months: {} };
    }
    for (const ym of nights) {
      if (!byProp[propId].months[ym]) byProp[propId].months[ym] = { nights: 0, revenue: 0 };
      byProp[propId].months[ym].nights += 1;
      byProp[propId].months[ym].revenue += perNight;
    }
  }

  // Mise en forme finale
  const result = [];
  for (const [propId, data] of Object.entries(byProp)) {
    const months = Object.entries(data.months)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, v]) => {
        const days = daysInMonth(ym);
        return {
          month: ym,
          nights: v.nights,
          occupancy: Math.round((v.nights / days) * 1000) / 10,
          revenue: Math.round(v.revenue),
          avgPrice: v.nights ? Math.round(v.revenue / v.nights) : 0,
        };
      });
    result.push({ propertyId: propId, name: data.name, months });
  }
  return result;
}

exports.handler = async () => {
  const key = process.env.LODGIFY_API_KEY;
  if (!key) {
    return { statusCode: 500, body: JSON.stringify({ error: "LODGIFY_API_KEY manquante" }) };
  }
  try {
    const [bookings, names] = await Promise.all([
      getAllBookings(key),
      getPropertyNames(key),
    ]);
    const stats = computeStats(bookings, names);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=1800", // cache 30 min côté CDN
      },
      body: JSON.stringify({ generatedAt: new Date().toISOString(), properties: stats }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
