# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* yarn.lock* ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the React app
RUN npm run build

# Production stage - use Nginx for lightweight serving
FROM nginx:alpine

# Copy built app from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port (Nginx listens on 80 internally, mapped to 3000 externally via docker-compose)
EXPOSE 80

# Health check (Nginx listens on port 80 internally)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:80/ping || exit 1

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
