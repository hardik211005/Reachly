/**
 * Business category taxonomy.
 *
 * Used to (a) map free text like "coffee shops" to a canonical category, (b) drive the
 * deterministic mock providers so demo data is realistic, and (c) give the rules-based
 * scorer sensible defaults. Real providers (Google Places etc.) return their own
 * categories, which are normalised through `matchCategory`.
 */

export interface CategoryDefinition {
  key: string;
  label: string;
  industry: string;
  /** Terms that identify this category in queries and provider categories. */
  keywords: string[];
  /** Name fragments for the mock lead generator. */
  namePrefixes: string[];
  nameSuffixes: string[];
  /** Services/products such businesses typically offer (shown on the lead). */
  offerings: string[];
  /** Typical reasons such a business buys from vendors. */
  needs: string[];
  /** Typical number of locations range [min, max] for size modelling. */
  locationsRange: [number, number];
  /** Probability the business has a website (mock generator). */
  websiteRate: number;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    key: "cafe",
    label: "Café",
    industry: "Food & Beverage",
    keywords: ["cafe", "café", "coffee shop", "coffee", "espresso bar", "tea room", "coffee house"],
    namePrefixes: ["Brew", "Bean", "Roast", "Driftwood", "Monsoon", "Perch", "Kettle", "Grind", "Crema", "Leaf"],
    nameSuffixes: ["Café", "Coffee Co.", "Coffee House", "Roasters", "Espresso Bar", "Kitchen & Café"],
    offerings: ["Specialty coffee", "Takeaway beverages", "Bakery items", "All-day breakfast", "Delivery"],
    needs: ["branded takeaway packaging", "social media presence", "online ordering", "customer loyalty"],
    locationsRange: [1, 6],
    websiteRate: 0.55,
  },
  {
    key: "restaurant",
    label: "Restaurant",
    industry: "Food & Beverage",
    keywords: ["restaurant", "dining", "eatery", "bistro", "diner", "family restaurant", "fine dining"],
    namePrefixes: ["Saffron", "Spice Route", "Olive", "Tandoor", "Masala", "Urban", "The Grand", "Copper", "Nomad"],
    nameSuffixes: ["Kitchen", "Restaurant", "Bistro", "Dining", "House", "Table"],
    offerings: ["Dine-in", "Takeaway", "Catering", "Delivery", "Private dining"],
    needs: ["takeaway packaging", "reservations and reviews", "delivery growth", "brand consistency"],
    locationsRange: [1, 8],
    websiteRate: 0.6,
  },
  {
    key: "cloud_kitchen",
    label: "Cloud kitchen",
    industry: "Food & Beverage",
    keywords: ["cloud kitchen", "ghost kitchen", "delivery kitchen", "dark kitchen", "virtual restaurant"],
    namePrefixes: ["Tadka", "Bowl", "Wok", "Biryani", "Burger", "Rolls", "Meal", "Tiffin", "Crave"],
    nameSuffixes: ["Kitchens", "Co.", "Express", "Box", "Hub"],
    offerings: ["Delivery-only meals", "Aggregator listings", "Meal subscriptions"],
    needs: ["delivery packaging at volume", "brand differentiation on aggregators", "repeat orders"],
    locationsRange: [1, 12],
    websiteRate: 0.35,
  },
  {
    key: "bakery",
    label: "Bakery",
    industry: "Food & Beverage",
    keywords: ["bakery", "patisserie", "cake shop", "bake house", "confectionery", "dessert"],
    namePrefixes: ["Sugar", "Crumb", "Butter", "Whisk", "Golden", "Hearth", "Sweet", "Flour"],
    nameSuffixes: ["Bakery", "Bakehouse", "Patisserie", "Cakes", "Bake Co."],
    offerings: ["Custom cakes", "Breads", "Pastries", "Corporate gifting", "Delivery"],
    needs: ["custom boxes", "festive gifting packaging", "online orders", "Instagram marketing"],
    locationsRange: [1, 5],
    websiteRate: 0.5,
  },
  {
    key: "hotel",
    label: "Hotel",
    industry: "Hospitality",
    keywords: ["hotel", "boutique hotel", "resort", "guest house", "hostel", "inn", "stay"],
    namePrefixes: ["Banyan", "Neem", "Ivory", "Royal", "Heritage", "Sky", "Amber", "Crown"],
    nameSuffixes: ["Hotel", "Suites", "Residency", "Inn", "Retreat"],
    offerings: ["Rooms", "Banquets", "Restaurant", "Corporate stays", "Events"],
    needs: ["event photography", "direct bookings", "amenity supplies", "corporate partnerships"],
    locationsRange: [1, 4],
    websiteRate: 0.85,
  },
  {
    key: "event_venue",
    label: "Event venue",
    industry: "Events",
    keywords: ["event venue", "banquet hall", "wedding venue", "party hall", "convention centre", "farmhouse venue"],
    namePrefixes: ["Grand", "Royal", "Garden", "Crystal", "Pearl", "Emerald", "Regal"],
    nameSuffixes: ["Banquets", "Convention Centre", "Gardens", "Event Space", "Hall"],
    offerings: ["Weddings", "Corporate events", "Parties", "Catering partners"],
    needs: ["photography partners", "decor vendors", "marketing to planners", "online visibility"],
    locationsRange: [1, 3],
    websiteRate: 0.7,
  },
  {
    key: "wedding_planner",
    label: "Wedding planner",
    industry: "Events",
    keywords: ["wedding planner", "event planner", "event management", "wedding organiser", "destination wedding"],
    namePrefixes: ["Vows", "Shaadi", "Knot", "Bliss", "Ever After", "Marigold", "Celebrate"],
    nameSuffixes: ["Weddings", "Events", "Planners", "Celebrations", "Co."],
    offerings: ["Wedding planning", "Destination weddings", "Decor", "Vendor management"],
    needs: ["photographers", "venues", "portfolio marketing", "lead flow"],
    locationsRange: [1, 2],
    websiteRate: 0.8,
  },
  {
    key: "salon",
    label: "Salon & spa",
    industry: "Beauty & Wellness",
    keywords: ["salon", "spa", "beauty parlour", "hair salon", "unisex salon", "nail studio"],
    namePrefixes: ["Looks", "Glow", "Mane", "Blush", "Style", "Aura", "Luxe"],
    nameSuffixes: ["Salon", "Studio", "Spa", "Beauty Lounge"],
    offerings: ["Haircuts", "Skin care", "Bridal makeup", "Spa treatments"],
    needs: ["appointments and reviews", "social media content", "retail product packaging"],
    locationsRange: [1, 10],
    websiteRate: 0.45,
  },
  {
    key: "gym",
    label: "Gym & fitness studio",
    industry: "Health & Fitness",
    keywords: ["gym", "fitness studio", "crossfit", "yoga studio", "pilates", "fitness centre"],
    namePrefixes: ["Iron", "Pulse", "Core", "Stride", "Flex", "Summit", "Kinetic"],
    nameSuffixes: ["Fitness", "Gym", "Studio", "Athletics", "Club"],
    offerings: ["Memberships", "Personal training", "Group classes", "Nutrition coaching"],
    needs: ["member acquisition", "branded merchandise", "website and booking", "retention campaigns"],
    locationsRange: [1, 8],
    websiteRate: 0.6,
  },
  {
    key: "clinic",
    label: "Clinic",
    industry: "Healthcare",
    keywords: ["clinic", "dental clinic", "dermatology clinic", "physiotherapy", "diagnostic centre", "polyclinic"],
    namePrefixes: ["Smile", "CarePoint", "Wellness", "Healing", "Prime", "Apex", "City"],
    nameSuffixes: ["Clinic", "Dental Care", "Health Centre", "Diagnostics", "Medical Centre"],
    offerings: ["Consultations", "Treatments", "Diagnostics", "Health packages"],
    needs: ["patient acquisition", "online reputation", "appointment booking", "local SEO"],
    locationsRange: [1, 5],
    websiteRate: 0.7,
  },
  {
    key: "retail_store",
    label: "Retail store",
    industry: "Retail",
    keywords: ["retail store", "boutique", "shop", "store", "showroom", "concept store"],
    namePrefixes: ["Urban", "Thread", "Nook", "Loom", "Vogue", "Craft", "Kiosk"],
    nameSuffixes: ["Store", "Boutique", "Studio", "Emporium", "Collective"],
    offerings: ["In-store retail", "Online orders", "Gift cards", "Custom orders"],
    needs: ["carry bags and packaging", "e-commerce", "footfall", "brand awareness"],
    locationsRange: [1, 15],
    websiteRate: 0.55,
  },
  {
    key: "d2c_brand",
    label: "D2C brand",
    industry: "Consumer Brands",
    keywords: ["d2c", "d2c brand", "direct to consumer", "ecommerce brand", "online brand", "consumer brand"],
    namePrefixes: ["Kaya", "Terra", "Nimbu", "Ember", "Juniper", "Saltwater", "Oak & Ash", "Indigo", "Tulsi"],
    nameSuffixes: ["Co.", "Labs", "Naturals", "Essentials", "& Co.", "Organics"],
    offerings: ["Online store", "Marketplace listings", "Subscriptions", "Retail distribution"],
    needs: ["custom packaging", "performance marketing", "unboxing experience", "influencer campaigns"],
    locationsRange: [1, 3],
    websiteRate: 0.97,
  },
  {
    key: "startup",
    label: "Tech startup",
    industry: "Technology",
    keywords: ["startup", "tech startup", "saas", "software company", "fintech", "edtech", "healthtech"],
    namePrefixes: ["Zeta", "Kite", "Nimbus", "Orbit", "Quill", "Vertex", "Loop", "Pixel", "Flux"],
    nameSuffixes: ["Labs", "Technologies", "AI", "HQ", "Systems", "Cloud"],
    offerings: ["SaaS platform", "Mobile app", "APIs", "Enterprise software"],
    needs: ["hiring", "brand and website", "demand generation", "corporate gifting"],
    locationsRange: [1, 3],
    websiteRate: 0.98,
  },
  {
    key: "real_estate",
    label: "Real estate agency",
    industry: "Real Estate",
    keywords: ["real estate", "property dealer", "realtor", "builder", "developer", "brokerage"],
    namePrefixes: ["Prime", "Landmark", "Keystone", "Square", "Metro", "Horizon"],
    nameSuffixes: ["Realty", "Properties", "Estates", "Realtors", "Homes"],
    offerings: ["Residential sales", "Commercial leasing", "Property management"],
    needs: ["lead generation", "property photography", "listings marketing", "CRM"],
    locationsRange: [1, 6],
    websiteRate: 0.75,
  },
  {
    key: "school",
    label: "School & coaching",
    industry: "Education",
    keywords: ["school", "coaching centre", "tuition", "preschool", "academy", "institute", "training centre"],
    namePrefixes: ["Bright", "Little", "Scholars", "Genius", "Pathway", "Aspire", "Vidya"],
    nameSuffixes: ["Academy", "School", "Institute", "Learning Centre", "Classes"],
    offerings: ["Courses", "Coaching", "Test prep", "Workshops"],
    needs: ["admissions marketing", "event photography", "uniforms and merchandise", "website"],
    locationsRange: [1, 10],
    websiteRate: 0.7,
  },
  {
    key: "manufacturer",
    label: "Manufacturer",
    industry: "Manufacturing",
    keywords: ["manufacturer", "factory", "industrial", "fabrication", "production unit", "oem"],
    namePrefixes: ["Precision", "Allied", "National", "Supreme", "Classic", "Unity", "Pioneer"],
    nameSuffixes: ["Industries", "Manufacturing", "Enterprises", "Works", "Pvt Ltd"],
    offerings: ["Contract manufacturing", "OEM supply", "Exports", "Bulk orders"],
    needs: ["B2B lead generation", "trade-show marketing", "hiring", "catalogue design"],
    locationsRange: [1, 4],
    websiteRate: 0.65,
  },
  {
    key: "agency",
    label: "Agency",
    industry: "Professional Services",
    keywords: ["agency", "marketing agency", "digital agency", "creative agency", "advertising agency", "pr agency"],
    namePrefixes: ["Pixel", "Spark", "Brandwave", "Kinetic", "Moxie", "Northstar", "Social"],
    nameSuffixes: ["Media", "Digital", "Studio", "Collective", "Agency"],
    offerings: ["Social media", "Performance marketing", "Branding", "Web design"],
    needs: ["hiring", "client acquisition", "outsourced production", "tools"],
    locationsRange: [1, 3],
    websiteRate: 0.95,
  },
  {
    key: "corporate_office",
    label: "Company / corporate office",
    industry: "Corporate",
    keywords: ["company", "corporate", "office", "enterprise", "firm", "mnc", "business"],
    namePrefixes: ["Global", "Infinity", "Summit", "Nexus", "Apex", "Crescent", "Meridian"],
    nameSuffixes: ["Solutions", "Group", "Consulting", "Corp", "Services", "Partners"],
    offerings: ["Professional services", "Consulting", "Outsourcing", "Enterprise solutions"],
    needs: ["recruitment", "corporate events", "employee gifting", "facility supplies"],
    locationsRange: [1, 5],
    websiteRate: 0.9,
  },
];

