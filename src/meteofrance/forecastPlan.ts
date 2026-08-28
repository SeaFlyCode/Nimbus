import type { ForecastParam } from './client';

// Echeances mutualisees entre tous les clients : resolution fine a court terme, plus large
// au-dela de H+6. Garde le nombre total de requetes AROME par cycle de polling raisonnable
// (12 echeances x 3 parametres = 36 appels, throttles) au regard du rate-limit de 50 req/min.
export const FORECAST_HOUR_OFFSETS: readonly number[] = [1, 2, 3, 4, 5, 6, 9, 12, 15, 18, 21, 24];

export const FORECAST_PARAMS: readonly ForecastParam[] = ['TEMPERATURE', 'PRECIPITATION', 'WIND_SPEED'];
