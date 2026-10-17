# 🌱 Stellar GreenPay

**🌐 Idiomas:** [English](../README.md) · **Español** · [Français](README.fr.md)

> ⚠️ Esta traducción puede ir por detrás del [README en inglés](../README.md), que es la versión de referencia. Si encuentras diferencias, consulta el original y considera abrir un PR para actualizarla.

> Dona directamente a proyectos climáticos verificados usando XLM: cada transacción queda registrada en la cadena de bloques.

> **Requisito previo:** Node.js >= 20 (necesario para el backend con Express 5). Ejecuta `nvm use` y se seleccionará la versión automáticamente: `.nvmrc` es la única fuente de verdad.

[![Licencia: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![PRs bienvenidos](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](../CONTRIBUTING.md)
[![Stellar](https://img.shields.io/badge/Stellar-Testnet-blue)](https://stellar.org)
[![Soroban](https://img.shields.io/badge/Soroban-Smart%20Contracts-green)](https://soroban.stellar.org)

---

## 📖 ¿Qué es?

Stellar GreenPay es una plataforma de código abierto para donaciones climáticas en la que los donantes entregan XLM directamente a proyectos medioambientales verificados. Cada donación se registra en la blockchain de Stellar mediante contratos inteligentes de Soroban, lo que ofrece una transparencia total y cero comisiones de plataforma.

---

## ✨ Funcionalidades (v1)

- 🔗 **Conexión de billetera**: integración con la billetera de navegador Freighter
- 🌍 **Explorar proyectos**: proyectos climáticos verificados con métricas de impacto
- 💚 **Donar XLM**: donaciones directas en la cadena a las billeteras de los proyectos
- 🌉 **Puente de USDC**: mueve USDC de Ethereum/Polygon a Stellar mediante Circle CCTP, sin custodia ([documentación](bridge.md))
- 📊 **Seguimiento del impacto**: un contrato de Soroban registra cada donación y la compensación de CO₂
- 🏆 **Clasificación**: los mejores donantes, ordenados por el total de XLM donado
- 💬 **Novedades de los proyectos**: las organizaciones publican avances para los donantes

---

## 🗂 Estructura del proyecto

```
stellar-greenpay/
├── frontend/          # Next.js + React + Tailwind CSS
├── backend/           # Node.js + API con Express
├── contracts/         # Contratos inteligentes de Stellar Soroban (Rust)
├── docs/              # Documentación de arquitectura y de la API
├── scripts/           # Scripts de despliegue y utilidades
├── .github/           # Flujos de CI/CD y plantillas de issues
├── CONTRIBUTING.md
├── ROADMAP.md
└── LICENSE
```

---

## 🚀 Inicio rápido

### Requisitos previos

| Herramienta | Versión |
|------|---------|
| Node.js | ≥ 18.x |
| npm | Última |
| Rust + Cargo | ≥ 1.74 (para los contratos) |
| Billetera Freighter | Extensión de navegador |

### 1. Clonar y configurar

```bash
git clone https://github.com/your-org/stellar-greenpay.git
cd stellar-greenpay
chmod +x scripts/setup-dev.sh
./scripts/setup-dev.sh
```

### 2. Iniciar el frontend

```bash
cd frontend && npm run dev
# → http://localhost:3000
```

### 3. Iniciar el backend

```bash
cd backend && npm run dev
# → http://localhost:4000
```

### Desarrollo con recarga en caliente en Docker

Usa el archivo de configuración de desarrollo cuando quieras que los cambios en el código del frontend y del backend se actualicen dentro de Docker sin reconstruir:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

---

## 🔑 Variables de entorno

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

## 🧪 Obtener XLM de prueba (Testnet)

1. Instala la [billetera Freighter](https://freighter.app) y cambia a **Testnet**
2. Visita [Stellar Friendbot](https://friendbot.stellar.org) con tu clave pública
3. Recibe 10 000 XLM de prueba al instante

---

## 🤝 Contribuir

Consulta [CONTRIBUTING.md](../CONTRIBUTING.md) (en inglés). ¡Todos los niveles de experiencia son bienvenidos!

Este proyecto se rige por un [Código de Conducta](../CODE_OF_CONDUCT.md). Al participar, aceptas cumplirlo.

Para informar de una vulnerabilidad, sigue el proceso de divulgación responsable de [SECURITY.md](../SECURITY.md) y **no** abras un issue público.

## 🗺 Hoja de ruta

Consulta [ROADMAP.md](../ROADMAP.md) para ver las funcionalidades previstas.

## 📄 Licencia

MIT: consulta [LICENSE](../LICENSE)
