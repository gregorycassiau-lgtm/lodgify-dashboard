// Fonction serverless Netlify — proxy sécurisé vers l'API Lodgify.
// La clé API vit UNIQUEMENT ici (variable d'environnement), jamais dans le navigateur.
// Renvoie, par propriété : stats mensuelles + calendrier des 60 prochains jours
// + cumuls "à la même date" cette année et l'an dernier (pour le rythme).

const API = "https://api.lodgify.com/v2";

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

// Récupère toutes les réservations.
// Optimisé : 100 par page, pages suivantes en parallèle, budget de temps —
// pour rester sous la limite de 10 s, y compris au démarrage à froid.
async function getAllBookings(key, deadline) {
  const SIZE = 100;
  const first = await lodgify(
    `/reservations/bookings?page=1&size=${SIZE}&includeCount=true&stayFilter=All`, key);
  const items = first.items || [];
  const count = Number.isFinite(first.count) ? first.count : items.length;
  const pages = Math.min(Math.ceil(count / SIZE), 20);
  if (pages <= 1) return items;

  const rest = [];
  for (let p = 2; p <= pages; p++) rest.push(p);

  const results = await Promise.all(rest.map(async (p) => {
    if (Date.now() > deadline) return [];   // budget dépassé : on s'arrête proprement
    try {
      const d = await lodgify(
        `/reservations/bookings?page=${p}&size=${SIZE}&includeCount=true&stayFilter=All`, key);
      return d.items || [];
    } catch { return []; }                  // une page en échec ne fait pas tomber le tout
  }));

  return items.concat(...results);
}

async function getPropertyNames(key) {
  try {
    const data = await lodgify(`/properties?includeCount=true&size=50`, key);
    const items = data.items || data || [];
    const map = {};
    for (const p of items) map[p.id] = p.name || `Propriété ${p.id}`;
    return map;
  } catch { return {}; }
}

function daysInMonth(ym) { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); }
function iso(d) { return d.toISOString().slice(0, 10); }

function eachNight(arrival, departure) {
  const nights = [];
  const end = new Date(departure);
  for (let d = new Date(arrival); d < end; d.setDate(d.getDate() + 1)) nights.push(new Date(d));
  return nights;
}

