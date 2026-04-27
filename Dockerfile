# Stage 1: Build the Vite App
FROM node:20-alpine AS build
WORKDIR /app

# Build-time secrets (Vite inlines VITE_* vars into the bundle).
# In Coolify, set VITE_APP_PASSWORD as a "Build Variable" so it's passed here.
ARG VITE_APP_PASSWORD
ENV VITE_APP_PASSWORD=$VITE_APP_PASSWORD

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Stage 2: Serve the App using Nginx Alpine
FROM nginx:alpine
# Install curl for healthchecks
RUN apk add --no-cache curl
# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy build assets from stage 1
COPY --from=build /app/dist /usr/share/nginx/html
# DMG is not processed by Vite — copy it directly into the served promo dir
COPY --from=build /app/promo/DiscoCast-Visualizer.dmg /usr/share/nginx/html/promo/DiscoCast-Visualizer.dmg

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 3000
EXPOSE 3000

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
