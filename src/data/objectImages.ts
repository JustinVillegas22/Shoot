// src/data/objectImages.ts

export type ObjectImage = {
  src: string;      // URL or local path
  credit: string;   // "John Doe"
  source: string;   // "AstroBin" / "Wikimedia Commons" / etc.
};

export const OBJECT_IMAGES: Record<string, ObjectImage> = {
  // Example IDs (replace with your actual obj.id values)
  // "M42": { src: "...", credit: "...", source: "AstroBin" },

  // Start small; grow over time.
};