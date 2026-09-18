/**
 * MAD Delivery — the SEED for the master zone / locality list.
 *
 * Phase 2 moves the master list into the database, where a super admin owns it.
 * This file is only the starting content for that table: it is read by the
 * seeder and by the migration backfill, never by the UI. Once a row exists in
 * the database, the database wins — editing this file does not rename or delete
 * anything a super admin has since changed.
 *
 * PROVENANCE. Merged from three sources, in this order of authority:
 *   1. AshMd's operational day sheet (11:00–22:45) — the column per zone.
 *   2. AshMd's night sheet (22:45–04:00) — adds localities the day sheet omits;
 *      the night sheet pairs zones per shift (Banani+Gulshan, and so on), which
 *      is a STAFFING arrangement, not a different set of places, so its entries
 *      are folded back into the zone each locality actually belongs to. Names
 *      repeated between its column groups are the same locality listed twice
 *      and are merged here.
 *   3. lib/constants/area-data.ts — the hardcoded list this replaces, kept so no
 *      locality an existing saved address already references disappears.
 *
 * Two deliberate corrections to the old constant, both taking the sheets as
 * correct: the zone spelled "Beaily road" is "Bailey Road", and Basundhara
 * carries the sheet's own localities rather than the invented "Nikunju" ones.
 *
 * Coverage is NOT decided here. This list says which places exist; each branch
 * then ticks the ones it delivers to, per time window.
 */

export interface AreaMasterZone {
  /** Zone name as operations says it. */
  name: string;
  /** Specific localities inside that zone. */
  localities: string[];
}

export const AREA_MASTER: AreaMasterZone[] = [
  {
    name: "Banani",
    localities: [
      "All Over Banani",
      "Army stadium",
      "Baridhara dip areas",
      "Baridhara DOHS",
      "Baridhara J Block",
      "Dhaka Cantonment",
      "Falcon Tower",
      "Gulshan-2",
      "Jahangir Gate",
      "Mohakhali DOHS",
      "Mohakhali Jhol Khabar",
      "Mohakhali Rail Gate",
      "Mohakhali TV Gate (Main Road)",
      "Mohakhali wireless gate",
      "Namara restaurant",
      "Navy HQ",
      "Rawya Club",
      "Shadhinata Tower",
      "SKS Tower",
      "Zia Colony (Main Road)",
    ],
  },
  {
    name: "Gulshan",
    localities: [
      "Badda All",
      "Begun bari",
      "Bonosre (A-E)",
      "Gudara ghat (Main Road)",
      "Gulshan-1",
      "Hatirjheel Mohanagar Project",
      "Impulse Hospital",
      "Link Road",
      "Middle Badda",
      "Nabisco",
      "Niketon",
      "Novonil",
      "Police Plaza",
      "Shahjadpur",
      "Shanta Tower",
      "Suvastu Tower",
      "Tejgaon",
      "Tejgaon Brac Bank",
      "Tejgaon Mohila College",
      "Tejkunipara",
      "Uttar Badda",
      "West Nakhalpara",
    ],
  },
  {
    name: "Dhanmondi",
    localities: [
      "All over Dhanmondi",
      "BGB Gate no-4",
      "Central road",
      "City College",
      "Elephant Road",
      "Green Road",
      "Jafrabad- Shankar Road",
      "Kalabagan",
      "Lalmatia",
      "Modhu Bazar",
      "North Road",
      "North Circural road",
      "Panthapath",
      "Rayer bazar",
      "Shukrabad",
      "Sikder Medical College",
      "Sobhanbag Officer's Quarter",
      "Zigatala High School",
      "Zigatala Post Office",
    ],
  },
  {
    name: "Mohammodpur",
    localities: [
      "Adabor full",
      "Asad Avenue",
      "Asha University",
      "Aongzeb road",
      "Aziz Moholla Road",
      "Azam Road",
      "Babor Road",
      "Bash Bari",
      "Bijli Mohalla",
      "Chanmia Housing",
      "Dhaka Housing",
      "Gajnabi Road",
      "Humayun Road",
      "Iqbal Road",
      "Japan Garden City",
      "Johari Mohalla",
      "Katasur",
      "Kazi Nazrul Islam Road",
      "Krishi Market",
      "Mohammodpur Bus Stand",
      "mohammadiya housing limited",
      "Mohammadia Housing Society",
      "Monsurabad Housing",
      "Nobodoy Housing Society",
      "Nurjahan Road",
      "Probal Housing",
      "Razia Sultana Road",
      "Ring Road",
      "Sahjahan Road",
      "Shamoly Square",
      "Shekhertek (pc Culture)",
    ],
  },
  {
    name: "Khilgaon",
    localities: [
      "Aftab Nagar",
      "Bangla Motor",
      "Basabo",
      "Bonosre (Block F-H) ALL",
      "Khilgaon",
      "Malibagh",
      "Mirbag",
      "Modhubag",
      "Mogbazar",
      "Moghbazar Wireless",
      "Mohanagar Project",
      "Mouchak",
      "Rajarbagh Police Lines",
      "Rampura",
      "Shantibaag",
      "South Banasree",
      "Taltola",
      "T.V. Link Road",
    ],
  },
  {
    name: "Bailey Road",
    localities: [
      "Chamelibagh",
      "Dilu Road",
      "Eskaton Garden",
      "Eskaton Road",
      "Kakrail",
      "Mintu Road",
      "New Bailey Road",
      "Rajabar",
      "Ramna",
      "Shanti Nagar",
      "Shegunbagicha",
      "Siddeshwari",
      "SSL Wireless",
    ],
  },
  {
    name: "Mirpur",
    localities: [
      "Arambaag",
      "Bijoy Rken City",
      "Commerce College",
      "CRP Hospital",
      "Ebrahimpur",
      "Ex. Pallabi",
      "Kachukhet",
      "Kafrul",
      "Kazipara",
      "Milk Vita Road",
      "Mirpur-1",
      "Mirpur-2",
      "Mirpur-6",
      "Mirpur-7",
      "Mirpur-10",
      "Mirpur-11",
      "Mirpur-11 (1/2)",
      "Mirpur-12",
      "Mirpur-13",
      "Mirpur-14",
      "Mirpur-15",
      "Mirpur DOHS",
      "Rupnagar R/A",
      "Shewrapara",
      "Zoo Road",
    ],
  },
  {
    name: "Uttara",
    localities: [
      "Sector-1",
      "Sector-2",
      "Sector-3",
      "Sector-4",
      "Sector-5",
      "Sector-6",
      "Sector-7",
      "Sector-8",
      "Sector-9",
      "Sector-10",
      "Sector-11",
      "Sector-12",
      "Sector-13",
      "Sector-14",
    ],
  },
  {
    name: "Basundhara",
    localities: ["All Bashundhara", "Nikonjo-1", "Nikonjo-2"],
  },
];

/** Case/space-insensitive key, matching normalizeAreaName in the areas service. */
export function normalizeMasterName(name: string): string {
  return name.trim().toLowerCase();
}
