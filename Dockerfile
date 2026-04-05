# Stage 1: Build the application
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies (necessary for some npm packages)
RUN apk add --no-cache python3 make g++ openssl

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm install --legacy-peer-deps

# Copy application source
COPY . .

# Generate Prisma client and build the NestJS app
RUN npx prisma generate
RUN npm run build

# Stage 2: Run the application
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies (Prisma needs openssl)
RUN apk add --no-cache openssl

# Copy only the necessary files from the builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Expose the default Hugging Face port
EXPOSE 7860

# Set required environment variables for Hugging Face
ENV PORT=7860
ENV NODE_ENV=production

# Start the application
# We use '|| true' to ensure the app starts even if migrations take too long
CMD ["sh", "-c", "npx prisma migrate deploy || echo 'Migration skip or fail' && npm run start:prod"]
