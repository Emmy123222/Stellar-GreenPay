# 🌱 Stellar GreenPay

**🌐 Langues :** [English](../README.md) · [Español](README.es.md) · **Français**

> ⚠️ Cette traduction peut avoir du retard sur le [README en anglais](../README.md), qui reste la version de référence. Si vous constatez des différences, consultez l'original et pensez à ouvrir une PR pour la mettre à jour.

> Faites des dons directement à des projets climatiques vérifiés en XLM : chaque transaction est enregistrée sur la blockchain.

> **Prérequis :** Node.js >= 20 (requis par le backend Express 5). Lancez `nvm use` pour sélectionner automatiquement la bonne version : `.nvmrc` est la source de vérité unique.

[![Licence : MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs bienvenues](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](../CONTRIBUTING.md)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-green)](https://soroban.stellar.org)

---

## 📖 Présentation

Stellar GreenPay est une plateforme open source de dons pour le climat : les donateurs versent des XLM directement à des projets environnementaux vérifiés. Chaque don est enregistré sur la blockchain Stellar grâce aux contrats intelligents Soroban, ce qui garantit une transparence totale et aucun frais de plateforme.

---

## ✨ Fonctionnalités (v1)

- 🔗 **Connexion du portefeuille** : intégration du portefeuille de navigateur Freighter
- 🌍 **Parcourir les projets** : projets climatiques vérifiés avec indicateurs d'impact
- 💚 **Donner en XLM** : dons directs sur la blockchain vers les portefeuilles des projets
- 🌉 **Pont USDC** : transférez des USDC d'Ethereum/Polygon vers Stellar via Circle CCTP, sans garde ([documentation](bridge.md))
- 📊 **Suivi de l'impact** : un contrat Soroban enregistre chaque don et la compensation de CO₂ associée
- 🏆 **Classement** : les meilleurs donateurs, classés selon le total de XLM donnés
- 💬 **Actualités des projets** : les organisations publient des mises à jour de leur avancement à l'attention des donateurs

---

## 🗂 Structure du projet

```
stellar-greenpay/
├── frontend/          # Next.js + React + Tailwind CSS
├── backend/           # Node.js + API Express
├── contracts/         # Contrats intelligents Stellar Soroban (Rust)
├── docs/              # Documentation d'architecture et de l'API
├── scripts/           # Scripts de déploiement et utilitaires
├── .github/           # Workflows CI/CD et modèles d'issues
├── CONTRIBUTING.md
├── ROADMAP.md
└── LICENSE
```

---

## 🚀 Démarrage rapide

### Prérequis

| Outil | Version |
|------|---------|
| Node.js | ≥ 18.x |
| npm | Dernière |
| Rust + Cargo | ≥ 1.74 (pour les contrats) |
| Portefeuille Freighter | Extension de navigateur |

### 1. Cloner et configurer

```bash
git clone https://github.com/your-org/stellar-greenpay.git
cd stellar-greenpay
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

### 2. Démarrer le frontend

```bash
cd frontend && npm run dev
# → http://localhost:3000
```

### 3. Démarrer le backend

```bash
cd backend && npm run dev
# → http://localhost:4000
```

### Développement Docker avec rechargement à chaud

Utilisez la configuration de développement pour que les modifications du code du frontend et du backend soient prises en compte dans Docker sans reconstruction :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## 🔑 Variables d'environnement

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CONTRACT_ID=
```

### Backend (`backend/.env`)
```env
PORT=4000
STELLAR_NETWORK=testnet
HORIZON_URL=https://horizon-testnet.stellar.org
CONTRACT_ID=
ALLOWED_ORIGINS=http://localhost:3000
```

---

## 🧪 Obtenir des XLM de test (Testnet)

1. Installez le [portefeuille Freighter](https://freighter.app) et passez sur **Testnet**
2. Rendez-vous sur [Stellar Friendbot](https://friendbot.stellar.org) avec votre clé publique
3. Recevez instantanément 10 000 XLM de test

---

## 🤝 Contribuer

Consultez [CONTRIBUTING.md](../CONTRIBUTING.md) (en anglais). Tous les niveaux sont les bienvenus !

Ce projet est régi par un [Code de conduite](../CODE_OF_CONDUCT.md). En participant, vous vous engagez à le respecter.

Pour signaler une vulnérabilité, suivez la procédure de divulgation responsable décrite dans [SECURITY.md](../SECURITY.md) et **n'ouvrez pas** d'issue publique.

## 🗺 Feuille de route

Consultez [ROADMAP.md](../ROADMAP.md) pour les fonctionnalités prévues.

## 📄 Licence

MIT : voir [LICENSE](../LICENSE)
