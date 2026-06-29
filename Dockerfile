# Use a lightweight official Node.js Alpine base image
FROM node:24-alpine

# Set environment to production
ENV NODE_ENV=production
ENV PORT=8383
ENV ROBLOX_USER_ID=162336333
ENV DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1521254361433505922/50CJR3_yifDYyD4H9UuPjIxbZHWpYo2lqk71cZjZN8eIpV5rfRFhByzItiP1wtgmJ1UT
ENV POLL_INTERVAL_MS=15000

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package configurations
COPY package.json ./

# Install dependencies (only production)
RUN npm install --omit=dev

# Copy application source code
COPY server.js ./
COPY public/ ./public/

# Expose the custom uncommon port
EXPOSE 8383

# Start the application
CMD [ "npm", "start" ]
