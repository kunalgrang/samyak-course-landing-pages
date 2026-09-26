export type SubdivisionDefinition = {
  code?: string;
  name: string;
};

export type CountryDefinition = {
  code: string;
  name: string;
  subdivisionLabel?: string;
  subdivisions?: SubdivisionDefinition[];
};

export const DEFAULT_COUNTRY_CODE = "IN";

const curatedCountries: CountryDefinition[] = [
  { code: "IN", name: "India", subdivisionLabel: "State / Union Territory", subdivisions: names([
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  ]) },
  { code: "US", name: "United States", subdivisionLabel: "State", subdivisions: names([
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "District of Columbia", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming",
  ]) },
  { code: "CA", name: "Canada", subdivisionLabel: "Province / Territory", subdivisions: names(["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia", "Nunavut", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan", "Yukon"]) },
  { code: "GB", name: "United Kingdom", subdivisionLabel: "Nation", subdivisions: names(["England", "Northern Ireland", "Scotland", "Wales"]) },
  { code: "AU", name: "Australia", subdivisionLabel: "State / Territory", subdivisions: names(["Australian Capital Territory", "New South Wales", "Northern Territory", "Queensland", "South Australia", "Tasmania", "Victoria", "Western Australia"]) },
  { code: "NZ", name: "New Zealand", subdivisionLabel: "Region", subdivisions: names(["Auckland", "Bay of Plenty", "Canterbury", "Gisborne", "Hawke's Bay", "Manawatu-Wanganui", "Marlborough", "Nelson", "Northland", "Otago", "Southland", "Taranaki", "Tasman", "Waikato", "Wellington", "West Coast"]) },
  { code: "AE", name: "United Arab Emirates", subdivisionLabel: "Emirate", subdivisions: names(["Abu Dhabi", "Ajman", "Dubai", "Fujairah", "Ras Al Khaimah", "Sharjah", "Umm Al Quwain"]) },
  { code: "SA", name: "Saudi Arabia", subdivisionLabel: "Province", subdivisions: names(["Al Bahah", "Al Jawf", "Al Madinah", "Al Qassim", "Asir", "Eastern Province", "Hail", "Jazan", "Makkah", "Najran", "Northern Borders", "Riyadh", "Tabuk"]) },
  { code: "QA", name: "Qatar", subdivisionLabel: "Municipality", subdivisions: names(["Al Daayen", "Al Khor and Al Thakhira", "Al Rayyan", "Al Shamal", "Al Wakrah", "Doha", "Umm Salal"]) },
  { code: "OM", name: "Oman", subdivisionLabel: "Governorate", subdivisions: names(["Ad Dakhiliyah", "Ad Dhahirah", "Al Batinah North", "Al Batinah South", "Al Buraimi", "Al Wusta", "Ash Sharqiyah North", "Ash Sharqiyah South", "Dhofar", "Musandam", "Muscat"]) },
  { code: "BH", name: "Bahrain", subdivisionLabel: "Governorate", subdivisions: names(["Capital", "Muharraq", "Northern", "Southern"]) },
  { code: "MY", name: "Malaysia", subdivisionLabel: "State / Federal Territory", subdivisions: names(["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Malacca", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"]) },
  { code: "ZA", name: "South Africa", subdivisionLabel: "Province", subdivisions: names(["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"]) },
  { code: "DE", name: "Germany", subdivisionLabel: "State", subdivisions: names(["Baden-Wurttemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse", "Lower Saxony", "Mecklenburg-Vorpommern", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland", "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia"]) },
  { code: "FR", name: "France", subdivisionLabel: "Region", subdivisions: names(["Auvergne-Rhone-Alpes", "Bourgogne-Franche-Comte", "Brittany", "Centre-Val de Loire", "Corsica", "Grand Est", "Hauts-de-France", "Ile-de-France", "Normandy", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire", "Provence-Alpes-Cote d'Azur"]) },
  { code: "NL", name: "Netherlands", subdivisionLabel: "Province", subdivisions: names(["Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", "Limburg", "North Brabant", "North Holland", "Overijssel", "South Holland", "Utrecht", "Zeeland"]) },
  { code: "IE", name: "Ireland", subdivisionLabel: "Province", subdivisions: names(["Connacht", "Leinster", "Munster", "Ulster"]) },
  { code: "JP", name: "Japan", subdivisionLabel: "Prefecture", subdivisions: names(["Aichi", "Akita", "Aomori", "Chiba", "Ehime", "Fukui", "Fukuoka", "Fukushima", "Gifu", "Gunma", "Hiroshima", "Hokkaido", "Hyogo", "Ibaraki", "Ishikawa", "Iwate", "Kagawa", "Kagoshima", "Kanagawa", "Kochi", "Kumamoto", "Kyoto", "Mie", "Miyagi", "Miyazaki", "Nagano", "Nagasaki", "Nara", "Niigata", "Oita", "Okayama", "Okinawa", "Osaka", "Saga", "Saitama", "Shiga", "Shimane", "Shizuoka", "Tochigi", "Tokushima", "Tokyo", "Tottori", "Toyama", "Wakayama", "Yamagata", "Yamaguchi", "Yamanashi"]) },
  { code: "BD", name: "Bangladesh", subdivisionLabel: "Division", subdivisions: names(["Barisal", "Chattogram", "Dhaka", "Khulna", "Mymensingh", "Rajshahi", "Rangpur", "Sylhet"]) },
  { code: "NP", name: "Nepal", subdivisionLabel: "Province", subdivisions: names(["Bagmati", "Gandaki", "Karnali", "Koshi", "Lumbini", "Madhesh", "Sudurpashchim"]) },
  { code: "LK", name: "Sri Lanka", subdivisionLabel: "Province", subdivisions: names(["Central", "Eastern", "North Central", "Northern", "North Western", "Sabaragamuwa", "Southern", "Uva", "Western"]) },
  { code: "SG", name: "Singapore" },
];

const additionalCountries = [
  ["AF", "Afghanistan"], ["AL", "Albania"], ["DZ", "Algeria"], ["AD", "Andorra"], ["AO", "Angola"], ["AR", "Argentina"], ["AM", "Armenia"], ["AT", "Austria"], ["AZ", "Azerbaijan"], ["BS", "Bahamas"], ["BE", "Belgium"], ["BR", "Brazil"], ["BN", "Brunei"], ["BG", "Bulgaria"], ["KH", "Cambodia"], ["CL", "Chile"], ["CN", "China"], ["CO", "Colombia"], ["CR", "Costa Rica"], ["HR", "Croatia"], ["CY", "Cyprus"], ["CZ", "Czechia"], ["DK", "Denmark"], ["EG", "Egypt"], ["EE", "Estonia"], ["FI", "Finland"], ["GE", "Georgia"], ["GH", "Ghana"], ["GR", "Greece"], ["HK", "Hong Kong"], ["HU", "Hungary"], ["ID", "Indonesia"], ["IL", "Israel"], ["IT", "Italy"], ["KE", "Kenya"], ["KR", "South Korea"], ["KW", "Kuwait"], ["LB", "Lebanon"], ["LU", "Luxembourg"], ["MV", "Maldives"], ["MX", "Mexico"], ["MA", "Morocco"], ["MM", "Myanmar"], ["NG", "Nigeria"], ["NO", "Norway"], ["PK", "Pakistan"], ["PH", "Philippines"], ["PL", "Poland"], ["PT", "Portugal"], ["RO", "Romania"], ["ES", "Spain"], ["SE", "Sweden"], ["CH", "Switzerland"], ["TW", "Taiwan"], ["TH", "Thailand"], ["TR", "Turkiye"], ["UG", "Uganda"], ["VN", "Vietnam"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"],
].map(([code, name]) => ({ code, name }));

export const countries: CountryDefinition[] = [...curatedCountries, ...additionalCountries]
  .sort((a, b) => a.name.localeCompare(b.name));

export function countryByCode(code: string) {
  return countries.find((country) => country.code === code) || null;
}

export function countryName(code: string) {
  return countryByCode(code)?.name || code;
}

export function hasCuratedSubdivisions(countryCode: string) {
  return Boolean(countryByCode(countryCode)?.subdivisions?.length);
}

export function subdivisionLabel(countryCode: string) {
  return countryByCode(countryCode)?.subdivisionLabel || "State / Province / Region";
}

export function isValidSubdivision(countryCode: string, value: string) {
  const subdivisions = countryByCode(countryCode)?.subdivisions;
  if (!subdivisions?.length) return true;
  return subdivisions.some((subdivision) => subdivision.name === value);
}

function names(values: string[]): SubdivisionDefinition[] {
  return values.map((name) => ({ name }));
}
