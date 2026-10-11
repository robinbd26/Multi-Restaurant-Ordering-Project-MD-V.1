/**
 * Demo people for the real catalogue. Every name is FICTIONAL (common
 * Bangladeshi first and last names, put together at random); none is a real
 * employee or customer. Usernames are derived from the name with the app's own
 * rule (lib/validation/username.ts: "Tanvir" + "Ahmed" → "tanvir.ahmed").
 *
 * Uttara is run by the original demo accounts `branch_manager` and `rider`, so
 * it has no entry here. Every other branch gets one manager and two riders.
 */

export interface DemoPerson {
  firstName: string;
  lastName: string;
}

export interface BranchStaff {
  manager: DemoPerson;
  riders: [DemoPerson, DemoPerson];
}

const p = (firstName: string, lastName: string): DemoPerson => ({ firstName, lastName });

/** Keyed by RealBranch.key (prisma/seed-real/branches.ts). */
export const BRANCH_STAFF: Record<string, BranchStaff> = {
  "bailey-road": { manager: p("Farhana", "Rahman"), riders: [p("Jahid", "Hasan"), p("Shohel", "Rana")] },
  gulshan: { manager: p("Tanvir", "Ahmed"), riders: [p("Mizanur", "Rahman"), p("Rasel", "Mia")] },
  "cheez-dhanmondi": { manager: p("Nusrat", "Jahan"), riders: [p("Alamgir", "Hossain"), p("Nayeem", "Islam")] },
  "madchef-dhanmondi": { manager: p("Sabbir", "Hossain"), riders: [p("Faruk", "Ahmed"), p("Sakib", "Alamin")] },
  "cheez-banani": { manager: p("Mehjabin", "Chowdhury"), riders: [p("Habibur", "Rahman"), p("Monir", "Hossain")] },
  "madchef-banani": { manager: p("Rakibul", "Islam"), riders: [p("Ripon", "Sarker"), p("Shamim", "Reza")] },
  "cheez-bashundhara": { manager: p("Sharmin", "Akter"), riders: [p("Babul", "Mia"), p("Selim", "Uddin")] },
  "madchef-bashundhara": { manager: p("Imran", "Kabir"), riders: [p("Arafat", "Hossain"), p("Sujon", "Ali")] },
  "cheez-khilgaon": { manager: p("Shafiqul", "Alam"), riders: [p("Robiul", "Islam"), p("Masud", "Parvez")] },
  "madchef-khilgaon": { manager: p("Tasnim", "Ferdous"), riders: [p("Shakil", "Ahmed"), p("Polash", "Mia")] },
  "cheez-mirpur": { manager: p("Arif", "Mahmud"), riders: [p("Jewel", "Rana"), p("Liton", "Das")] },
  "madchef-mirpur": { manager: p("Sumaiya", "Haque"), riders: [p("Anwar", "Hossain"), p("Rubel", "Hossain")] },
  "cheez-mohammadpur": { manager: p("Mahmudul", "Hasan"), riders: [p("Hasibul", "Islam"), p("Nazmul", "Huda")] },
  "cheez-banasree": { manager: p("Rumana", "Sultana"), riders: [p("Rafiqul", "Islam"), p("Tarek", "Aziz")] },
  "madchef-banasree": { manager: p("Kamrul", "Hasan"), riders: [p("Mamun", "Khan"), p("Biplob", "Roy")] },
};

export interface DemoAddress {
  label: string;
  area: string;
  road: string;
  house: string;
  address: string;
  lat: number;
  lng: number;
}

export interface DemoCustomer extends DemoPerson {
  address: DemoAddress;
}

/** The original demo `customer`'s saved address: inside Uttara's 5 km area. */
export const DEMO_CUSTOMER_ADDRESS: DemoAddress = {
  label: "Home",
  area: "Uttara",
  road: "Road 14",
  house: "House 12",
  address: "House 12, Road 14, Sector 7, Uttara, Dhaka",
  lat: 23.8725,
  lng: 90.399,
};

/** Six extra demo customers, each living inside one or more branches' areas. */
export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { ...p("Anika", "Tabassum"), address: { label: "Home", area: "Banani", road: "Road 27", house: "House 8", address: "House 8, Road 27, Block K, Banani, Dhaka", lat: 23.794, lng: 90.404 } },
  { ...p("Rifat", "Chowdhury"), address: { label: "Home", area: "Dhanmondi", road: "Road 27", house: "House 41", address: "House 41, Road 27 (old), Dhanmondi, Dhaka", lat: 23.752, lng: 90.374 } },
  { ...p("Sadia", "Islam"), address: { label: "Home", area: "Mirpur", road: "Road 3", house: "House 15", address: "House 15, Road 3, Block C, Section 2, Mirpur, Dhaka", lat: 23.806, lng: 90.365 } },
  { ...p("Fahim", "Ahmed"), address: { label: "Office", area: "Malibagh", road: "DIT Road", house: "House 210", address: "House 210, DIT Road, Malibagh, Dhaka", lat: 23.748, lng: 90.415 } },
  { ...p("Lamia", "Rahman"), address: { label: "Home", area: "Bashundhara", road: "Road 7", house: "House 22", address: "House 22, Road 7, Block D, Bashundhara R/A, Dhaka", lat: 23.815, lng: 90.43 } },
  { ...p("Zubair", "Hossain"), address: { label: "Home", area: "Uttara", road: "Road 9", house: "House 5", address: "House 5, Road 9, Sector 4, Uttara, Dhaka", lat: 23.865, lng: 90.4 } },
];
