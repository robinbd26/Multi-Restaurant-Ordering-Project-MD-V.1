/**
 * MAD Delivery — area / sub-area master data for the compact address picker.
 *
 * The customer picks a "main area" (Select Your Area) from this list — or
 * "+ Add your Own" for a custom main area typed into a free-text input.
 * A "sub-area" (Select Area) is then shown filtered to that main area; only
 * predefined sub-areas are offered.
 *
 * Road/Lane is a free-text field, not a dropdown.
 *
 * This file is the single source of truth for the address form dropdowns.
 */

export interface AreaEntry {
  main: string;
  subs: string[];
}

export const AREAS: AreaEntry[] = [
  {
    main: "Banani",
    subs: [
      "All Over Banani",
      "Army stadium",
      "Baridhara dip areas",
      "Baridhara DOHS",
      "Baridhara J Block",
      "Dhaka Cantonment",
      "Falcon Tower",
      "Jahangir Gate",
      "Mohakhali DOHS",
      "Mohakhali Jhol Khabar",
      "Mohakhali Rail Gate",
      "Mohakhali TV Gate (Main Road)",
      "Mohakhali wireless gate",
    ],
  },
  {
    main: "Gulshan",
    subs: [
      "Gudara ghat (main road)",
      "Gulshan-1",
      "Middle Badda",
      "Nabisco",
      "Niketon",
      "Police plaza",
      "suvastu tower (main road)",
      "tejgaon brac bank",
      "tejgaon mohila college",
      "tejgaon shanta tower",
      "uttar badda main road",
      "Shazadpur",
    ],
  },
  {
    main: "Dhanmondi",
    subs: [
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
    main: "Mohammodpur",
    subs: [
      "Adabor full",
      "Asad Avenue",
      "Asha University",
      "Aongzeb road",
      "Aziz Moholla",
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
    ],
  },
  {
    main: "Khilgaon",
    subs: [
      "Bangla Motor",
      "Bonosre (Block F-H)",
      "Khilgaon",
      "Modhubag",
      "Malibagh",
      "Mirbag",
      "Mogbazar",
      "Moghbazar Wireless",
      "Mohanagar Project",
      "Mouchak",
      "Shantibaag",
      "Taltola",
      "T.V. Link Road",
      "Rajarbagh Police Lines",
      "South Banasree",
      "Rampura",
      "Aftab Nagar",
      "Basabo-",
    ],
  },
  {
    main: "Beaily road",
    subs: [
      "Dilu Road",
      "Chamelibagh",
      "Eskaton Garden",
      "Eskaton Road",
      "kakrail",
      "Mintu Road",
      "New Bailey Road",
      "rajabar",
      "Ramna",
      "Shegunbagicha",
      "Shanti Nagar",
      "Siddeshwari",
      "SSL Wireless",
    ],
  },
  {
    main: "Mirpur",
    subs: [
      "Mirpur -1",
      "Mirpur -2",
      "Mirpur -6",
      "Mirpur -7",
      "Mirpur -10",
      "Mirpur -11",
      "Mirpur -11 (1/2)",
      "Mirpur -12",
      "Mirpur -13",
      "Mirpur -14",
      "Mirpur -15",
      "Mirpur DOHS",
      "Bijoy Rken City",
      "Ebrahimpur",
      "Kazipara",
      "Shewrapara",
      "Kafrul",
      "Arambaag",
      "CRP Hospital",
      "Commerce College",
      "Kachukhet",
      "Zoo Road",
      "Milk Vita Road",
      "Rupnagar R/A",
      "Ex . Pallabi",
    ],
  },
  {
    main: "Uttara",
    subs: [
      "Sector -1",
      "Sector 2",
      "Sector 3",
      "Sector 4",
      "Sector 5",
      "Sector 6",
      "Sector 7",
      "Sector 8",
      "Sector 9",
      "Sector 10",
      "Sector 11",
      "Sector 12",
      "Sector 13",
      "Sector 14",
    ],
  },
  {
    main: "Basundhara",
    subs: ["Basundhara ALL", "Nikunju-1", "Nikunju-2"],
  },
];

/** Main area names, in display order. */
export const MAIN_AREA_NAMES: string[] = AREAS.map((a) => a.main);

/** Sub-areas for a given main area. Returns [] for unknown main areas. */
export function subAreasFor(mainArea: string): string[] {
  const entry = AREAS.find((a) => a.main === mainArea);
  return entry ? entry.subs : [];
}

/**
 * Road/Lane is a free-text input since location v4 — customers type values like
 * "Road 11", "Lane 5" or "Main Road" rather than choosing from a fixed range.
 * Kept exported for historical reference; the customer form no longer uses it.
 */
export const ROAD_LANE_OPTIONS: string[] = Array.from({ length: 100 }, (_, i) => `Road ${i + 1}`);

/** Sentinel value that reveals a free-text input (custom main area / legacy custom sub-area). */
export const CUSTOM_VALUE = "__custom__";
