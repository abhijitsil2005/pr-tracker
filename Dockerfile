# --- STAGE 1: Build & Dependency Resolution ---
FROM node:20-alpine AS builder
WORKDIR /usr/src/app

# Copy package manifests first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies if needed for build/TS compilation)
RUN npm ci

# Copy the rest of the application files
COPY . .

# Prune development dependencies to keep the image lightweight
RUN npm prune --production


# --- STAGE 2: Final Runtime ---
FROM node:20-alpine
WORKDIR /usr/src/app

# Copy node_modules and code from the builder stage
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app ./

# Elastic Beanstalk reverse proxy (Nginx) defaults to forwarding traffic to port 8080
EXPOSE 3000

# Ensure the app runs in production mode
ENV NODE_ENV=production

# Run the app securely using 'node' instead of npm scripts to handle OS signals correctly
CMD ["node", "server.js"]
