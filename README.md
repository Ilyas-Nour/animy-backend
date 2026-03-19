# 🛰️ Animy Backend - Robust API for Anime Aggregator

<div align="center">
  <h3>The powerful core driving the Animy ecosystem.</h3>
</div>

---

## 📸 Screenshots

<div align="center">
  <table style="width: 100%; border-collapse: collapse;">
    <tr>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/1.png" alt="Screenshot 1" /></td>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/2.png" alt="Screenshot 2" /></td>
    </tr>
    <tr>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/3.png" alt="Screenshot 3" /></td>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/4.png" alt="Screenshot 4" /></td>
    </tr>
    <tr>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/5.png" alt="Screenshot 5" /></td>
      <td width="50%"><img src="https://raw.githubusercontent.com/Ilyas-Nour/animy-frontend/master/public/6.png" alt="Screenshot 6" /></td>
    </tr>
  </table>
</div>

---

## 🚀 Overview

**Animy Backend** is a modular, high-performance API built with **NestJS**. It serves as the central hub for user management, streaming orchestration, real-time communication, and data aggregation for the Animy platform.

![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?style=for-the-badge&logo=nestjs)
![Prisma](https://img.shields.io/badge/Prisma-5-2D3748?style=for-the-badge&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?style=for-the-badge&logo=postgresql)
![Redis](https://img.shields.io/badge/Redis-6-DC382D?style=for-the-badge&logo=redis)
![Socket.io](https://img.shields.io/badge/Socket.io-4-010101?style=for-the-badge&logo=socket.io)

---

## 🏗️ Architecture & Modules

The system is organized into decoupled modules for maximum scalability:

- 🔐 **Auth Module**: Secure JWT-based authentication with Google and Facebook OAuth integration.
- 👤 **Users Module**: Comprehensive user profile management, including avatar/banner uploads to Supabase.
- 📺 **Streaming Module**: Intelligent aggregation from multiple providers (HiAnime, Manga sources).
- 💬 **Chat & Notifications**: Real-time event-driven messaging and notification system using WebSockets.
- 🤝 **Friends System**: Relationship management, friend requests, and social interactions.
- 📰 **News & Engagement**: Curated anime news, comments, and community reactions.
- 🛠️ **Admin Panel**: Dedicated administrative tools for content management and user oversight.
- ⚡ **Caching Layer**: High-speed data retrieval using Redis for optimized performance.

---

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/)
- **ORM**: [Prisma](https://www.prisma.io/)
- **Database**: PostgreSQL (hosted on [Supabase](https://supabase.com/))
- **Cache**: [Redis](https://redis.io/)
- **Real-time**: [Socket.io](https://socket.io/)
- **Validation**: [Class-validator](https://github.com/typestack/class-validator) + [Class-transformer](https://github.com/typestack/class-transformer)
- **Security**: [Helmet](https://helmetjs.github.io/), Rate Limiting (Throttler), Passport (JWT/OAuth)
- **Email**: [Resend](https://resend.com/)

---

## ⚙️ Getting Started

### Prerequisites

- Node.js 18.x or higher
- PostgreSQL Database
- Redis Server
- npm or yarn

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Ilyas-Nour/animy-backend.git
   cd animy-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   Create a `.env` file in the root directory:
   ```env
   PORT=3001
   DATABASE_URL="your-postgresql-url"
   JWT_SECRET="your-secret-key"
   REDIS_HOST="localhost"
   REDIS_PORT=6379
   SUPABASE_URL="your-supabase-url"
   RESEND_API_KEY="your-resend-key"
   ```

4. **Initialize Database**
   ```bash
   npx prisma generate
   npx prisma migrate dev
   ```

5. **Run the application**
   ```bash
   # Development mode
   npm run start:dev

   # Production mode
   npm run start:prod
   ```

---

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

<div align="center">
  Engineered for Speed 🚀
</div>
