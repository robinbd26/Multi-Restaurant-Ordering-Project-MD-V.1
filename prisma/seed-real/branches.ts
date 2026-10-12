/**
 * The 16 real branches (client's branch sheets, October 2026).
 *
 * Three combined branches serve BOTH brands (Uttara, Bailey Road, Gulshan); the
 * other 13 serve one brand each, even where a Cheez and a Madchef share a
 * building (different floors). Phones are stored as 11 digits, the format the
 * branch form validates.
 *
 * PINS. Every point was looked up through Barikoi (the app's own geocoder) by
 * business name and by address, and cross-checked. `pinSource` and
 * `pinConfidence` record how each was chosen; the report in
 * docs/handoff/real-catalog-and-screenshots-report.md lists the evidence and a
 * Google Maps link per branch so each pin can be checked by eye.
 */

export type BranchBrandSlug = "cheez" | "madchef";

export interface RealBranch {
  /** Stable key used by the seed (never shown). */
  key: string;
  name: string;
  brands: BranchBrandSlug[];
  businessType: "dine_in" | "cloud_kitchen";
  /** Zone tag (grouping only; delivery is the drawn area). */
  zone: string;
  address: string;
  phone: string;
  /** "" = no bKash number given; bKash is then left switched off. */
  bkash: string;
  /** A second contact number, stored as the branch's pickup phone. */
  extraPhone?: string;
  lat: number;
  lng: number;
  pinSource: string;
  pinConfidence: "high" | "medium" | "low";
  /** Things the branch has no field for, recorded in the report instead. */
  notes?: string;
}

/** The company hotline from the prototype, used where a branch gave no number. */
export const HOTLINE = "09638050505";