const byKey = new Map(CATEGORIES.map((category) => [category.key, category]));

export function getCategory(key: string): CategoryDefinition | undefined {
  return byKey.get(key);
}

/** Naive English singularisation, enough for category words (bakeries → bakery, cafes → cafe). */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function normalisePhrase(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9&\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

/** Maps free text (query fragment, provider category, lead category) to categories, best first. */
export function matchCategories(text: string): CategoryDefinition[] {
  const haystack = ` ${normalisePhrase(text)} `;
  const scored = CATEGORIES.map((category) => {
    let score = 0;
    for (const keyword of [...category.keywords, category.label]) {
      const needle = normalisePhrase(keyword);
      if (needle && haystack.includes(` ${needle} `)) score += needle.split(" ").length * 3;
    }
    return { category, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((entry) => entry.category);
}

export function matchCategory(text: string): CategoryDefinition | undefined {
  return matchCategories(text)[0];
}

// -----------------------------------------------------------------------------
// Places (mock geography). Coordinates are approximate city/locality centres.
// -----------------------------------------------------------------------------

export interface Locality {
  name: string;
  lat: number;
  lng: number;
  postalCode?: string;
}

export interface CityDefinition {
  key: string;
  name: string;
  region: string;
  country: string;
  aliases: string[];
  lat: number;
  lng: number;
  phonePrefix: string;
  localities: Locality[];
  /** Area subsets, e.g. "South Delhi". */
  areas?: Record<string, string[]>;
}

export const CITIES: CityDefinition[] = [
  {
    key: "delhi",
    name: "New Delhi",
    region: "Delhi",
    country: "India",
    aliases: ["delhi", "new delhi", "delhi ncr", "ncr"],
    lat: 28.6139,
    lng: 77.209,
    phonePrefix: "+91 98",
    localities: [
      { name: "Hauz Khas", lat: 28.5494, lng: 77.2001, postalCode: "110016" },
      { name: "Saket", lat: 28.5245, lng: 77.2066, postalCode: "110017" },
      { name: "Greater Kailash", lat: 28.5482, lng: 77.2381, postalCode: "110048" },
      { name: "Defence Colony", lat: 28.5733, lng: 77.2303, postalCode: "110024" },
      { name: "Lajpat Nagar", lat: 28.5677, lng: 77.2433, postalCode: "110024" },
      { name: "Malviya Nagar", lat: 28.5355, lng: 77.2106, postalCode: "110017" },
      { name: "Vasant Kunj", lat: 28.5293, lng: 77.1538, postalCode: "110070" },
      { name: "Connaught Place", lat: 28.6315, lng: 77.2167, postalCode: "110001" },
      { name: "Khan Market", lat: 28.6003, lng: 77.2270, postalCode: "110003" },
      { name: "Rajouri Garden", lat: 28.6492, lng: 77.1226, postalCode: "110027" },
      { name: "Kamla Nagar", lat: 28.6814, lng: 77.2046, postalCode: "110007" },
      { name: "Janakpuri", lat: 28.6219, lng: 77.0878, postalCode: "110058" },
    ],
    areas: {
      "south delhi": ["Hauz Khas", "Saket", "Greater Kailash", "Defence Colony", "Lajpat Nagar", "Malviya Nagar", "Vasant Kunj"],
      "central delhi": ["Connaught Place", "Khan Market"],
      "west delhi": ["Rajouri Garden", "Janakpuri"],
      "north delhi": ["Kamla Nagar"],
    },
  },
  {
    key: "gurgaon",
    name: "Gurugram",
    region: "Haryana",
    country: "India",
    aliases: ["gurgaon", "gurugram"],
    lat: 28.4595,
    lng: 77.0266,
    phonePrefix: "+91 99",
    localities: [
      { name: "Cyber Hub", lat: 28.4953, lng: 77.0888, postalCode: "122002" },
      { name: "Sector 29", lat: 28.4687, lng: 77.0635, postalCode: "122001" },
      { name: "Golf Course Road", lat: 28.4503, lng: 77.0986, postalCode: "122011" },
      { name: "Sohna Road", lat: 28.4089, lng: 77.0428, postalCode: "122018" },
      { name: "DLF Phase 4", lat: 28.4648, lng: 77.0869, postalCode: "122009" },
      { name: "Udyog Vihar", lat: 28.5047, lng: 77.0797, postalCode: "122016" },
    ],
  },
  {
    key: "noida",
    name: "Noida",
    region: "Uttar Pradesh",
    country: "India",
    aliases: ["noida", "greater noida"],
    lat: 28.5355,
    lng: 77.391,
    phonePrefix: "+91 97",
    localities: [
      { name: "Sector 18", lat: 28.5708, lng: 77.3261, postalCode: "201301" },
      { name: "Sector 62", lat: 28.6271, lng: 77.3727, postalCode: "201309" },
      { name: "Sector 63", lat: 28.6208, lng: 77.3812, postalCode: "201301" },
      { name: "Sector 104", lat: 28.5402, lng: 77.3697, postalCode: "201304" },
      { name: "Sector 50", lat: 28.5724, lng: 77.3654, postalCode: "201301" },
    ],
  },
  {
    key: "mumbai",
    name: "Mumbai",
    region: "Maharashtra",
    country: "India",
    aliases: ["mumbai", "bombay"],
    lat: 19.076,
    lng: 72.8777,
    phonePrefix: "+91 98",
    localities: [
      { name: "Bandra West", lat: 19.0596, lng: 72.8295, postalCode: "400050" },
      { name: "Andheri West", lat: 19.1364, lng: 72.8296, postalCode: "400053" },
      { name: "Lower Parel", lat: 18.9953, lng: 72.8300, postalCode: "400013" },
      { name: "Powai", lat: 19.1176, lng: 72.906, postalCode: "400076" },
      { name: "Colaba", lat: 18.9067, lng: 72.8147, postalCode: "400005" },
    ],
  },
  {
    key: "bangalore",
    name: "Bengaluru",
    region: "Karnataka",
    country: "India",
    aliases: ["bangalore", "bengaluru"],
    lat: 12.9716,
    lng: 77.5946,
    phonePrefix: "+91 96",
    localities: [
      { name: "Indiranagar", lat: 12.9784, lng: 77.6408, postalCode: "560038" },
      { name: "Koramangala", lat: 12.9352, lng: 77.6245, postalCode: "560034" },
      { name: "HSR Layout", lat: 12.9116, lng: 77.6474, postalCode: "560102" },
      { name: "Whitefield", lat: 12.9698, lng: 77.75, postalCode: "560066" },
      { name: "Jayanagar", lat: 12.925, lng: 77.5938, postalCode: "560041" },
    ],
  },
  {
    key: "london",
    name: "London",
    region: "England",
    country: "United Kingdom",
    aliases: ["london"],
    lat: 51.5074,
    lng: -0.1278,
    phonePrefix: "+44 20",
    localities: [
      { name: "Shoreditch", lat: 51.5265, lng: -0.0786 },
      { name: "Soho", lat: 51.5136, lng: -0.1365 },
      { name: "Camden", lat: 51.539, lng: -0.1426 },
      { name: "Clapham", lat: 51.4622, lng: -0.138 },
      { name: "Canary Wharf", lat: 51.5054, lng: -0.0235 },
    ],
  },
  {
    key: "dubai",
    name: "Dubai",
    region: "Dubai",
    country: "United Arab Emirates",
    aliases: ["dubai"],
    lat: 25.2048,
    lng: 55.2708,
    phonePrefix: "+971 4",
    localities: [
      { name: "Downtown Dubai", lat: 25.1972, lng: 55.2744 },
      { name: "Dubai Marina", lat: 25.0805, lng: 55.1403 },
      { name: "Jumeirah", lat: 25.2048, lng: 55.2475 },
      { name: "Business Bay", lat: 25.1865, lng: 55.2654 },
    ],
  },
];

const cityAliasIndex = CITIES.flatMap((city) => city.aliases.map((alias) => ({ alias, city }))).sort(
  (a, b) => b.alias.length - a.alias.length,
);

export function matchCity(text: string): CityDefinition | undefined {
  const haystack = ` ${text.toLowerCase()} `;
  for (const area of CITIES.flatMap((city) => Object.keys(city.areas ?? {}).map((name) => ({ name, city })))) {
    if (haystack.includes(area.name)) return area.city;
  }
  return cityAliasIndex.find(({ alias }) => haystack.includes(` ${alias} `) || haystack.includes(` ${alias},`))?.city;
}

/** Returns the named sub-area ("south delhi") mentioned in the text, if any. */
export function matchArea(text: string, city: CityDefinition): { name: string; localities: string[] } | undefined {
  const haystack = text.toLowerCase();
  for (const [name, localities] of Object.entries(city.areas ?? {})) {
    if (haystack.includes(name)) return { name, localities };
  }
  const locality = city.localities.find((item) => haystack.includes(item.name.toLowerCase()));
  return locality ? { name: locality.name, localities: [locality.name] } : undefined;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
