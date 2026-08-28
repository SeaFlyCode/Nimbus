# Nimbus API

Backend radar meteo pour la France. Intermediaire unique entre l'API publique
Meteo-France (portail-api.meteofrance.fr) et les clients (app mobile, site web) :
il ne expose jamais le token Meteo-France, mutualise les appels via un cache
Redis, et reste utilisable (donnees en cache) meme si Meteo-France est
temporairement en panne.

## Stack

- Node.js + TypeScript + Fastify
- Redis (cache, rate-limiting, historique radar glissant)
- Scheduler interne (polling periodique, decouple du cycle requete/reponse)
- Docker Compose (app + Redis)

## Demarrage local (Docker Compose)

```bash
cp .env.example .env
# renseigner METEOFRANCE_TOKEN et API_KEYS dans .env
docker compose up --build
```

L'API est disponible sur `http://localhost:3000`, la doc interactive sur
`http://localhost:3000/docs`.

## Demarrage local (sans Docker)

```bash
npm install
cp .env.example .env
# lancer un Redis local, ex: docker run -p 6379:6379 redis:7-alpine
npm run dev
```

## Obtenir un token Meteo-France

1. Creer un compte sur https://portail-api.meteofrance.fr
2. Souscrire aux APIs necessaires (radar, prevision/Promethee, vigilance) dans
   la section "APIs" du portail.
3. Generer une application/un token d'acces depuis l'espace developpeur.
4. Renseigner `METEOFRANCE_TOKEN` dans `.env`.

Les chemins d'endpoint exacts (`METEOFRANCE_BASE_URL` + chemins codes dans
`src/meteofrance/client.ts`, constante `ENDPOINTS`) dependent de l'offre
souscrite : verifiez-les dans la doc du portail une fois votre abonnement
actif et ajustez `ENDPOINTS` si besoin. Le reste de l'architecture (cache,
routes, jobs, fallback) fonctionne independamment de ces chemins exacts.

## Variables d'environnement

Voir `.env.example` pour la liste complete et les valeurs par defaut. Points
notables :

- `API_KEYS` : format `nom:cle,nom2:cle2`. Vide = pas d'authentification
  (a n'utiliser qu'en developpement).
- `RADAR_POLL_INTERVAL_MS`, `FORECAST_POLL_INTERVAL_MS`, `ALERTS_POLL_INTERVAL_MS` :
  frequence de rafraichissement attendue par type de donnee.
- `FRESHNESS_STALE_MULTIPLIER` : une donnee plus vieille que
  `intervalle x multiplicateur` est jugee "degraded" par `/health`. Le TTL
  Redis reel est volontairement plus long (2x ce seuil) pour pouvoir servir
  du cache en fallback meme quand `/health` la signale deja comme perimee.

## Authentification

Chaque client transmet sa cle dans le header `X-API-Key`. `/health` et `/docs`
sont accessibles sans cle.

## Polling vs cache-aside

- **Radar mosaique** et **vigilance** (tous departements) sont pre-charges en
  arriere-plan par le scheduler (`src/jobs/scheduler.ts`), sur les intervalles
  `RADAR_POLL_INTERVAL_MS` / `ALERTS_POLL_INTERVAL_MS`. Les routes ne font que
  lire le cache.
- **Prevision** (`/forecast`) et **tuile radar** (`/radar/latest?lat&lon&zoom`)
  sont parametrees par point geographique arbitraire : elles suivent un
  pattern cache-aside (lecture cache, appel Meteo-France uniquement sur miss,
  mise en cache du resultat).
- Dans tous les cas, une reponse 5xx de Meteo-France n'est jamais renvoyee
  brute au client : si une donnee en cache existe (meme perimee), elle est
  servie ; sinon l'API renvoie un `503` explicite.

## Endpoints

```bash
# Mosaique radar France entiere (depuis le cache)
curl http://localhost:3000/radar/latest -H "X-API-Key: <cle>"

# Tuile radar pour une zone
curl "http://localhost:3000/radar/latest?lat=48.85&lon=2.35&zoom=8" -H "X-API-Key: <cle>"

# Historique des N dernieres minutes pour l'animation
curl "http://localhost:3000/radar/history?minutes=60" -H "X-API-Key: <cle>"

# Prevision horaire pour un point
curl "http://localhost:3000/forecast?lat=48.85&lon=2.35" -H "X-API-Key: <cle>"

# Vigilance meteo par departement
curl "http://localhost:3000/alerts?departement=75" -H "X-API-Key: <cle>"

# Statut du service (age du cache, echecs Meteo-France)
curl http://localhost:3000/health
```

## Tests

```bash
npm test
```

Les tests mockent systematiquement le client Meteo-France et Redis (fake en
memoire) : aucun appel reseau reel n'est effectue.

## Build production

```bash
npm run build
npm start
```

## Licence

AGPL-3.0 + Commons Clause — voir [LICENSE](./LICENSE). Usage, modification et
republication libres, republication du code source obligatoire en cas de
modification (y compris en service reseau). L'usage commercial (vente,
hebergement payant, support payant derivant substantiellement de Nimbus.API)
necessite une licence commerciale separee aupres de l'auteur.
