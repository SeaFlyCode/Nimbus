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
# renseigner METEOFRANCE_API_KEY et API_KEYS dans .env
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

## Obtenir un acces Meteo-France

1. Creer un compte sur https://portail-api.meteofrance.fr
2. Souscrire aux APIs necessaires (Paquet Radar, Bulletin Vigilance, AROME) sur
   une meme application ("My Apps" du portail).
3. Generer une cle ("Generate Token"), en choisissant une duree de validite
   longue (ideal : illimitee si l'option existe) puisque cette cle est utilisee
   telle quelle sur chaque appel, sans mecanisme de refresh cote backend.
4. Renseigner `METEOFRANCE_API_KEY` dans `.env` avec cette cle.

**Important** : cette cle se transmet via un header custom **`apikey`**, pas
`Authorization: Bearer` (confirme empiriquement le 2026-08-28 : la meme cle en
Bearer renvoie `401 Invalid Credentials`, en `apikey` elle fonctionne). C'est
un JWT auto-suffisant signe par le portail (type WSO2 "apiKey"), pas un
`access_token` OAuth2 classique — pas d'echange ni de refresh necessaire.
Les appels de donnees se font sur `METEOFRANCE_BASE_URL`
(`public-api.meteofrance.fr`, different du portail).

Chemins confirmes avec un vrai compte (2026-08-28) :
- Vigilance : `cartevigilance/encours`, payload enveloppe dans `"product"`,
  couleurs numeriques, phenomenes sous `phenomenon_items` (voir
  `parseVigilanceCarte` dans `src/meteofrance/client.ts`).
- Radar : `mosaique/paquet` (pas de decoupage par tuile cote serveur).

Encore a verifier (nécessite une souscription active a Radar/AROME, pas
seulement Vigilance) : le payload exact du paquet radar, et les noms de
coverage AROME (`AROME_COVERAGE_PREFIX` dans `src/meteofrance/client.ts`) —
utilisables via `GetCapabilities`/`DescribeCoverage` une fois souscrit.

### Prevision (`/forecast`) : particularite AROME

Il n'existe pas d'endpoint JSON simple "prevision par point". Le modele AROME
expose des grilles (WCS, format GeoTIFF ici) decodees avec le package
`geotiff`. Comme l'API AROME est limitee a 50 requetes/minute, le scheduler
pre-charge un nombre borne d'echeances (`src/meteofrance/forecastPlan.ts`,
H+1 a H+24) pour 3 parametres (temperature, precipitation, vent), throttle les
appels, et met chaque grille en cache Redis. La route `/forecast` ne fait
qu'interpoler (bilineaire) la valeur au point demande depuis ces grilles en
cache : elle n'appelle jamais Meteo-France a la requete, exactement comme
`/radar/latest` et `/alerts`.

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

- **Radar mosaique**, **vigilance** (tous departements) et **prevision**
  (grilles AROME) sont pre-charges en arriere-plan par le scheduler
  (`src/jobs/scheduler.ts`), sur les intervalles `RADAR_POLL_INTERVAL_MS` /
  `ALERTS_POLL_INTERVAL_MS` / `FORECAST_POLL_INTERVAL_MS`. Les routes
  correspondantes (`/radar/latest`, `/alerts`, `/forecast`) ne font que lire
  le cache et, pour `/forecast`, interpoler le point demande.
- Le paquet radar Meteo-France ne decoupe pas la mosaique par tuile/zoom cote
  serveur : `/radar/latest` renvoie toujours l'image complete (metropole +
  outre-mer), le crop/zoom se fait cote client.
- Dans tous les cas, une reponse 5xx de Meteo-France n'est jamais renvoyee
  brute au client : si une donnee en cache existe (meme perimee), elle est
  servie ; sinon l'API renvoie un `503` explicite.

## Endpoints

```bash
# Mosaique radar France entiere (depuis le cache, pas de decoupage par tuile cote serveur)
curl http://localhost:3000/radar/latest -H "X-API-Key: <cle>"

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
