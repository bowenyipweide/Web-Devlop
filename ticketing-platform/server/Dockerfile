FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* yarn.lock* ./

# Install dependencies (production only)
RUN npm install --production

# Copy source code
COPY . .

# Expose port
EXPOSE 5000

# Health check - validates server is running and DB is accessible
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:5000/health || exit 1

# Start the server
CMD ["npm", "start"]
