/** Fictional name and address material. Everything here is SYNTHETIC. */

export const VENDOR_PREFIXES = [
  "Bayline", "Quillfeather", "Harrowgate", "Tamarisk", "Lanternfield", "Copperline", "Redfern",
  "Stonebridge", "Alderwick", "Marrowdale", "Fennimore", "Oakhaven", "Silverleaf", "Windhollow",
  "Ironvale", "Larkspur", "Cobalt Ridge", "Juniper Bay", "Meadowlark", "Northgate", "Saltmarsh",
  "Thornbury", "Umberfield", "Westerly", "Yarrowdale", "Ashgrove", "Bellwether", "Cinder Hill",
  "Driftmoor", "Elmstead", "Foxglove", "Greywell", "Hollisford", "Ivywood", "Jasper Cove",
  "Kestrelton", "Lowell Park", "Mosswood", "Nettleton", "Pemberly", "Rushmere", "Tidewater Row",
  "Underhill", "Vesperline", "Wrenfield", "Zephyr Lane", "Almondvale", "Brackenridge",
  "Coldwater Bend", "Dunmore Heath", "Emberstone", "Fairhollow", "Glenmoor", "Harbinger Hill",
  "Inkwell Point", "Kingsmere", "Lindenhurst Row", "Moonrake", "Oldcastle Bay", "Quarrystone",
  "Ravenhill", "Starling Fork", "Tallowby", "Upland Reach", "Wexcombe",
] as const;

/** [full trade word, abbreviation used in truncated payee variants] */
export const VENDOR_TRADES: ReadonlyArray<readonly [string, string]> = [
  ["Electric", "ELEC"], ["Plumbing", "PLMB"], ["Supply", "SUPPLY"], ["Logistics", "LOGIS"],
  ["Freight", "FRT"], ["Packaging", "PKG"], ["Lighting", "LTG"], ["Metalworks", "METAL"],
  ["Printing", "PRTG"], ["Staffing", "STAFF"], ["Janitorial", "JANIT"], ["Hardware", "HDWR"],
  ["Lumber", "LBR"], ["Glass", "GLASS"], ["Paving", "PAVING"], ["Fasteners", "FASTN"],
  ["Industrial", "INDL"], ["Cabinetry", "CABNT"], ["Coatings", "COATG"], ["Services", "SVCS"],
];

export const VENDOR_SUFFIXES = ["Inc.", "LLC", "Co.", "Corp."] as const;

export const CUSTOMER_PREFIXES = [
  "Orchard Row", "Maple Quay", "Cresthaven", "Pinegate", "Sunbarrow", "Tilden Court",
  "Vineyard Lane", "Wickham", "Ashby Green", "Brookmere", "Calloway Hill", "Dovecote",
  "Eastmoor", "Fernbank", "Goldcrest", "Hawthorne Bay", "Ivory Mill", "Kettleridge",
  "Linwood Square", "Morrow Creek", "Northfield Park", "Overlook", "Plumtree", "Redwater",
  "Sandpiper", "Thistledown", "Valleyview Row", "Whitestone", "Yellowpine", "Zinnia Court",
];
export const CUSTOMER_KINDS = [
  "Cafe", "Dental Group", "Studios", "Market", "Boutique", "Fitness", "Bistro", "Realty",
  "Design Co.", "Clinic",
];

export const FIRST_NAMES = [
  "Maria", "Devon", "Priya", "Marcus", "Elena", "Tomas", "Noor", "Callum", "Imani", "Jonas",
  "Lucia", "Andre", "Keiko", "Rafael", "Sienna", "Dmitri", "Amara", "Wesley", "Talia", "Owen",
  "Farah", "Gideon", "Hana", "Isidro",
];
export const LAST_NAMES = [
  "Delgado", "Whitlock", "Okafor", "Brandt", "Castellan", "Feldmann", "Hargrove", "Iyer",
  "Jankowski", "Kowalczyk", "Lindqvist", "Moreau", "Nakamura", "Osei", "Prentiss", "Quintero",
  "Rasmussen", "Sorensen", "Tarkington", "Underwood", "Vasquez", "Winslow", "Yamashita", "Zielinski",
];

export const STREET_NAMES = [
  "Sablewood", "Tamarind", "Quarry", "Heron", "Foundry", "Cinder", "Larkfield", "Ropewalk",
  "Millrace", "Bramble", "Tinker", "Copper Kettle", "Windlass", "Harrow", "Stillwater",
  "Orchard Gate", "Lantern", "Pewter", "Saltbox", "Dovetail", "Kiln", "Marlpit", "Spindle",
  "Cobbler", "Fallow", "Gantry", "Ironbark", "Jetty", "Ledger", "Mortise",
];
export const STREET_SUFFIXES = ["Street", "Avenue", "Drive", "Road", "Lane", "Boulevard", "Way"];

/** state -> [city, ZIP 3-digit prefix consistent with the USPS table] */
export const CITY_TABLE: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  CA: [["Sacramento", "958"], ["Fresno", "937"], ["San Jose", "951"], ["Oakland", "946"],
    ["Los Angeles", "900"], ["San Diego", "921"], ["Bakersfield", "933"], ["Long Beach", "908"]],
  TX: [["Austin", "787"], ["Dallas", "752"], ["Houston", "770"], ["San Antonio", "782"],
    ["El Paso", "799"], ["Fort Worth", "761"], ["Waco", "767"], ["Lubbock", "794"]],
  DE: [["Wilmington", "198"], ["Dover", "199"], ["Newark", "197"]],
  NY: [["Albany", "122"], ["Buffalo", "142"], ["Rochester", "146"], ["Syracuse", "132"]],
  WA: [["Seattle", "981"], ["Spokane", "992"], ["Tacoma", "984"]],
  IL: [["Chicago", "606"], ["Peoria", "616"], ["Rockford", "611"]],
  FL: [["Tampa", "336"], ["Orlando", "328"], ["Miami", "331"], ["Jacksonville", "322"]],
  AZ: [["Phoenix", "850"], ["Tucson", "857"]],
  GA: [["Atlanta", "303"], ["Savannah", "314"]],
  OR: [["Portland", "972"], ["Eugene", "974"]],
};

/** Deliberately ambiguous city names: a city alone cannot determine a state. */
export const AMBIGUOUS_CITIES = [
  "Springfield", "Columbus", "Franklin", "Madison", "Clinton", "Salem", "Greenville", "Bristol",
];
