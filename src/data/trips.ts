export interface TripStep {
  id: string;
  location: string;
  country: string;
  date: string;
  description: string;
  imageUrl?: string;
  lat: number;
  lng: number;
}

export interface Trip {
  id: string;
  title: string;
  coverImage: string;
  startDate: string;
  endDate: string;
  countries: string[];
  distance: number;
  steps: TripStep[];
}

export const trips: Trip[] = [
  {
    id: "1",
    title: "East Africa Safari",
    coverImage: "",
    startDate: "2024-06-15",
    endDate: "2024-07-08",
    countries: ["Kenya", "Tanzania"],
    distance: 3200,
    steps: [
      { id: "1a", location: "Nairobi", country: "Kenya", date: "2024-06-15", description: "Arrived in Nairobi. The city buzzes with energy — visited the Giraffe Centre and Karen Blixen Museum.", lat: -1.286, lng: 36.817 },
      { id: "1b", location: "Masai Mara", country: "Kenya", date: "2024-06-18", description: "Three unforgettable days on safari. Witnessed a lion pride at sunrise and the vast savannah stretching endlessly.", lat: -1.5, lng: 35.15 },
      { id: "1c", location: "Serengeti", country: "Tanzania", date: "2024-06-23", description: "Crossed into Tanzania. The Serengeti is a sea of golden grass — saw thousands of wildebeest on the great migration.", lat: -2.333, lng: 34.833 },
      { id: "1d", location: "Ngorongoro Crater", country: "Tanzania", date: "2024-06-28", description: "Descended into the crater at dawn. Flamingos dotted the soda lake and a black rhino appeared through the mist.", lat: -3.167, lng: 35.583 },
      { id: "1e", location: "Zanzibar", country: "Tanzania", date: "2024-07-02", description: "Stone Town's winding alleys, spice markets, and turquoise waters. The perfect end to an epic journey.", lat: -6.165, lng: 39.199 },
    ],
  },
  {
    id: "2",
    title: "Patagonia Adventure",
    coverImage: "",
    startDate: "2024-01-10",
    endDate: "2024-01-28",
    countries: ["Argentina", "Chile"],
    distance: 2800,
    steps: [
      { id: "2a", location: "Buenos Aires", country: "Argentina", date: "2024-01-10", description: "Started the trip in the vibrant capital. Tango shows, incredible steaks, and colorful La Boca streets.", lat: -34.604, lng: -58.382 },
      { id: "2b", location: "El Calafate", country: "Argentina", date: "2024-01-14", description: "Perito Moreno glacier is otherworldly — massive ice walls cracking and crashing into turquoise waters.", lat: -50.34, lng: -72.265 },
      { id: "2c", location: "El Chaltén", country: "Argentina", date: "2024-01-18", description: "Hiked to the base of Fitz Roy. The mountain emerged from the clouds at the very last moment — magical.", lat: -49.331, lng: -72.886 },
      { id: "2d", location: "Torres del Paine", country: "Chile", date: "2024-01-22", description: "The W trek — guanacos, glacial lakes, and the iconic granite towers. Patagonian wind tested every fiber.", lat: -51.0, lng: -73.1 },
    ],
  },
  {
    id: "3",
    title: "Southeast Asia Backpacking",
    coverImage: "",
    startDate: "2023-11-05",
    endDate: "2023-12-20",
    countries: ["Thailand", "Vietnam", "Cambodia"],
    distance: 5400,
    steps: [
      { id: "3a", location: "Bangkok", country: "Thailand", date: "2023-11-05", description: "Temples, street food, and tuk-tuks. Wat Arun at sunset was breathtaking.", lat: 13.756, lng: 100.502 },
      { id: "3b", location: "Chiang Mai", country: "Thailand", date: "2023-11-10", description: "Night markets, cooking classes, and elephant sanctuaries in the misty mountains.", lat: 18.787, lng: 98.992 },
      { id: "3c", location: "Hanoi", country: "Vietnam", date: "2023-11-18", description: "Old Quarter chaos, egg coffee, and the most incredible phở I've ever tasted.", lat: 21.028, lng: 105.854 },
      { id: "3d", location: "Ha Long Bay", country: "Vietnam", date: "2023-11-22", description: "Kayaked through limestone karsts emerging from emerald water. Slept on a junk boat under the stars.", lat: 20.91, lng: 107.18 },
      { id: "3e", location: "Hoi An", country: "Vietnam", date: "2023-11-27", description: "Lantern-lit streets, tailor shops, and banh mi by the river. Got a custom suit made in 24 hours.", lat: 15.88, lng: 108.338 },
      { id: "3f", location: "Siem Reap", country: "Cambodia", date: "2023-12-05", description: "Angkor Wat at sunrise — no photo does it justice. Spent three days exploring the ancient temples.", lat: 13.361, lng: 103.86 },
      { id: "3g", location: "Phnom Penh", country: "Cambodia", date: "2023-12-12", description: "A city of contrasts — the Royal Palace's golden spires alongside poignant history at S-21.", lat: 11.556, lng: 104.928 },
    ],
  },
];

export const travelStats = {
  countriesVisited: 7,
  citiesVisited: 16,
  totalDistance: 11400,
  totalTrips: 3,
  totalDays: 92,
};
