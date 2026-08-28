import { Type } from '@sinclair/typebox';

// Boite englobante lache couvrant la France metropolitaine + DOM (Guadeloupe, Martinique,
// Guyane, Reunion, Mayotte). Volontairement large plutot que polygonale : suffisant pour
// rejeter les coordonnees aberrantes sans complexifier la validation.
export const LAT_MIN = -22;
export const LAT_MAX = 51.5;
export const LON_MIN = -63;
export const LON_MAX = 56;

export const latSchema = Type.Number({ minimum: LAT_MIN, maximum: LAT_MAX });
export const lonSchema = Type.Number({ minimum: LON_MIN, maximum: LON_MAX });
export const zoomSchema = Type.Integer({ minimum: 1, maximum: 18 });

export const departementSchema = Type.String({ pattern: '^(0[1-9]|[1-8][0-9]|9[0-5]|2A|2B|97[1-6])$' });

export const minutesSchema = Type.Integer({ minimum: 1, maximum: 1440 });

export const errorResponseSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
});