export const REAL_BRANCHES: RealBranch[] = [
  {
    key: "uttara",
    name: "Uttara",
    brands: ["cheez", "madchef"],
    businessType: "dine_in",
    zone: "Uttara",
    address: "4th Floor, House 34, Gareeb-e-Nawaz Ave, Sector 11, Uttara, Dhaka",
    phone: "01764244343",
    bkash: "01764244343",
    lat: 23.877259,
    lng: 90.391019,
    pinSource: "Barikoi name (\"Madchef, House 34, Gareeb E Newaz Avenue\") = Barikoi address; \"Cheez Uttara\" 20 m away",
    pinConfidence: "high",
  },
  {
    key: "bailey-road",
    name: "Bailey Road",
    brands: ["cheez", "madchef"],
    businessType: "dine_in",
    zone: "Bailey Road",
    address: "5th Floor, Bangladesh Mohila Samity, 4 Natok Sarani (New Bailey Road), Dhaka 1000",
    phone: "01704360944",
    bkash: "01704360944",
    lat: 23.741915,
    lng: 90.408518,
    pinSource: "Barikoi name (\"Madchef & Cheez (Bailey Road), House 4, New Bailey Road\") = Barikoi address",
    pinConfidence: "high",
  },
  {
    key: "gulshan",
    name: "Gulshan",
    brands: ["cheez", "madchef"],
    businessType: "cloud_kitchen",
    zone: "Gulshan",
    address: "1st Floor, House 07, Road 13, Gulshan 1, Dhaka",
    phone: "01312195220",
    bkash: "01312195220",
    extraPhone: "01793708359",
    lat: 23.778878,
    lng: 90.412757,
    pinSource: "Barikoi address (\"House 7, Road 13, Gulshan 1\"); name search finds no Cheez/Madchef listing here, web search found none either",
    pinConfidence: "medium",
    notes: "Extra contact 01793-708359 stored as the branch's pickup phone (the branch has no second-phone field).",
  },
  {
    key: "cheez-dhanmondi",
    name: "Cheez Dhanmondi",
    brands: ["cheez"],
    businessType: "dine_in",
    zone: "Dhanmondi",
    address: "KB Square Building, House 49/A, Road 9/A, opposite Ibn Sina Hospital, Dhanmondi, Dhaka",
    phone: "01312195222",
    bkash: "01312195222",
    lat: 23.744689,
    lng: 90.372219,
    pinSource: "Barikoi name (\"Cheez, Rangs KB Square, Road 9/A\"); Barikoi address (House 49, Road 9/A) 20 m away",
    pinConfidence: "high",
  },
  {
    key: "madchef-dhanmondi",
    name: "Madchef Dhanmondi",
    brands: ["madchef"],
    businessType: "dine_in",
    zone: "Dhanmondi",
    address: "KB Square Building, House 49/A, Road 9/A, opposite Ibn Sina Hospital, Dhanmondi, Dhaka",
    phone: "01312195222",
    bkash: "01312195222",
    lat: 23.744869,
    lng: 90.372083,
    pinSource: "Barikoi address (\"House 49, Road 9/A, Sat Masjid Road\"); no Madchef listing by name; same building as Cheez Dhanmondi",
    pinConfidence: "high",
  },
  {
    key: "cheez-banani",
    name: "Cheez Banani",
    brands: ["cheez"],
    businessType: "dine_in",
    zone: "Banani",
    address: "2nd Floor, House 47, Road 11, Block H, Banani, Dhaka",
    phone: "01316195220",
    bkash: "01316195220",
    lat: 23.789982,
    lng: 90.408999,
    pinSource: "Barikoi name (\"Cheez Banani, Navana Rowshan Sayed Plaza, House 47, Road 11, Block H\") = Barikoi address",
    pinConfidence: "high",
  },
  {
    key: "madchef-banani",
    name: "Madchef Banani",
    brands: ["madchef"],
    businessType: "dine_in",
    zone: "Banani",
    address: "2nd Floor, House 47, Road 11, Block H, Banani, Dhaka",
    phone: "01316195220",
    bkash: "01316195220",
    lat: 23.790049,
    lng: 90.409008,
    pinSource: "Barikoi address (Navana Rowshan Sayed Plaza, House 47, Road 11, Block H); no Madchef listing by name; same building as Cheez Banani",
    pinConfidence: "high",
  },
  {
    key: "cheez-bashundhara",
    name: "Cheez Bashundhara",
    brands: ["cheez"],
    businessType: "dine_in",
    zone: "Bashundhara",
    address: "Jabbar Molla Tower, Apollo Gate, next to Dutch-Bangla Bank, Bashundhara R/A, Dhaka",
    phone: "01312195221",
    bkash: "01312195221",
    lat: 23.80873,
    lng: 90.43035,
    pinSource: "Barikoi name (\"Cheez Bashundhara, Apollo Hospital Road\"); Barikoi address (Bashundhara Block A gate) 240 m away",
    pinConfidence: "medium",
  },
  {
    key: "madchef-bashundhara",
    name: "Madchef Bashundhara",
    brands: ["madchef"],
    businessType: "dine_in",
    zone: "Bashundhara",
    address: "Jabbar Molla Tower, Apollo Gate, next to Dutch-Bangla Bank, Bashundhara R/A, Dhaka",
    phone: "01312195221",
    bkash: "01312195221",
    lat: 23.808745,
    lng: 90.430375,
    pinSource: "Same building as Cheez Bashundhara (no Madchef listing by name; Jabbar Molla Tower not in Barikoi)",
    pinConfidence: "medium",
  },
  {
    key: "cheez-khilgaon",
    name: "Cheez Khilgaon",
    brands: ["cheez"],
    businessType: "dine_in",
    zone: "Khilgaon",
    address: "House 380, Shohid Baki Road, Taltola, beside Apon Coffee House, Khilgaon, Dhaka",
    phone: "01321180273",
    bkash: "01321180273",
    lat: 23.752227,
    lng: 90.421569,
    pinSource: "Barikoi name (\"Cheez, House 380, Shahid Baki Road, Taltola\") = Barikoi address; Apon Coffee House (No. 381) 10 m away",
    pinConfidence: "high",
  },
  {
    key: "madchef-khilgaon",
    name: "Madchef Khilgaon",
    brands: ["madchef"],
    businessType: "dine_in",
    zone: "Khilgaon",
    address: "House 380, Shohid Baki Road, Taltola, beside Apon Coffee House, Khilgaon, Dhaka",
    phone: "01334931438",
    bkash: "01334931438",
    lat: 23.752192,
    lng: 90.421643,
    pinSource: "Barikoi address (House 380, Shahid Baki Road); no Madchef listing by name; same building as Cheez Khilgaon",
    pinConfidence: "high",
  },
  {
    key: "cheez-mirpur",
    name: "Cheez Mirpur",
    brands: ["cheez"],
    businessType: "cloud_kitchen",
    zone: "Mirpur",
    address: "House 30, Avenue 05, Block B, Section 06, Mirpur, Dhaka 1216",
    phone: "01334931443",
    bkash: "01311073775",
    lat: 23.810366,
    lng: 90.362866,
    pinSource: "Barikoi address (\"House 30, Avenue 5, Block B, Section 6\"). Barikoi's \"Cheez Mirpur\" listing sits at House 2/A Road 4 (the Madchef Mirpur building), 500 m away; the client's sheet places this cloud kitchen at House 30, so the address wins",
    pinConfidence: "medium",
    notes: "Manager on record: Mohammad Rashel Hosen (no login created; branches have no notes field).",
  },
  {
    key: "madchef-mirpur",
    name: "Madchef Mirpur",
    brands: ["madchef"],
    businessType: "dine_in",
    zone: "Mirpur",
    address: "3rd Floor, Upoma Plaza, House 2/A, Road 4, Block A, Section 6, Mirpur, Dhaka 1216",
    phone: "01334931443",
    bkash: "01311073775",
    lat: 23.809399,
    lng: 90.36778,
    pinSource: "Barikoi address (House 2/A, Road 4, Block A, Section 6; a \"Cheez\" listing at the same house). Barikoi's \"Madchef Mirpur\" name hit is on Mirpur Main Road, Section 10, 550 m away and does not match the sheet",
    pinConfidence: "medium",
  },
  {
    key: "cheez-mohammadpur",
    name: "Cheez Mohammadpur",
    brands: ["cheez"],
    businessType: "cloud_kitchen",
    zone: "Mohammadpur",
    address: "15/6 Tikka Para Road, Hazi Cinnu Mia Road, Spicy 6 lane, Mohammadpur, Dhaka",
    phone: "01714061305",
    bkash: "01714061305",
    lat: 23.76801,
    lng: 90.36164,
    pinSource: "Barikoi address: the point where Tikka Para Road meets Haji Chinu Mia Road. Alternative: Barikoi has \"Cheez And Beanz, House 15/6, Tajmahal Road\" (23.763434, 90.362184), 520 m south; check which one is right",
    pinConfidence: "low",
  },
  {
    key: "cheez-banasree",
    name: "Cheez Banasree",
    brands: ["cheez"],
    businessType: "cloud_kitchen",
    zone: "Banasree",
    address: "4th Floor, House 9, Block A, Banasree Main Road, Dhaka",
    phone: HOTLINE,
    bkash: "",
    lat: 23.765997,
    lng: 90.426135,
    pinSource: "Barikoi address (\"House 9, Banasree Main Road, Block A\"); no Cheez/Madchef listing by name",
    pinConfidence: "medium",
    notes: "No phone or bKash number given: phone set to the company hotline 09638-050505, bKash off.",
  },
  {
    key: "madchef-banasree",
    name: "Madchef Banasree",
    brands: ["madchef"],
    businessType: "cloud_kitchen",
    zone: "Banasree",
    address: "4th Floor, House 9, Block A, Banasree Main Road, Dhaka",
    phone: HOTLINE,
    bkash: "",
    lat: 23.765997,
    lng: 90.426135,
    pinSource: "Same building as Cheez Banasree (Barikoi address)",
    pinConfidence: "medium",
    notes: "No phone or bKash number given: phone set to the company hotline 09638-050505, bKash off.",
  },
];

/** The zone tags, correctly spelled, in display order. */
export const REAL_ZONES = [
  "Uttara",
  "Bashundhara",
  "Gulshan",
  "Banani",
  "Mirpur",
  "Mohammadpur",
  "Dhanmondi",
  "Bailey Road",
  "Khilgaon",
  "Banasree",
];

/** Ordering hours per brand ("HH:MM", Asia/Dhaka). A crossing slot runs past midnight. */
export const BRAND_HOURS: Record<BranchBrandSlug, { start: string; end: string }> = {
  madchef: { start: "11:00", end: "22:30" },
  cheez: { start: "11:00", end: "04:00" },
};

/** Dining branches: seated until 11:00 PM, no new guests after 10:30 PM. */
export const DINE_IN = { start: "11:00", end: "23:00", lastEntry: "22:30" };

/** One delivery area per branch: a 5 km circle around the pin. */
export const DELIVERY_AREA = { radiusKm: 5, charge: 60, etaMinutes: 45 };
