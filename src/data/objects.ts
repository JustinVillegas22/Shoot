export type AstroObject = {
  id: string;
  name: string;
  type: "nebula" | "galaxy" | "cluster";
  constellation: string;
  ra: number;  // hours
  dec: number; // degrees
};

import generated from "@/data/generated/objects.generated.json";

export const OBJECTS: AstroObject[] = generated as AstroObject[];

export function getObjectById(id: string): AstroObject | undefined {
  return OBJECTS.find((o) => o.id === id);
}