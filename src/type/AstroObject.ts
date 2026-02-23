export type CatalogCode = "M" | "C"; // Messier / Caldwell

export type AstroObject = {
  id: string;              // stable internal id, e.g. "M31" or "C14"
  catalog: CatalogCode;
  number: number;          // 31, 14, etc.
  name: string;            // "Andromeda Galaxy"
  type?: string;           // "Galaxy", "Nebula", "Cluster", ...
  constellation?: string;  // "Andromeda"
  raHours: number;         // Right ascension in hours (0..24)
  decDeg: number;          // Declination in degrees (-90..+90)
  mag?: number;            // visual magnitude if known
  sizeArcMin?: number;     // optional
  notes?: string;
};