function computeStats(bookings, names) {
  const active = bookings.filter((b) => (b.status || "").toLowerCase() === "booked");

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thisYear = today.getUTCFullYear();
  const janThis = new Date(Date.UTC(thisYear, 0, 1));
  const janLast = new Date(Date.UTC(thisYear - 1, 0, 1));
  const sameDayLast = new Date(Date.UTC(thisYear - 1, today.getUTCMonth(), today.getUTCDate()));

  const byProp = {};

  for (const b of active) {
    const propId = b.property_id ?? b.propertyId ?? "?";
    const arrival = b.arrival || b.date_arrival;
    const departure = b.departure || b.date_departure;
    if (!arrival || !departure) continue;
    const nights = eachNight(arrival, departure);
    if (nights.length === 0) continue;
    const total = Number(b.total ?? b.total_amount ?? 0);
    const perNight = total / nights.length;

    if (!byProp[propId]) {
      byProp[propId] = {
        name: b.property_name || names[propId] || `Propriété ${propId}`,
        months: {},
        booked: new Set(),
        stays: [],
        ytdThis: { nights: 0, revenue: 0 },
        ytdLast: { nights: 0, revenue: 0 },
      };
    }
    const P = byProp[propId];

    // Infos voyageurs (défensif : les noms de champs varient selon la source)
    let people = b.people ?? b.guests ?? b.number_of_guests ?? null;
    let adults = 0, children = 0, infants = 0, pets = 0, hasBreak = false;
    const addBreak = (gb) => {
      if (!gb) return;
      if (gb.adults != null || gb.children != null || gb.infants != null || gb.pets != null) {
        hasBreak = true;
        adults += gb.adults || 0; children += gb.children || 0;
        infants += gb.infants || 0; pets += gb.pets || 0;
      }
    };
    addBreak(b.guest_breakdown || b.guestBreakdown);
    if (Array.isArray(b.rooms)) {
      for (const r of b.rooms) {
        addBreak(r.guest_breakdown || r.guestBreakdown || r.people_breakdown);
        if (people == null && r.people != null) people = (people || 0) + r.people;
      }
    }
    if (people == null && hasBreak) people = adults + children + infants;

    P.stays.push({
      arrival: iso(new Date(arrival)),
      departure: iso(new Date(departure)),
      nights: nights.length,
      people,
      breakdown: hasBreak ? { adults, children, infants, pets } : null,
    });
    for (const d of nights) {
      const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      if (!P.months[ym]) P.months[ym] = { nights: 0, revenue: 0 };
      P.months[ym].nights += 1;
      P.months[ym].revenue += perNight;
      P.booked.add(iso(d));
      // Cumuls "à la même date"
      if (d >= janThis && d <= today) { P.ytdThis.nights++; P.ytdThis.revenue += perNight; }
      if (d >= janLast && d <= sameDayLast) { P.ytdLast.nights++; P.ytdLast.revenue += perNight; }
    }
  }

  const result = [];
  for (const [propId, data] of Object.entries(byProp)) {
    const months = Object.entries(data.months).sort(([a], [b]) => a.localeCompare(b)).map(([ym, v]) => {
      const days = daysInMonth(ym);
      return { month: ym, nights: v.nights, occupancy: Math.round((v.nights / days) * 1000) / 10,
               revenue: Math.round(v.revenue), avgPrice: v.nights ? Math.round(v.revenue / v.nights) : 0 };
    });

    // Calendrier des 60 prochains jours
    const next60 = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(today); d.setUTCDate(d.getUTCDate() + i);
      next60.push({ date: iso(d), booked: data.booked.has(iso(d)) });
    }

    // Planning ménage : départs des 365 prochains jours + prochaine arrivée
    const horizon = new Date(today); horizon.setUTCDate(horizon.getUTCDate() + 365);
    const horizonIso = iso(horizon);
    const arrivals = data.stays.map(s => s.arrival).sort();
    const stayByArrival = {};
    for (const s of data.stays) if (!stayByArrival[s.arrival]) stayByArrival[s.arrival] = s;
    const turnovers = data.stays
      .filter(s => s.departure >= iso(today) && s.departure <= horizonIso)
      .map(s => {
        const nextCheckin = arrivals.find(a => a >= s.departure) || null;
        const sameDay = nextCheckin === s.departure;
        const gapDays = nextCheckin
          ? Math.round((new Date(nextCheckin) - new Date(s.departure)) / 86400000) : null;
        // Infos du prochain voyageur (celui qui arrive à nextCheckin)
        let nextGuest = null;
        if (nextCheckin && stayByArrival[nextCheckin]) {
          const ns = stayByArrival[nextCheckin];
          nextGuest = { people: ns.people, nights: ns.nights, breakdown: ns.breakdown };
        }
        return { checkout: s.departure, nextCheckin, sameDay, gapDays, nextGuest };
      })
      .sort((a, b) => a.checkout.localeCompare(b.checkout));

    // Planning par SÉJOUR : chaque séjour à venir (départ non passé), arrivée -> départ.
    // Robuste : on itère tous les séjours, aucun n'est masqué tant que le départ n'est pas passé.
    const todayIso = iso(today);
    const departures = data.stays.map(s => s.departure).sort();
    const upcomingStays = data.stays
      .filter(s => s.departure >= todayIso && s.departure <= horizonIso)
      .sort((a, b) => a.arrival.localeCompare(b.arrival) || a.departure.localeCompare(b.departure))
      .map(s => {
        // Séjour précédent = départ le plus récent qui précède cette arrivée
        let prevDeparture = null;
        for (const d of departures) {
          if (d <= s.arrival && (prevDeparture === null || d > prevDeparture)) prevDeparture = d;
        }
        // si le "précédent" est ce séjour lui-même (cas limite), on ignore
        if (prevDeparture === s.departure) prevDeparture = null;
        const turnaroundDays = prevDeparture
          ? Math.round((new Date(s.arrival) - new Date(prevDeparture)) / 86400000) : null;
        return {
          arrival: s.arrival,
          departure: s.departure,
          nights: s.nights,
          people: s.people,
          breakdown: s.breakdown,
          prevDeparture,
          turnaroundDays,
          sameDayRotation: prevDeparture !== null && prevDeparture === s.arrival,
          ongoing: s.arrival <= todayIso && s.departure >= todayIso,
        };
      });

    result.push({
      propertyId: propId, name: data.name, months, next60, turnovers, upcomingStays,
      ytd: {
        thisYear: { nights: data.ytdThis.nights, revenue: Math.round(data.ytdThis.revenue) },
        lastYear: { nights: data.ytdLast.nights, revenue: Math.round(data.ytdLast.revenue) },
      },
    });
  }
  return result;
}

exports.handler = async () => {
  const key = process.env.LODGIFY_API_KEY;
  if (!key) return { statusCode: 500, body: JSON.stringify({ error: "LODGIFY_API_KEY manquante" }) };
  try {
    const deadline = Date.now() + 7000; // marge de sécurité sous la limite de 10 s
    const [bookings, names] = await Promise.all([getAllBookings(key, deadline), getPropertyNames(key)]);
    const stats = computeStats(bookings, names);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600, stale-while-revalidate=3600" },
      body: JSON.stringify({ generatedAt: new Date().toISOString(), today: new Date().toISOString().slice(0,10), properties: stats }),
    };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
